/**
 * API ручной ROI-разметки.
 *
 * Маршруты нужны для вкладки `Разметка ROI`: оператор размечает области
 * наполнителя в V5-V8, а backend сохраняет их в локальный JSON-файл для
 * последующего пересчета признаков и обучения.
 */

import {
  CaseMetadataSchema,
  SaveRoiLabelRequestSchema,
  derivePhBand,
  type CaseMetadata,
  type CaseRoiSet,
  type PhBand,
} from '@cats-screening/shared';
import type { FastifyPluginAsync } from 'fastify';

import { listAllLocalCases, type LocalStoredCase } from '../services/local-capture-store.js';
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

function parseMetadata(metadata: unknown): CaseMetadata | null {
  const parsed = CaseMetadataSchema.safeParse(metadata);
  return parsed.success ? parsed.data : null;
}

function isV9Capture(metadata: CaseMetadata | null): boolean {
  return metadata?.series?.trim().toUpperCase() === 'V9';
}

function imageUrl(item: LocalStoredCase, kind: 'reference' | 'diagnostic'): string | null {
  const image = item.images.find((candidate) => candidate.kind === kind);
  if (!image) return null;
  return localPublicUrlFromUri(image.uri);
}

function diagnosticPh(metadata: CaseMetadata): number {
  return metadata.diagnosticPh ?? metadata.pH ?? metadata.referencePh ?? 6.13;
}

function diagnosticZone(metadata: CaseMetadata, ph: number): PhBand {
  return metadata.diagnosticBand ?? derivePhBand(ph);
}

function qcWarnings(qc: unknown): string[] {
  if (!qc || typeof qc !== 'object') return [];

  const flags = qc as Partial<Record<'blur' | 'glare' | 'dark', unknown>>;
  const warnings: string[] = [];
  if (flags.blur === true) warnings.push('blur');
  if (flags.glare === true) warnings.push('glare');
  if (flags.dark === true) warnings.push('dark');
  return warnings;
}

function toV9RoiPair(item: LocalStoredCase): V9RoiPair | null {
  const metadata = parseMetadata(item.metadata);
  if (!metadata || !isV9Capture(metadata)) return null;

  const referenceUrl = imageUrl(item, 'reference');
  const diagnosticUrl = imageUrl(item, 'diagnostic');
  if (!referenceUrl || !diagnosticUrl) return null;

  const ph = diagnosticPh(metadata);

  return {
    id: metadata.pairId ?? item.id,
    caseId: item.id,
    labelDataset: 'v9',
    kind: metadata.condition?.angleLabel ?? 'production_like',
    device: metadata.device ?? 'unknown',
    lightCct: metadata.condition?.lightLabel ?? metadata.light,
    pH: ph,
    zone: diagnosticZone(metadata, ph),
    sourceVersion: 'V9',
    captureDeltaSec: metadata.capture?.captureDeltaSeconds ?? null,
    warnings: qcWarnings(item.qc),
    referenceUrl,
    diagnosticUrl,
    features: {},
    initialRois: metadata.rois,
    createdAt: item.createdAt,
    operatorId: metadata.operatorId ?? null,
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

    const cases = await listAllLocalCases();
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
