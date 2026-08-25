/**
 * Кейсы capture/scoring MVP.
 *
 * В production API сохраняет кейсы в Postgres. Для локального capture site без credentials
 * включён fallback в JSONL-manifest `apps/api/storage/cases.jsonl`, чтобы заказчик мог
 * прогонять сбор пар до подключения облачной инфраструктуры.
 */

import {
  CaptureContextQuerySchema,
  CreateCaptureReplacementRequestSchema,
  CreateCaseRequestSchema,
  CreatePolicyCaptureAttemptRequestSchema,
  FinalizeCaptureAttemptRequestSchema,
  UpdateCaptureSlotRequestSchema,
} from '@cats-screening/shared';
import type { Prisma } from '@prisma/client';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';

import { runQualityChecks } from '@cats-screening/cv-core';

import { activeCapturePolicy } from '../config/active-capture-policy.js';
import {
  appendLocalCase,
  createPolicyCaptureAttempt,
  finalizeLocalCaptureAttempt,
  getLocalCaptureContext,
  getLocalCaptureAttempt,
  getLocalCaptureAttemptByClientRequestId,
  replaceLocalCaptureAttempt,
  saveLocalAttemptSlotRoi,
  startLocalCaptureReaction,
} from '../services/local-capture-store.js';
import { prisma } from '../services/prisma.js';

function storeError(reply: FastifyReply, error: unknown) {
  const message = error instanceof Error ? error.message : 'CAPTURE_STORE_ERROR';
  if (
    message === 'ATTEMPT_NOT_FOUND' ||
    message === 'SLOT_NOT_FOUND' ||
    message === 'SHARED_SPECIMEN_NOT_FOUND'
  ) {
    reply.code(404);
  } else if (
    message === 'ATTEMPT_FINALIZED' ||
    message === 'ATTEMPT_NOT_ACTIVE' ||
    message === 'ATTEMPT_NOT_REPLACEABLE' ||
    message === 'SLOT_UPLOAD_NOT_FOUND' ||
    message === 'CAPTURE_POLICY_DRAFT' ||
    message === 'CAPTURE_POLICY_MISMATCH' ||
    message === 'CAPTURE_QUOTA_FULL' ||
    message === 'SHARED_SPECIMEN_ROLE_COMPLETE' ||
    message === 'REFERENCE_LOCKED_AFTER_REACTION' ||
    message === 'REFERENCE_ROI_LOCKED_UNTIL_DIAGNOSTIC' ||
    message === 'DIAGNOSTIC_LOCKED_AFTER_UPLOAD' ||
    message === 'REACTION_NOT_STARTED' ||
    message === 'REFERENCE_UPLOAD_REQUIRED' ||
    message === 'FINAL_MIXTURE_PH_REQUIRED' ||
    message.startsWith('REQUIRED_SLOTS_MISSING:') ||
    message.startsWith('REQUIRED_ROIS_MISSING:') ||
    message.startsWith('POLYGON_ROIS_REQUIRED:')
  ) {
    reply.code(409);
  } else if (
    message.endsWith('_NOT_ALLOWED') ||
    message === 'CAPTURE_QUOTA_NOT_DECLARED' ||
    message === 'SHARED_SPECIMEN_PH_MISMATCH' ||
    message === 'REPLACEMENT_DEVICE_ROLE_MISMATCH' ||
    message === 'SAME_SPECIMEN_MODE_MISMATCH' ||
    message === 'SAME_SPECIMEN_PH_MISMATCH'
  ) {
    reply.code(400);
  } else {
    throw error;
  }

  return {
    error: message.split(':')[0],
    missingSlots: message.startsWith('REQUIRED_SLOTS_MISSING:')
      ? message.slice(message.indexOf(':') + 1).split(',')
      : undefined,
    missingRois:
      message.startsWith('REQUIRED_ROIS_MISSING:') || message.startsWith('POLYGON_ROIS_REQUIRED:')
        ? message.slice(message.indexOf(':') + 1).split(',')
        : undefined,
  };
}

