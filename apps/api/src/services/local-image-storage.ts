/**
 * Локальное файловое хранилище изображений для capture-MVP.
 *
 * Почему отдельный сервис:
 * - локально сайт должен работать без Cloudflare/Vercel credentials;
 * - в production этот модуль можно заменить adapter'ом object storage;
 * - API и UI при этом продолжают обмениваться теми же `uri` и `publicUrl`.
 */

import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

import type { UploadImageRequest, UploadImageResponse } from '@cats-screening/shared';

const defaultStorageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../storage');
const storageRoot = process.env.LOCAL_CAPTURE_STORAGE_DIR
  ? path.resolve(process.env.LOCAL_CAPTURE_STORAGE_DIR)
  : defaultStorageRoot;
const uploadRoot = path.join(storageRoot, 'uploads');

function sanitizeSegment(value: string): string {
  const safe = value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  return safe || 'item';
}

function extensionForContentType(contentType: string): string {
  if (contentType === 'image/png') return '.png';
  if (contentType === 'image/webp') return '.webp';
  return '.jpg';
}

function normalizeStorageKey(key: string): string {
  return key.replaceAll('\\', '/').replace(/^\/+/, '');
}

function resolveInsideStorage(key: string): string {
  const normalized = normalizeStorageKey(key);
  const absolute = path.resolve(storageRoot, normalized);

  if (!absolute.startsWith(storageRoot + path.sep) && absolute !== storageRoot) {
    throw new Error('LOCAL_STORAGE_PATH_ESCAPE');
  }

  return absolute;
}

export function localPublicUrlFromUri(uri: string): string | null {
  if (!uri.startsWith('local://')) return null;
  const key = normalizeStorageKey(uri.slice('local://'.length));
  return `/api/uploads/local/${encodeURIComponent(key).replaceAll('%2F', '/')}`;
}

export async function saveLocalImage(input: UploadImageRequest): Promise<UploadImageResponse> {
  const pairId = sanitizeSegment(input.pairId);
  const ext = extensionForContentType(input.contentType);
  const fileName = `${input.kind}-${Date.now()}-${randomUUID().slice(0, 8)}${ext}`;
  const key = normalizeStorageKey(path.posix.join('uploads', pairId, fileName));
  const absolutePath = resolveInsideStorage(key);

  await mkdir(path.dirname(absolutePath), { recursive: true });

  const buffer = Buffer.from(input.dataBase64, 'base64');
  await writeFile(absolutePath, buffer);

  const uri = `local://${key}`;

  return {
    uri,
    publicUrl: localPublicUrlFromUri(uri),
    storageProvider: 'local-file',
    bytes: buffer.byteLength,
    contentType: input.contentType
  };
}

export async function openLocalImageByKey(key: string) {
  const absolutePath = resolveInsideStorage(key);
  const info = await stat(absolutePath);

  if (!info.isFile()) {
    throw new Error('LOCAL_STORAGE_NOT_FILE');
  }

  const ext = path.extname(absolutePath).toLowerCase();
  const contentType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';

  return {
    contentType,
    stream: createReadStream(absolutePath)
  };
}
