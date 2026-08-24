/**
 * Admin API новой capture-серии.
 *
 * Новые кейсы читаются только из capture-hotfix/cases.jsonl. Legacy manifest и
 * Postgres не подмешиваются в counters/export и физически остаются нетронутыми.
 */

import type { FastifyPluginAsync } from 'fastify';

import { listFreshCaptureCases, type FreshCaptureCase } from '../services/local-capture-store.js';
import { localPublicUrlFromUri } from '../services/local-image-storage.js';

type AdminCaseListItem = Omit<FreshCaptureCase, 'images'> & {
  images: Array<FreshCaptureCase['images'][number] & { publicUrl: string | null }>;
};

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';

  const text = String(value);
  const needsQuotes = /[",\r\n]/.test(text);
  const escaped = text.replaceAll('"', '""');
  return needsQuotes ? '"' + escaped + '"' : escaped;
}

function enrichCase(item: FreshCaptureCase): AdminCaseListItem {
  return {
    ...item,
    images: item.images.map((image) => ({
      ...image,
      publicUrl: localPublicUrlFromUri(image.uri),
    })),
  };
}

function buildCsv(cases: FreshCaptureCase[]): string {
  const header = [
    'id',
    'attemptId',
    'createdAt',
    'included',
    'exclusionReason',
    'series',
    'taskCode',
    'taskType',
    'specimenId',
    'sourcePh',
    'finalMixturePh',
    'operatorId',
    'device',
    'condition.lightLabel',
    'condition.angleLabel',
    'condition.distanceLabel',
    'reactionStartedAt',
    'imageCount',
    'images',
  ];
  const lines = [header.join(',')];

  for (const item of cases) {
    lines.push(
      [
        item.id,
        item.attemptId,
        item.createdAt,
        item.included,
        item.exclusionReason,
        item.series,
        item.taskCode,
        item.taskType,
        item.specimenId,
        item.sourcePh,
        item.finalMixturePh,
        item.operatorId,
        item.device,
        item.condition.lightLabel,
        item.condition.angleLabel,
        item.condition.distanceLabel,
        item.reactionStartedAt,
        item.images.length,
        JSON.stringify(item.images),
      ]
        .map(csvCell)
        .join(','),
    );
  }

  return lines.join('\r\n') + '\r\n';
}

export const registerAdminRoutes: FastifyPluginAsync = async (app) => {
  app.get('/cases', async (request) => {
    const query = (request.query ?? {}) as { limit?: string; offset?: string };
    const limitRaw = Number(query.limit ?? 50);
    const offsetRaw = Number(query.offset ?? 0);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;
    const offset = Number.isFinite(offsetRaw) ? Math.max(offsetRaw, 0) : 0;
    const cases = await listFreshCaptureCases();
    const items = cases.slice(offset, offset + limit).map(enrichCase);

    return {
      source: 'capture-hotfix-jsonl',
      page: {
        limit,
        offset,
        nextOffset: offset + items.length,
      },
      items,
    };
  });

  app.get('/export.csv', async (_request, reply) => {
    const csv = buildCsv(await listFreshCaptureCases());

    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', 'attachment; filename="cases.csv"');
    return csv;
  });

  app.get('/export.jsonl', async (_request, reply) => {
    const cases = await listFreshCaptureCases();
    const jsonl = cases.map((item) => JSON.stringify(item)).join('\r\n') + '\r\n';

    reply.header('content-type', 'application/x-ndjson; charset=utf-8');
    reply.header('content-disposition', 'attachment; filename="cases.jsonl"');
    return jsonl;
  });
};
