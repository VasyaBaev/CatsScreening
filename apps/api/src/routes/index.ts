/**
 * Реестр маршрутов API.
 * Здесь собираем все плагины Fastify в одном месте, чтобы структура была очевидной.
 */

import type { FastifyInstance } from 'fastify';

import { registerAdminRoutes } from './admin.js';
import { registerAnalyzeRoutes } from './analyze.js';
import { registerCaseRoutes } from './cases.js';
import { registerHealthRoutes } from './health.js';

export async function registerRoutes(app: FastifyInstance) {
  // На фронте и в деплое удобнее иметь единый префикс `/api`.
  await app.register(registerHealthRoutes, { prefix: '/api' });
  await app.register(registerAnalyzeRoutes, { prefix: '/api/analyze' });
  await app.register(registerCaseRoutes, { prefix: '/api/cases' });
  await app.register(registerAdminRoutes, { prefix: '/api/admin' });
}
