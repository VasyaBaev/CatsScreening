/**
 * Кейсы capture/scoring MVP.
 *
 * В production API сохраняет кейсы в Postgres. Для локального capture site без credentials
 * включён fallback в JSONL-manifest `apps/api/storage/cases.jsonl`, чтобы заказчик мог
 * прогонять сбор пар до подключения облачной инфраструктуры.
 */

import { CreateCaseRequestSchema } from '@cats-screening/shared';
import type { Prisma } from '@prisma/client';
import type { FastifyPluginAsync } from 'fastify';

import { runQualityChecks } from '@cats-screening/cv-core';

import { appendLocalCase } from '../services/local-capture-store.js';
import { prisma } from '../services/prisma.js';

export const registerCaseRoutes: FastifyPluginAsync = async (app) => {
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
        details: parsed.error.flatten()
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
          confidence
        }
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
            uri: image.uri
          }))
        }
      }
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
        confidence
      }
    };
  });
};