export const registerCaseRoutes: FastifyPluginAsync = async (app) => {
  app.get('/context', async (request, reply) => {
    const parsed = CaptureContextQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      reply.code(400);
      return { error: 'INVALID_CAPTURE_CONTEXT_QUERY', details: parsed.error.flatten() };
    }
    return getLocalCaptureContext(activeCapturePolicy, parsed.data);
  });

  app.post('/attempts', async (request, reply) => {
    const parsed = CreatePolicyCaptureAttemptRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'INVALID_ATTEMPT_REQUEST', details: parsed.error.flatten() };
    }

    const clientRequestId = request.headers['x-capture-request-id'];
    if (
      typeof clientRequestId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        clientRequestId,
      )
    ) {
      reply.code(400);
      return { error: 'INVALID_CAPTURE_REQUEST_ID' };
    }

    try {
      const attempt = await createPolicyCaptureAttempt(
        activeCapturePolicy,
        parsed.data,
        clientRequestId,
      );
      reply.code(201);
      return { attempt };
    } catch (error) {
      const response = storeError(reply, error);
      if (response.error === 'CAPTURE_POLICY_DRAFT') {
        return { ...response, message: activeCapturePolicy.instruction };
      }
      return response;
    }
  });

  app.get('/attempts/by-client-request/:clientRequestId', async (request, reply) => {
    const params = request.params as { clientRequestId: string };
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        params.clientRequestId,
      )
    ) {
      reply.code(400);
      return { error: 'INVALID_CAPTURE_REQUEST_ID' };
    }
    try {
      return {
        attempt: await getLocalCaptureAttemptByClientRequestId(
          activeCapturePolicy,
          params.clientRequestId,
        ),
      };
    } catch (error) {
      return storeError(reply, error);
    }
  });

  app.get('/attempts/:attemptId', async (request, reply) => {
    const params = request.params as { attemptId: string };
    try {
      return { attempt: await getLocalCaptureAttempt(params.attemptId) };
    } catch (error) {
      return storeError(reply, error);
    }
  });

  app.post('/attempts/:attemptId/reaction/start', async (request, reply) => {
    const params = request.params as { attemptId: string };
    try {
      return { attempt: await startLocalCaptureReaction(params.attemptId) };
    } catch (error) {
      return storeError(reply, error);
    }
  });

  app.post('/attempts/:attemptId/replacement', async (request, reply) => {
    const params = request.params as { attemptId: string };
    const parsed = CreateCaptureReplacementRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'INVALID_REPLACEMENT_REQUEST', details: parsed.error.flatten() };
    }

    try {
      const replacement = await replaceLocalCaptureAttempt(
        activeCapturePolicy,
        params.attemptId,
        parsed.data,
      );
      reply.code(201);
      return replacement;
    } catch (error) {
      return storeError(reply, error);
    }
  });

  app.patch('/attempts/:attemptId/slots/:slotKey', async (request, reply) => {
    const params = request.params as { attemptId: string; slotKey: string };
    const parsed = UpdateCaptureSlotRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'INVALID_SLOT_REQUEST', details: parsed.error.flatten() };
    }

    try {
      return {
        attempt: await saveLocalAttemptSlotRoi(params.attemptId, params.slotKey, parsed.data.roi),
      };
    } catch (error) {
      return storeError(reply, error);
    }
  });

  app.post('/attempts/:attemptId/finalize', async (request, reply) => {
    const params = request.params as { attemptId: string };
    const parsed = FinalizeCaptureAttemptRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'INVALID_FINALIZE_REQUEST', details: parsed.error.flatten() };
    }

    try {
      const attempt = await finalizeLocalCaptureAttempt(params.attemptId, parsed.data);
      return { attempt, result: attempt.result };
    } catch (error) {
      return storeError(reply, error);
    }
  });

  /**
   * Создать кейс.
   *
   * Изображения уже должны быть загружены отдельно и переданы как `uri`.
   * Это сохраняет один и тот же контракт для local storage, Cloudflare R2 и Vercel Blob.
   */
  app.post('/', async (request, reply) => {
    const parsed = CreateCaseRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return {
        error: 'INVALID_REQUEST',
        details: parsed.error.flatten(),
      };
    }

    // Заглушка QC/скоринга: инфраструктура готова, production-модель подключим позже.
    const qc = runQualityChecks();
    const score = 0.5;
    const confidence = 0.0;

    if (!process.env.DATABASE_URL) {
      const createdCase = await appendLocalCase(parsed.data, qc, score, confidence);

      return {
        id: createdCase.id,
        storage: 'local-jsonl',
        qc,
        result: {
          score,
          confidence,
        },
      };
    }

    /**
     * Сохраняем кейс в БД.
     * Метаданные остаются JSON, потому что production-like поля будут уточняться
     * итеративно без миграции схемы на каждую правку capture-протокола.
     */
    if (!prisma) {
      throw new Error('DATABASE_URL не задан, Prisma client недоступен');
    }

    const createdCase = await prisma.case.create({
      data: {
        metadata: parsed.data.metadata as Prisma.InputJsonValue,
        qc: qc as Prisma.InputJsonValue,
        score,
        confidence,
        images: {
          create: parsed.data.images.map((image) => ({
            kind: image.kind,
            uri: image.uri,
          })),
        },
      },
    });

    return {
      id: createdCase.id,
      storage: 'postgres',
      qc,
      result: {
        /**
         * score: 0..1, где ближе к 1 = выше вероятность отклонения/риска.
         * Сейчас значение фиксированное, чтобы не создавать ложное ожидание готовой модели.
         */
        score,
        /** confidence: 0..1, насколько алгоритм уверен. */
        confidence,
      },
    };
  });
};
