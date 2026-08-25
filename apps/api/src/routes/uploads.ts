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

import { getLocalCaptureAttempt, saveLocalAttemptUpload } from '../services/local-capture-store.js';
import {
  openLocalImageByKey,
  saveLocalAttemptImage,
  saveLocalImage,
} from '../services/local-image-storage.js';

export const registerUploadRoutes: FastifyPluginAsync = async (app) => {
  app.addContentTypeParser(
    /^image\/(jpeg|png|webp|heic|heif)$/i,
    { parseAs: 'buffer', bodyLimit: 30 * 1024 * 1024 },
    (_request, body, done) => done(null, body),
  );

  app.post('/image', async (request, reply) => {
    const parsed = UploadImageRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return {
        error: 'INVALID_UPLOAD_REQUEST',
        details: parsed.error.flatten(),
      };
    }

    const saved = await saveLocalImage(parsed.data);
    return saved;
  });

  app.put('/attempts/:attemptId/slots/:slotKey', async (request, reply) => {
    const params = request.params as { attemptId: string; slotKey: string };
    const contentType = String(request.headers['content-type'] ?? '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(contentType) || !Buffer.isBuffer(request.body)) {
      reply.code(400);
      return { error: 'INVALID_BINARY_UPLOAD' };
    }
    if (request.body.byteLength === 0) {
      reply.code(400);
      return { error: 'EMPTY_BINARY_UPLOAD' };
    }

    try {
      const attempt = await getLocalCaptureAttempt(params.attemptId);
      if (attempt.status !== 'active') {
        reply.code(409);
        return { error: 'ATTEMPT_NOT_ACTIVE' };
      }

      const slot = attempt.task.slots.find((item) => item.key === params.slotKey);
      if (!slot) {
        reply.code(404);
        return { error: 'SLOT_NOT_FOUND' };
      }
      if (slot.kind === 'diagnostic' && !attempt.reactionStartedAt) {
        reply.code(409);
        return { error: 'REACTION_NOT_STARTED' };
      }

      const encodedFileName = String(request.headers['x-file-name'] ?? `${slot.key}.jpg`);
      let fileName = encodedFileName;
      try {
        fileName = decodeURIComponent(encodedFileName);
      } catch {
        fileName = encodedFileName;
      }
      fileName = fileName.slice(0, 255) || `${slot.key}.jpg`;

      const upload = await saveLocalAttemptImage({
        attemptId: attempt.id,
        slotKey: slot.key,
        kind: slot.kind,
        fileName,
        contentType,
        buffer: request.body,
      });
      const updatedAttempt = await saveLocalAttemptUpload(attempt.id, upload);
      reply.code(201);
      return { upload, attempt: updatedAttempt };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'CAPTURE_UPLOAD_ERROR';
      if (message === 'ATTEMPT_NOT_FOUND' || message === 'SLOT_NOT_FOUND') {
        reply.code(404);
        return { error: message };
      }
      if (message === 'ATTEMPT_NOT_ACTIVE' || message === 'REACTION_NOT_STARTED') {
        reply.code(409);
        return { error: message };
      }
      throw error;
    }
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
