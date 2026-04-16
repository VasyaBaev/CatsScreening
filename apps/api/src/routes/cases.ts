/**
 * Кейсы (MVP).
 *
 * На Этапе 1 кейс — это:
 * - анкета/метаданные,
 * - эталонное фото (reference),
 * - диагностическое фото (diagnostic),
 * - результат скрининга: score + confidence + QC-флаги.
 */

import { CreateCaseRequestSchema } from '@cats-screening/shared';
import type { FastifyPluginAsync } from 'fastify';

import { runQualityChecks } from '@cats-screening/cv-core';

import { prisma } from '../services/prisma.js';

export const registerCaseRoutes: FastifyPluginAsync = async (app) => {
  /**
   * Создать кейс.
   *
   * В MVP пока принимаем JSON с URI изображений.
   * Позже добавим нормальную загрузку (через object storage) и сохранение в БД.
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

    if (!process.env.DATABASE_URL) {
      reply.code(500);
      return {
        error: 'DATABASE_NOT_CONFIGURED',
        message: 'Не задана переменная окружения DATABASE_URL (Postgres).'
      };
    }

    // Заглушка QC/скоринга: инфраструктура готова, алгоритм подключим далее.
    const qc = runQualityChecks();
    const score = 0.5;
    const confidence = 0.0;

    /**
     * Сохраняем кейс в БД.
     *
     * Важно:
     * - изображения здесь представлены URI/ключами (object storage подключим далее),
     * - метаданные храним как JSON (удобно уточнять поля без миграций на каждом шаге),
     * - score/confidence пока заглушки.
     */
    const createdCase = await prisma.case.create({
      data: {
        metadata: parsed.data.metadata,
        qc,
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
      qc,
      result: {
        /**
         * score: 0..1, где ближе к 1 = выше вероятность отклонения/риска.
         * Сейчас значение фиксированное (заглушка).
         */
        score,
        /** confidence: 0..1, насколько алгоритм уверен. */
        confidence
      }
    };
  });
};
