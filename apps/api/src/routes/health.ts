/**
 * Health-check эндпоинты.
 * Нужны для:
 * - проверки, что сервер жив,
 * - будущих деплой‑проверок (например, на Vercel).
 */

import type { FastifyPluginAsync } from 'fastify';

export const registerHealthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', async () => {
    return { ok: true };
  });
};

