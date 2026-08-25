/**
 * Кейсы capture/scoring MVP.
 *
 * В production API сохраняет кейсы в Postgres. Для локального capture site без credentials
 * включён fallback в JSONL-manifest `apps/api/storage/cases.jsonl`, чтобы заказчик мог
 * прогонять сбор пар до подключения облачной инфраструктуры.
 */

import {
  CaptureContextQuerySchema,
  CaptureTaskSchema,
  CreateCaseRequestSchema,
  CreatePolicyCaptureAttemptRequestSchema,
  FinalizeCaptureAttemptRequestSchema,
  UpdateCaptureSlotRequestSchema,
  type CaptureTask,
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
  saveLocalAttemptSlotRoi,
} from '../services/local-capture-store.js';
import { prisma } from '../services/prisma.js';

const reactedSlots = [
  {
    key: 'reference',
    kind: 'reference' as const,
    label: 'До реакции',
    required: true,
    targetSeconds: null,
    toleranceSeconds: null,
  },
  {
    key: 'diagnostic',
    kind: 'diagnostic' as const,
    label: 'После реакции',
    required: true,
    targetSeconds: null,
    toleranceSeconds: null,
  },
];

function reactedTask(code: string, sourcePh: number): CaptureTask {
  return CaptureTaskSchema.parse({
    code,
    taskType: 'reacted_specimen',
    specimenId: `specimen-${code.toLowerCase()}`,
    sourcePh,
    slots: reactedSlots,
  });
}

const tasks = new Map<string, CaptureTask>(
  [
    reactedTask('PH400', 4.0),
    reactedTask('PH460', 4.6),
    reactedTask('PH540', 5.4),
    reactedTask('PH560', 5.6),
    reactedTask('PH580', 5.8),
    reactedTask('PH600', 6.0),
    reactedTask('PH613', 6.13),
    reactedTask('PH640', 6.4),
    reactedTask('PH660', 6.6),
    reactedTask('PH680', 6.8),
    reactedTask('PH700', 7.0),
    reactedTask('PH780', 7.8),
    CaptureTaskSchema.parse({
      code: 'BL613',
      taskType: 'blank_qc',
      specimenId: 'blank-ph-613',
      sourcePh: 6.13,
      slots: [
        {
          key: 'reference',
          kind: 'reference',
          label: 'Blank — исходный кадр',
          required: true,
          targetSeconds: null,
          toleranceSeconds: null,
        },
        {
          key: 'blank_qc',
          kind: 'qc',
          label: 'Blank QC pH 6.13',
          required: true,
          targetSeconds: null,
          toleranceSeconds: null,
        },
      ],
    }),
  ].map((task) => [task.code, task]),
);

function taskByCode(code: string): CaptureTask | null {
  const normalized = code.trim().toUpperCase();
  const direct = tasks.get(normalized);
  if (direct) return direct;

  const match =
    /^(PH(?:400|460|540|560|580|600|613|640|660|680|700|780)|BL613)-([A-Z0-9]{1,12})$/.exec(
      normalized,
    );
  if (!match) return null;

  const baseTask = tasks.get(match[1]);
  if (!baseTask) return null;
  return CaptureTaskSchema.parse({
    ...baseTask,
    code: normalized,
    specimenId: `${baseTask.taskType === 'blank_qc' ? 'blank' : 'specimen'}-${normalized.toLowerCase()}`,
  });
}

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
    message === 'SLOT_UPLOAD_NOT_FOUND' ||
    message === 'CAPTURE_POLICY_DRAFT' ||
    message === 'CAPTURE_QUOTA_FULL' ||
    message === 'SHARED_SPECIMEN_ROLE_COMPLETE' ||
    message.startsWith('REQUIRED_SLOTS_MISSING:')
  ) {
    reply.code(409);
  } else if (
    message.endsWith('_NOT_ALLOWED') ||
    message === 'CAPTURE_QUOTA_NOT_DECLARED' ||
    message === 'SHARED_SPECIMEN_PH_MISMATCH'
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

  app.get('/tasks/:code', async (request, reply) => {
    const params = request.params as { code: string };
    const task = taskByCode(params.code);
    if (!task) {
      reply.code(404);
      return { error: 'TASK_NOT_FOUND' };
    }
    return { task };
  });

  app.post('/attempts', async (request, reply) => {
    const parsed = CreatePolicyCaptureAttemptRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'INVALID_ATTEMPT_REQUEST', details: parsed.error.flatten() };
    }

    try {
      const attempt = await createPolicyCaptureAttempt(activeCapturePolicy, parsed.data);
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

  app.get('/attempts/:attemptId', async (request, reply) => {
    const params = request.params as { attemptId: string };
    try {
      return { attempt: await getLocalCaptureAttempt(params.attemptId) };
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
