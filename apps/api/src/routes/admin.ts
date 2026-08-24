/**
 * Внутренняя админка API.
 *
 * Здесь есть два источника данных:
 * - Postgres, когда задан `DATABASE_URL`;
 * - локальный JSONL-manifest, когда credentials ещё нет.
 * Такой fallback нужен именно для capture pilot: сайт можно запустить локально,
 * собрать пары и выгрузить manifest без облачной инфраструктуры.
 */

import { CaseMetadataSchema } from '@cats-screening/shared';
import type { FastifyPluginAsync } from 'fastify';

import { listAllLocalCases, listLocalCases } from '../services/local-capture-store.js';
import { localPublicUrlFromUri } from '../services/local-image-storage.js';
import { prisma } from '../services/prisma.js';

type CaseListItem = {
  id: string;
  createdAt: string;
  score: number | null;
  confidence: number | null;
  metadata: unknown;
  qc: unknown;
  images: Array<{ kind: string; uri: string; publicUrl?: string | null }>;
};

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';

  const text = String(value);
  const needsQuotes = /[",\r\n]/.test(text);
  const escaped = text.replaceAll('"', '""');
  return needsQuotes ? `"${escaped}"` : escaped;
}

function normalizeMetadata(metadata: unknown): unknown {
  const parsed = CaseMetadataSchema.safeParse(metadata);
  return parsed.success ? parsed.data : metadata;
}

function enrichImages(images: Array<{ kind: string; uri: string }>): Array<{ kind: string; uri: string; publicUrl?: string | null }> {
  return images.map((image) => ({
    ...image,
    publicUrl: localPublicUrlFromUri(image.uri)
  }));
}

function metadataValue(metadata: any, path: string): unknown {
  return path.split('.').reduce((value, key) => (value == null ? undefined : value[key]), metadata);
}

async function readCases(limit?: number, offset = 0): Promise<CaseListItem[]> {
  if (!process.env.DATABASE_URL) {
    const local = limit == null ? await listAllLocalCases() : await listLocalCases(limit, offset);
    return local.map((item) => ({
      id: item.id,
      createdAt: item.createdAt,
      score: item.score,
      confidence: item.confidence,
      metadata: normalizeMetadata(item.metadata),
      qc: item.qc,
      images: enrichImages(item.images)
    }));
  }

  if (!prisma) {
    throw new Error('DATABASE_URL не задан, Prisma client недоступен');
  }

  const cases = await prisma.case.findMany({
    ...(limit == null ? {} : { take: limit, skip: offset }),
    orderBy: { createdAt: 'desc' },
    include: { images: true }
  });

  return cases.map((c) => ({
    id: c.id,
    createdAt: c.createdAt.toISOString(),
    score: c.score,
    confidence: c.confidence,
    metadata: normalizeMetadata(c.metadata),
    qc: c.qc,
    images: enrichImages(c.images.map((img) => ({ kind: img.kind, uri: img.uri })))
  }));
}

function buildCsv(cases: CaseListItem[]): string {
  const header = [
    'id',
    'createdAt',
    'score',
    'confidence',
    'series',
    'pairId',
    'captureMode',
    'operatorId',
    'device',
    'tray',
    'light',
    'location',
    'referencePh',
    'diagnosticPh',
    'diagnosticBand',
    'class',
    'condition.lightLabel',
    'condition.angleLabel',
    'condition.distanceLabel',
    'capture.referenceCapturedAt',
    'capture.diagnosticCapturedAt',
    'capture.captureDeltaSeconds',
    'qc.blur',
    'qc.glare',
    'qc.dark',
    'reference.uri',
    'diagnostic.uri'
  ];

  const lines = [header.join(',')];

  for (const c of cases) {
    const metadata = normalizeMetadata(c.metadata) as any;
    const qc = (c.qc ?? {}) as any;
    const ref = c.images.find((i) => i.kind === 'reference')?.uri ?? '';
    const diag = c.images.find((i) => i.kind === 'diagnostic')?.uri ?? '';

    const row = [
      c.id,
      c.createdAt,
      c.score ?? '',
      c.confidence ?? '',
      metadata?.series ?? '',
      metadata?.pairId ?? '',
      metadata?.captureMode ?? '',
      metadata?.operatorId ?? '',
      metadata?.device ?? '',
      metadata?.tray ?? '',
      metadata?.light ?? '',
      metadata?.location ?? '',
      metadata?.referencePh ?? '',
      metadata?.diagnosticPh ?? metadata?.pH ?? '',
      metadata?.diagnosticBand ?? '',
      metadata?.class ?? '',
      metadataValue(metadata, 'condition.lightLabel') ?? '',
      metadataValue(metadata, 'condition.angleLabel') ?? '',
      metadataValue(metadata, 'condition.distanceLabel') ?? '',
      metadataValue(metadata, 'capture.referenceCapturedAt') ?? '',
      metadataValue(metadata, 'capture.diagnosticCapturedAt') ?? '',
      metadataValue(metadata, 'capture.captureDeltaSeconds') ?? '',
      qc?.blur ?? '',
      qc?.glare ?? '',
      qc?.dark ?? '',
      ref,
      diag
    ].map(csvCell);

    lines.push(row.join(','));
  }

  return `${lines.join('\r\n')}\r\n`;
}

export const registerAdminRoutes: FastifyPluginAsync = async (app) => {
  /** Список кейсов с простой offset/limit пагинацией. */
  app.get('/cases', async (request) => {
    const query = (request.query ?? {}) as { limit?: string; offset?: string };
    const limitRaw = Number(query.limit ?? 50);
    const offsetRaw = Number(query.offset ?? 0);

    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;
    const offset = Number.isFinite(offsetRaw) ? Math.max(offsetRaw, 0) : 0;
    const items = await readCases(limit, offset);

    return {
      source: process.env.DATABASE_URL ? 'postgres' : 'local-jsonl',
      page: {
        limit,
        offset,
        nextOffset: offset + items.length
      },
      items
    };
  });

  /** CSV-выгрузка для таблиц и ручного контроля квот. */
  app.get('/export.csv', async (_request, reply) => {
    const cases = await readCases();
    const csv = buildCsv(cases);

    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', 'attachment; filename="cases.csv"');
    return csv;
  });

  /** JSONL-выгрузка для ML-pipeline и будущего catalog builder. */
  app.get('/export.jsonl', async (_request, reply) => {
    const cases = await readCases();
    const jsonl = `${cases.map((item) => JSON.stringify(item)).join('\r\n')}\r\n`;

    reply.header('content-type', 'application/x-ndjson; charset=utf-8');
    reply.header('content-disposition', 'attachment; filename="cases.jsonl"');
    return jsonl;
  });
};
