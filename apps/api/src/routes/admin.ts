/**
 * Admin API новой capture-серии.
 *
 * Новые кейсы читаются только из capture-hotfix/cases.jsonl. Legacy manifest и
 * Postgres не подмешиваются в counters/export и физически остаются нетронутыми.
 */

import type { FastifyPluginAsync } from 'fastify';

import { activeCapturePolicy } from '../config/active-capture-policy.js';
import {
  listFreshCaptureCases,
  listLocalCaptureAttempts,
  summarizeCaptureAdmin,
  type FreshCaptureCase,
} from '../services/local-capture-store.js';
import { localPublicUrlFromUri } from '../services/local-image-storage.js';

type AdminCaseListItem = Omit<FreshCaptureCase, 'images'> & {
  images: Array<FreshCaptureCase['images'][number] & { publicUrl: string | null }>;
};

function isCurrentSeriesPolicy(policy: FreshCaptureCase['policySnapshot']): boolean {
  return (
    policy?.policyId === activeCapturePolicy.policyId &&
    policy.seriesId === activeCapturePolicy.seriesId
  );
}

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
    'attemptStatus',
    'included',
    'exclusionReason',
    'policyId',
    'policyVersion',
    'policyStatus',
    'policySeriesId',
    'pairId',
    'displayLabel',
    'series',
    'taskCode',
    'taskType',
    'specimenId',
    'sourcePh',
    'referencePh',
    'finalMixturePh',
    'operatorId',
    'device',
    'deviceRole',
    'specimenMode',
    'condition.lightLabel',
    'condition.angleLabel',
    'condition.distanceLabel',
    'reactionStartedAt',
    'diagnosticSavedAt',
    'reactionElapsedSec',
    'replacesAttemptId',
    'replacedByAttemptId',
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
        item.attemptStatus,
        item.included,
        item.exclusionReason,
        item.policySnapshot?.policyId,
        item.policySnapshot?.version,
        item.policySnapshot?.status,
        item.policySnapshot?.seriesId,
        item.pairId,
        item.displayLabel,
        item.series,
        item.taskCode,
        item.taskType,
        item.specimenId,
        item.sourcePh,
        item.referencePh,
        item.finalMixturePh,
        item.operatorId,
        item.device,
        item.deviceRole,
        item.specimenMode,
        item.condition.lightLabel,
        item.condition.angleLabel,
        item.condition.distanceLabel,
        item.reactionStartedAt,
        item.diagnosticSavedAt,
        item.reactionElapsedSec,
        item.replacesAttemptId,
        item.replacedByAttemptId,
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
    const [allCases, allAttempts] = await Promise.all([
      listFreshCaptureCases(),
      listLocalCaptureAttempts(),
    ]);
    const cases = allCases.filter((item) => isCurrentSeriesPolicy(item.policySnapshot));
    const attempts = allAttempts.filter(
      (attempt) =>
        attempt.policySnapshot?.policyId === activeCapturePolicy.policyId &&
        attempt.policySnapshot.seriesId === activeCapturePolicy.seriesId,
    );
    const items = cases.slice(offset, offset + limit).map(enrichCase);

    return {
      source: 'capture-hotfix-jsonl',
      summary: summarizeCaptureAdmin(activeCapturePolicy, attempts, cases),
      page: {
        limit,
        offset,
        nextOffset: offset + items.length,
      },
      attemptHistory: attempts
        .slice()
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .map((attempt) => ({
          id: attempt.id,
          pairId: attempt.pairId ?? null,
          displayLabel: attempt.displayLabel ?? null,
          status: attempt.status,
          createdAt: attempt.createdAt,
          updatedAt: attempt.updatedAt,
          sourcePh: attempt.task.sourcePh,
          referencePh: attempt.referencePh ?? null,
          deviceRole: attempt.deviceRole ?? null,
          specimenMode: attempt.specimenMode ?? null,
          included: attempt.result?.included ?? null,
          exclusionReason: attempt.result?.exclusionReason ?? null,
          replacesAttemptId: attempt.replacesAttemptId ?? null,
          replacedByAttemptId: attempt.replacedByAttemptId ?? null,
          policyVersion: attempt.policySnapshot?.version ?? null,
        })),
      items,
    };
  });

  app.get('/export.csv', async (_request, reply) => {
    const csv = buildCsv(
      (await listFreshCaptureCases()).filter((item) => isCurrentSeriesPolicy(item.policySnapshot)),
    );

    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', 'attachment; filename="cases.csv"');
    return csv;
  });

  app.get('/export.jsonl', async (_request, reply) => {
    const cases = (await listFreshCaptureCases()).filter((item) =>
      isCurrentSeriesPolicy(item.policySnapshot),
    );
    const jsonl = cases.map((item) => JSON.stringify(item)).join('\r\n') + '\r\n';

    reply.header('content-type', 'application/x-ndjson; charset=utf-8');
    reply.header('content-disposition', 'attachment; filename="cases.jsonl"');
    return jsonl;
  });

  app.get('/export.attempts.jsonl', async (_request, reply) => {
    const attempts = (await listLocalCaptureAttempts()).filter(
      (attempt) =>
        attempt.policySnapshot?.policyId === activeCapturePolicy.policyId &&
        attempt.policySnapshot.seriesId === activeCapturePolicy.seriesId,
    );
    const jsonl = attempts.map((item) => JSON.stringify(item)).join('\r\n') + '\r\n';

    reply.header('content-type', 'application/x-ndjson; charset=utf-8');
    reply.header('content-disposition', 'attachment; filename="attempts.jsonl"');
    return jsonl;
  });
};
