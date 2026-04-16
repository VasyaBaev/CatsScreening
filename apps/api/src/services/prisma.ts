/**
 * Prisma Client singleton.
 *
 * Почему это отдельный файл:
 * - PrismaClient тяжёлый объект (держит пул соединений и загружает engine).
 * - В serverless‑среде (например, Vercel) важно переиспользовать клиент на warm‑инстансе,
 *   чтобы не плодить подключения и не замедлять каждый запрос.
 *
 * Как это работает:
 * - На dev окружении сохраняем PrismaClient в `globalThis`, чтобы при hot-reload/tsx watch
 *   не создавать новые клиенты на каждый перезапуск модулей.
 * - В production полагаемся на кеширование модулей рантаймом (warm starts).
 */

import { PrismaClient } from '@prisma/client';

type GlobalWithPrisma = typeof globalThis & {
  __catsScreeningPrisma?: PrismaClient;
};

const globalForPrisma = globalThis as GlobalWithPrisma;

/**
 * Экземпляр PrismaClient для всего приложения.
 */
export const prisma =
  globalForPrisma.__catsScreeningPrisma ??
  new PrismaClient({
    /**
     * Логи Prisma полезны на отладке, но могут шуметь в serverless.
     * Поэтому включаем минимально.
     */
    log: ['error', 'warn']
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__catsScreeningPrisma = prisma;
}

