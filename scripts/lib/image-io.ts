/**
 * Node-утилиты для чтения изображений и подготовки данных для cv-core.
 *
 * Почему это не в `cv-core`:
 * - декодирование файлов (JPEG/PNG/HEIC) — это I/O и платформенная зависимость,
 * - `cv-core` должен оставаться “чистым” и переносимым (только математика).
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';

import type { RgbImage } from '@cats-screening/cv-core';

export type LoadImageOptions = {
  /** Целевая ширина (px). Если не задана — без ресайза. */
  targetWidth?: number;
};

function toAbsolutePath(filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
}

/**
 * Загружает изображение с диска и возвращает RGB пиксели (sRGB) без альфы.
 *
 * Что делает:
 * - читает файл,
 * - декодирует через `sharp`,
 * - применяет авто-поворот по EXIF (`rotate()`),
 * - приводит к sRGB,
 * - опционально ресайзит до targetWidth без апскейла,
 * - возвращает “сырой” RGB буфер.
 */
export async function loadImageAsRgb(filePath: string, options: LoadImageOptions = {}): Promise<RgbImage> {
  const abs = toAbsolutePath(filePath);
  const bytes = await fs.readFile(abs);

  let pipeline = sharp(bytes, { failOn: 'none' }).rotate().toColorspace('srgb').removeAlpha();
  if (options.targetWidth) {
    pipeline = pipeline.resize({ width: options.targetWidth, withoutEnlargement: true });
  }

  const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });

  if (info.channels !== 3) {
    /**
     * На практике после `removeAlpha()` channels должен быть 3.
     * Если вдруг нет (какой-то редкий формат), явно падаем — лучше, чем молча испортить данные.
     */
    throw new Error(`Ожидали 3 канала (RGB), но получили ${info.channels} для ${filePath}`);
  }

  return {
    width: info.width,
    height: info.height,
    data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  };
}

