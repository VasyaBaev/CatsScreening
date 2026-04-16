/**
 * Сборка Fastify-сервера.
 *
 * Почему отдельный модуль:
 * - удобнее тестировать (можно поднять сервер без listen),
 * - проще переиспользовать в разных средах (локально / serverless / e2e).
 */

import cors from '@fastify/cors';
import Fastify from 'fastify';

import { registerRoutes } from './routes/index.js';

export type BuildServerOptions = {
  /**
   * Включать ли логирование Fastify.
   * Для dev обычно true, для тестов можно выключить.
   */
  logger?: boolean;
};

/**
 * Создаёт и настраивает Fastify‑приложение.
 */
export async function buildServer(options: BuildServerOptions = {}) {
  const app = Fastify({
    logger: options.logger ?? true
  });

  await app.register(cors, {
    origin: true
  });

  await registerRoutes(app);

  return app;
}

