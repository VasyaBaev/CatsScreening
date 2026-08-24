/**
 * Upload endpoints для capture-MVP.
 *
 * Сейчас endpoint сохраняет изображения в локальное файловое хранилище, чтобы
 * production-like capture flow можно было запускать без облачных credentials.
 * После подключения Cloudflare R2/Vercel Blob контракт ответа сохраняется тем же:
 * UI получает `uri`, а `/api/cases` сохраняет его в manifest/БД.
 */

import { UploadImageRequestSchema } from '@cats-screening/shared';
import type { FastifyPluginAsync } from 'fastify';

import { openLocalImageByKey, saveLocalImage } from '../services/local-image-storage.js';

export const registerUploadRoutes: FastifyPluginAsync = async (app) => {
  app.post('/image', async (request, reply) => {
    const parsed = UploadImageRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return {
        error: 'INVALID_UPLOAD_REQUEST',
        details: parsed.error.flatten()
      };
    }

    const saved = await saveLocalImage(parsed.data);
    return saved;
  });

  app.get('/local/*', async (request, reply) => {
    const params = request.params as { '*': string };
    const key = decodeURIComponent(params['*'] ?? '');

    try {
      const image = await openLocalImageByKey(key);
      reply.header('content-type', image.contentType);
      return reply.send(image.stream);
    } catch (error) {
      request.log.warn({ err: error, key }, 'Не удалось открыть локальное изображение');
      reply.code(404);
      return { error: 'LOCAL_IMAGE_NOT_FOUND' };
    }
  });
};
