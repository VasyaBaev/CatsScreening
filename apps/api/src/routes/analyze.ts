/**
 * Анализ пары изображений (reference + diagnostic) по ROI.
 *
 * Это “инженерный” эндпоинт для MVP:
 * - помогает быстро итеративно улучшать пайплайн на первых данных,
 * - позволяет руками прогонять конкретные примеры и смотреть debug.
 *
 * Важно про безопасность:
 * - сейчас эндпоинт читает файлы по локальным путям внутри репозитория (dev),
 * - в проде будем принимать object storage ключи или байты через upload.
 */

import { AnalyzeRequestSchema } from '@cats-screening/shared';
import type { FastifyPluginAsync } from 'fastify';

import {
  buildFeatureVector,
  classifyPh,
  confidenceFromKnn,
  computeDeltaFeatures,
  extractRoiFeatures,
  knnPredict,
  riskScoreFromPh,
  runQualityChecksForRoi
} from '@cats-screening/cv-core';

import { loadCalibrationModel } from '../cv/calibration.js';
import { loadImageAsRgbLocal, resolveSafeRepoPath } from '../cv/image-io.js';
import { findRepoRootAbs } from '../cv/repo-root.js';

const ALLOWED_PREFIXES = ['sources/', 'apps/api/storage/', 'data/'];

function isAllowedLocalUri(uri: string): boolean {
  return ALLOWED_PREFIXES.some((prefix) => uri.startsWith(prefix));
}

export const registerAnalyzeRoutes: FastifyPluginAsync = async (app) => {
  app.post('/', async (request, reply) => {
    const parsed = AnalyzeRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'INVALID_REQUEST', details: parsed.error.flatten() };
    }

    const body = parsed.data;
    if (!isAllowedLocalUri(body.referenceUri) || !isAllowedLocalUri(body.diagnosticUri)) {
      reply.code(400);
      return {
        error: 'UNSUPPORTED_URI',
        message: `В MVP разрешены только локальные пути внутри репозитория с префиксами: ${ALLOWED_PREFIXES.join(', ')}`
      };
    }

    const repoRootAbs = await findRepoRootAbs();

    const model = await loadCalibrationModel(repoRootAbs, {
      watchMtime: process.env.NODE_ENV !== 'production'
    });

    // В calibration model может быть dataset.targetWidth, но для API достаточно дефолта 1024.
    const targetWidth = (model as any)?.dataset?.targetWidth ?? 1024;

    const referenceAbs = resolveSafeRepoPath(repoRootAbs, body.referenceUri);
    const diagnosticAbs = resolveSafeRepoPath(repoRootAbs, body.diagnosticUri);

    const referenceImage = await loadImageAsRgbLocal(referenceAbs, { targetWidth });
    const diagnosticImage = await loadImageAsRgbLocal(diagnosticAbs, { targetWidth });

    const qc = runQualityChecksForRoi(diagnosticImage, body.roi);
    const refFeatures = extractRoiFeatures(referenceImage, body.roi);
    const diagFeatures = extractRoiFeatures(diagnosticImage, body.roi);
    const delta = computeDeltaFeatures(refFeatures, diagFeatures);
    const fv = buildFeatureVector(delta, qc);

    const pred = knnPredict(model, fv.vector);
    const predictedClass = classifyPh(pred.pHEstimate, model.normalRange);
    const score = riskScoreFromPh(pred.pHEstimate, model.normalRange);
    const confidence = confidenceFromKnn(pred.avgDistance, model, qc.flags);

    return {
      algoVersion: model.algoVersion,
      qc: qc.flags,
      qcMetrics: qc.metrics,
      result: {
        pH_estimate: pred.pHEstimate,
        predictedClass,
        score,
        confidence
      },
      debug: body.debug
        ? {
            targetWidth,
            avgDistance: pred.avgDistance,
            neighbors: pred.neighbors,
            vector: fv.vector
          }
        : undefined
    };
  });
};

