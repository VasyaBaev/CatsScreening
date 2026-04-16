/**
 * Точка входа для локального запуска API.
 *
 * Важно:
 * - в проде (Vercel) может быть другой entrypoint/adapter,
 * - но локально удобно поднимать обычный HTTP‑сервер.
 */

import { buildServer } from './server.js';

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? '127.0.0.1';

const app = await buildServer({ logger: true });

await app.listen({ port, host });
app.log.info({ host, port }, 'API запущен');

