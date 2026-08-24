/**
 * API ручной ROI-разметки.
 *
 * Маршруты нужны для вкладки `Разметка ROI`: оператор размечает области
 * наполнителя в V5-V8, а backend сохраняет их в локальный JSON-файл для
 * последующего пересчета признаков и обучения.
 */

import {
  SaveRoiLabelRequestSchema,
  derivePhBand,
  type CaseRoiSet,
  type PhBand,
} from '@cats-screening/shared';
import type { FastifyPluginAsync } from 'fastify';

import { listFreshCaptureCases, type FreshCaptureCase } from '../services/local-capture-store.js';
import { localPublicUrlFromUri } from '../services/local-image-storage.js';
import { readLocalRoiLabels, saveLocalRoiLabel } from '../services/local-roi-label-store.js';
import { requireRoiAuth, roiAuthUser } from '../services/roi-auth.js';

type V9RoiPair = {
  id: string;
  caseId: string;
  labelDataset: 'v9';
  kind: string;
  device: string;
  lightCct: string;
  pH: number;
  zone: PhBand;
  sourceVersion: 'V9';
  captureDeltaSec: number | null;
  warnings: string[];
  referenceUrl: string;
  diagnosticUrl: string;
  features: Record<string, never>;
  initialRois?: CaseRoiSet;
  createdAt: string;
  operatorId: string | null;
};

type FreshImage = FreshCaptureCase['images'][number];

function captureDeltaSeconds(reference: FreshImage, diagnostic: FreshImage): number | null {
  const milliseconds =
    new Date(diagnostic.savedAt).getTime() - new Date(reference.savedAt).getTime();
  return Number.isFinite(milliseconds) ? Math.max(0, Math.round(milliseconds / 1000)) : null;
}

function initialRois(reference: FreshImage, diagnostic: FreshImage): CaseRoiSet | undefined {
  if (!reference.roi || !diagnostic.roi) return undefined;
  return { reference: reference.roi, diagnostic: diagnostic.roi };
}

function toV9RoiPair(item: FreshCaptureCase): V9RoiPair | null {
  const reference = item.images.find((image) => image.kind === 'reference');
  const diagnostic =
    item.images.find((image) => image.kind === 'diagnostic') ??
    item.images.find((image) => image.kind === 'qc');
  if (!reference || !diagnostic) return null;

  const referenceUrl = localPublicUrlFromUri(reference.uri);
  const diagnosticUrl = localPublicUrlFromUri(diagnostic.uri);
  if (!referenceUrl || !diagnosticUrl) return null;

  return {
    id: item.id,
    caseId: item.id,
    labelDataset: 'v9',
    kind: item.taskType === 'blank_qc' ? 'blank_qc' : item.condition.angleLabel,
    device: item.device,
    lightCct: item.condition.lightLabel,
    pH: item.sourcePh,
    zone: derivePhBand(item.sourcePh),
    sourceVersion: 'V9',
    captureDeltaSec: captureDeltaSeconds(reference, diagnostic),
    warnings: item.included ? [] : ['excluded'],
    referenceUrl,
    diagnosticUrl,
    features: {},
    initialRois: initialRois(reference, diagnostic),
    createdAt: item.createdAt,
    operatorId: item.operatorId,
  };
}

export const registerRoiLabelRoutes: FastifyPluginAsync = async (app) => {
  app.get('/auth/check', async (request, reply) => {
    if (!requireRoiAuth(request, reply)) {
      return {
        error: 'UNAUTHORIZED',
      };
    }

    return {
      ok: true,
      user: roiAuthUser(),
    };
  });

  app.get('/v5-v8', async (request, reply) => {
    if (!requireRoiAuth(request, reply)) {
      return {
        error: 'UNAUTHORIZED',
      };
    }

    return readLocalRoiLabels();
  });

  app.get('/v9/cases', async (request, reply) => {
    if (!requireRoiAuth(request, reply)) {
      return {
        error: 'UNAUTHORIZED',
      };
    }

    const cases = await listFreshCaptureCases();
    const pairs = cases.flatMap((item) => {
      const pair = toV9RoiPair(item);
      return pair ? [pair] : [];
    });

    return {
      version: 1,
      dataset: 'v9',
      generatedAt: new Date().toISOString(),
      pairs,
    };
  });

  app.get('/v5-v8/export.json', async (request, reply) => {
    if (!requireRoiAuth(request, reply)) {
      return {
        error: 'UNAUTHORIZED',
      };
    }

    const labels = await readLocalRoiLabels();

    reply.header('content-type', 'application/json; charset=utf-8');
    reply.header('content-disposition', 'attachment; filename="roi-labels-v5-v8.json"');
    return labels;
  });

  app.put('/v5-v8/:pairId', async (request, reply) => {
    if (!requireRoiAuth(request, reply)) {
      return {
        error: 'UNAUTHORIZED',
      };
    }

    const params = request.params as { pairId?: string };
    const body = request.body && typeof request.body === 'object' ? request.body : {};
    const parsed = SaveRoiLabelRequestSchema.safeParse({
      ...(body as Record<string, unknown>),
      pairId: params.pairId,
    });

    if (!parsed.success) {
      reply.code(400);
      return {
        error: 'INVALID_ROI_LABEL',
        details: parsed.error.flatten(),
      };
    }

    const label = await saveLocalRoiLabel(parsed.data);
    return { label };
  });
};
