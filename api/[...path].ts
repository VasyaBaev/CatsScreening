/**
 * Vercel Serverless Function: прокси‑адаптер для Fastify.
 *
 * Зачем этот файл нужен:
 * - На Vercel нельзя держать “вечный” HTTP‑сервер через `listen()`.
 * - Вместо этого Vercel вызывает функцию на каждый HTTP‑запрос.
 * - Мы поднимаем Fastify‑приложение один раз (на warm‑инстансе) и
 *   прокидываем входящие `req/res` внутрь Fastify.
 *
 * Что важно понимать:
 * - При cold start Fastify создаётся заново → это нормально для serverless.
 * - Мы кешируем Promise, чтобы не пересобирать приложение в рамках одного инстанса.
 * - Маршруты внутри Fastify уже включают префикс `/api` (см. `apps/api/src/routes/index.ts`).
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

import type { FastifyInstance } from 'fastify';

import { buildServer } from '../apps/api/src/server.js';

/**
 * Кеш приложения для warm‑старта.
 * В рамках одного serverless‑инстанса Vercel переменные модуля сохраняются между запросами.
 */
let appPromise: Promise<FastifyInstance> | undefined;

/**
 * Гарантирует, что Fastify создан и готов принимать запросы.
 */
async function getApp(): Promise<FastifyInstance> {
  if (!appPromise) {
    appPromise = (async () => {
      const app = await buildServer({ logger: false });
      await app.ready();
      return app;
    })();
  }

  return appPromise;
}

/**
 * Главный handler Vercel.
 * Сигнатура использует стандартные Node.js `IncomingMessage/ServerResponse`.
 */
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const app = await getApp();

  /**
   * Защита от расхождения путей:
   * - В большинстве случаев Vercel передаёт `req.url` уже с `/api/...`.
   * - Если по какой-то причине префикс `/api` отсутствует, мы добавляем его,
   *   чтобы Fastify‑маршруты совпали.
   */
  const url = req.url ?? '/';
  if (!url.startsWith('/api')) {
    req.url = url.startsWith('/') ? `/api${url}` : `/api/${url}`;
  }

  // Передаём “сырой” Node‑запрос в HTTP‑сервер Fastify.
  app.server.emit('request', req, res);
}

