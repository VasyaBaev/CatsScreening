/**
 * Админские эндпоинты (MVP).
 *
 * Зачем они нужны:
 * - показать Заказчику/команде список кейсов,
 * - дать возможность выгрузить кейсы в CSV,
 * - иметь быстрый “операторский” взгляд на данные до полноценной админки.
 *
 * Важно про безопасность:
 * - Сейчас эндпоинты НЕ защищены авторизацией.
 * - На проде это обязательно нужно закрыть (хотя бы shared secret / basic auth / allowlist).
 */

import { CaseMetadataSchema } from '@cats-screening/shared';
import type { FastifyPluginAsync } from 'fastify';

import { prisma } from '../services/prisma.js';

type CaseListItem = {
  id: string;
  createdAt: string;
  score: number | null;
  confidence: number | null;
  metadata: unknown;
  qc: unknown;
  images: Array<{ kind: string; uri: string }>;
};

/**
 * Безопасное преобразование значения в CSV‑ячейку.
 * - Экранирует кавычки.
 * - Оборачивает значение в кавычки при наличии запятых/переносов строк.
 */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';

  const text = String(value);
  const needsQuotes = /[",\r\n]/.test(text);
  const escaped = text.replaceAll('"', '""');
  return needsQuotes ? `"${escaped}"` : escaped;
}

/**
 * Пытаемся привести метаданные к ожидаемой схеме.
 * Если схема не совпала (например, старые записи/эксперименты) — возвращаем исходный JSON,
 * чтобы данные не терялись на чтении.
 */
function normalizeMetadata(metadata: unknown): unknown {
  const parsed = CaseMetadataSchema.safeParse(metadata);
  return parsed.success ? parsed.data : metadata;
}

export const registerAdminRoutes: FastifyPluginAsync = async (app) => {
  /**
   * Список кейсов (простая пагинация offset/limit).
   */
  app.get('/cases', async (request, reply) => {
    if (!process.env.DATABASE_URL) {
      reply.code(500);
      return {
        error: 'DATABASE_NOT_CONFIGURED',
        message: 'Не задана переменная окружения DATABASE_URL (Postgres).'
      };
    }

    const query = (request.query ?? {}) as { limit?: string; offset?: string };
    const limitRaw = Number(query.limit ?? 50);
    const offsetRaw = Number(query.offset ?? 0);

    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;
    const offset = Number.isFinite(offsetRaw) ? Math.max(offsetRaw, 0) : 0;

    const cases = await prisma.case.findMany({
      take: limit,
      skip: offset,
      orderBy: { createdAt: 'desc' },
      include: { images: true }
    });

    const items = cases.map((c): CaseListItem => {
      return {
        id: c.id,
        createdAt: c.createdAt.toISOString(),
        score: c.score,
        confidence: c.confidence,
        metadata: normalizeMetadata(c.metadata),
        qc: c.qc,
        images: c.images.map((img) => ({ kind: img.kind, uri: img.uri }))
      };
    });

    return {
      page: {
        limit,
        offset,
        nextOffset: offset + items.length
      },
      items
    };
  });

  /**
   * Выгрузка CSV.
   *
   * Примечание:
   * - CSV рассчитан на простую выгрузку в Excel/Google Sheets.
   * - Для больших объёмов данных нужен streaming и/или генерация по батчам.
   */
  app.get('/export.csv', async (_request, reply) => {
    if (!process.env.DATABASE_URL) {
      reply.code(500);
      return {
        error: 'DATABASE_NOT_CONFIGURED',
        message: 'Не задана переменная окружения DATABASE_URL (Postgres).'
      };
    }

    const cases = await prisma.case.findMany({
      orderBy: { createdAt: 'desc' },
      include: { images: true }
    });

    const header = [
      'id',
      'createdAt',
      'score',
      'confidence',
      'tray',
      'light',
      'location',
      'pH',
      'class',
      'qc.blur',
      'qc.glare',
      'qc.dark',
      'reference.uri',
      'diagnostic.uri'
    ];

    const lines: string[] = [];
    lines.push(header.join(','));

    for (const c of cases) {
      const metadata = normalizeMetadata(c.metadata) as any;
      const tray = metadata?.tray ?? '';
      const light = metadata?.light ?? '';
      const location = metadata?.location ?? '';
      const pH = metadata?.pH ?? '';
      const cls = metadata?.class ?? '';

      const qc = (c.qc ?? {}) as any;
      const blur = qc?.blur ?? '';
      const glare = qc?.glare ?? '';
      const dark = qc?.dark ?? '';

      const ref = c.images.find((i) => i.kind === 'reference')?.uri ?? '';
      const diag = c.images.find((i) => i.kind === 'diagnostic')?.uri ?? '';

      const row = [
        c.id,
        c.createdAt.toISOString(),
        c.score ?? '',
        c.confidence ?? '',
        tray,
        light,
        location,
        pH,
        cls,
        blur,
        glare,
        dark,
        ref,
        diag
      ].map(csvCell);

      lines.push(row.join(','));
    }

    const csv = lines.join('\r\n') + '\r\n';

    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', 'attachment; filename=\"cases.csv\"');
    return csv;
  });
};

