/**
 * Node-часть CV: чтение изображений с диска и перевод в `RgbImage` для `cv-core`.
 *
 * Важно:
 * - это DEV-инструмент и инфраструктура для первых шагов,
 * - в проде вероятнее всего будем читать изображения из object storage (Blob/S3),
 *   а не из локальной ФС.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';

import type { RgbImage } from '@cats-screening/cv-core';

export type LoadImageOptions = {
  targetWidth?: number;
};

/**
 * Разрешает путь к локальному файлу “безопасно”:
 * - запрещаем абсолютные пути (чтобы случайно не дать читать что угодно на машине),
 * - разрешаем только пути внутри репозитория,
 * - возвращаем абсолютный путь.
 */
export function resolveSafeRepoPath(repoRootAbs: string, relPath: string): string {
  if (path.isAbsolute(relPath)) {
    throw new Error(`Абсолютные пути запрещены: ${relPath}`);
  }

  const abs = path.resolve(repoRootAbs, relPath);
  const normalizedRoot = path.resolve(repoRootAbs) + path.sep;
  const normalizedAbs = path.resolve(abs);

  if (!normalizedAbs.startsWith(normalizedRoot)) {
    throw new Error(`Путь выходит за пределы репозитория: ${relPath}`);
  }

  return normalizedAbs;
}

/**
 * Загружает изображение и возвращает RGB пиксели (sRGB), без альфы.
 *
 * Делает:
 * - rotate() по EXIF,
 * - toColorspace('srgb'),
 * - resize до targetWidth без апскейла,
 * - raw() -> Uint8Array.
 */
export async function loadImageAsRgbLocal(absPath: string, options: LoadImageOptions = {}): Promise<RgbImage> {
  const bytes = await fs.readFile(absPath);

  let pipeline = sharp(bytes, { failOn: 'none' }).rotate().toColorspace('srgb').removeAlpha();
  if (options.targetWidth) {
    pipeline = pipeline.resize({ width: options.targetWidth, withoutEnlargement: true });
  }

  const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });

  if (info.channels !== 3) {
    throw new Error(`Ожидали 3 канала (RGB), но получили ${info.channels} для ${absPath}`);
  }

  return {
    width: info.width,
    height: info.height,
    data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  };
}

