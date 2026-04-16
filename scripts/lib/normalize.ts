/**
 * Нормализация пары изображений (reference + diagnostic) для анализа.
 *
 * Что делаем в MVP:
 * - приводим геометрию к каноническому виду (rotate EXIF + resize),
 * - (опционально) применяем мягкую балансировку белого по reference ROI,
 * - возвращаем изображения в формате `RgbImage`, совместимом с `cv-core`.
 */

import type { RoiRect, RgbImage } from '@cats-screening/cv-core';

import { loadImageAsRgb } from './image-io.js';

export type WhiteBalanceGains = { r: number; g: number; b: number };

export type NormalizePairOptions = {
  /** Каноническая ширина кадра (px). */
  targetWidth?: number;
  /** Применять ли white balance по reference ROI. */
  whiteBalance?: boolean;
};

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function clampByte(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(255, Math.max(0, Math.round(value)));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function roiToPixels(image: RgbImage, roi: RoiRect) {
  const x0 = Math.floor(clamp01(roi.x) * image.width);
  const y0 = Math.floor(clamp01(roi.y) * image.height);
  const x1 = Math.ceil(clamp01(roi.x + roi.w) * image.width);
  const y1 = Math.ceil(clamp01(roi.y + roi.h) * image.height);

  const left = Math.max(0, Math.min(image.width - 1, x0));
  const top = Math.max(0, Math.min(image.height - 1, y0));
  const right = Math.max(left + 1, Math.min(image.width, x1));
  const bottom = Math.max(top + 1, Math.min(image.height, y1));

  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function rgb01ToHsv(r: number, g: number, b: number) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const s = max <= 1e-8 ? 0 : delta / max;
  const v = max;
  return { s, v };
}

/**
 * Оценивает коэффициенты white-balance (gain'ы) по reference ROI.
 *
 * Идея:
 * - находим “почти нейтральные” пиксели (низкая насыщенность + достаточно светлые),
 * - считаем средние R/G/B по ним,
 * - приводим каналы к одному среднему уровню (диагональная матрица).
 *
 * Это не идеальная колориметрия, но достаточно как мягкая нормализация для MVP.
 */
export function estimateWhiteBalanceGains(reference: RgbImage, roi: RoiRect): WhiteBalanceGains | null {
  const roiPx = roiToPixels(reference, roi);
  const area = roiPx.width * roiPx.height;
  const step = Math.max(1, Math.floor(Math.sqrt(area / 50_000)));

  let n = 0;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;

  for (let y = roiPx.top; y < roiPx.bottom; y += step) {
    for (let x = roiPx.left; x < roiPx.right; x += step) {
      const idx = (y * reference.width + x) * 3;
      const r8 = reference.data[idx] ?? 0;
      const g8 = reference.data[idx + 1] ?? 0;
      const b8 = reference.data[idx + 2] ?? 0;

      const r = r8 / 255;
      const g = g8 / 255;
      const b = b8 / 255;
      const hsv = rgb01ToHsv(r, g, b);

      // Кандидаты “почти белого/серого”: низкая насыщенность и достаточно светлые.
      const isNeutralCandidate = hsv.s < 0.25 && hsv.v > 0.5 && hsv.v < 0.98;
      if (!isNeutralCandidate) continue;

      n += 1;
      sumR += r;
      sumG += g;
      sumB += b;
    }
  }

  // Если нейтральных пикселей почти нет — лучше не применять коррекцию (чтобы не навредить).
  if (n < 50) return null;

  const meanR = sumR / n;
  const meanG = sumG / n;
  const meanB = sumB / n;
  const target = (meanR + meanG + meanB) / 3;

  const gains = {
    r: target / Math.max(1e-6, meanR),
    g: target / Math.max(1e-6, meanG),
    b: target / Math.max(1e-6, meanB)
  };

  // Мягко ограничиваем, чтобы не улетать в экстремальные значения.
  return {
    r: clamp(gains.r, 0.5, 2.0),
    g: clamp(gains.g, 0.5, 2.0),
    b: clamp(gains.b, 0.5, 2.0)
  };
}

/**
 * Применяет white-balance gain'ы к изображению.
 *
 * Важно:
 * - возвращаем новый буфер, не мутируем исходный (проще дебажить и безопаснее по данным).
 */
export function applyWhiteBalance(image: RgbImage, gains: WhiteBalanceGains): RgbImage {
  const out = new Uint8Array(image.data.length);
  for (let i = 0; i < image.data.length; i += 3) {
    out[i] = clampByte((image.data[i] ?? 0) * gains.r);
    out[i + 1] = clampByte((image.data[i + 1] ?? 0) * gains.g);
    out[i + 2] = clampByte((image.data[i + 2] ?? 0) * gains.b);
  }
  return { width: image.width, height: image.height, data: out };
}

export type NormalizedPair = {
  reference: RgbImage;
  diagnostic: RgbImage;
  /** Применённые gain'ы (если whiteBalance включён и смогли оценить). */
  whiteBalanceGains: WhiteBalanceGains | null;
};

/**
 * Загружает и нормализует пару изображений.
 */
export async function loadAndNormalizePair(
  referencePath: string,
  diagnosticPath: string,
  roi: RoiRect,
  options: NormalizePairOptions = {}
): Promise<NormalizedPair> {
  const targetWidth = options.targetWidth ?? 1024;

  const reference = await loadImageAsRgb(referencePath, { targetWidth });
  const diagnostic = await loadImageAsRgb(diagnosticPath, { targetWidth });

  if (!options.whiteBalance) {
    return { reference, diagnostic, whiteBalanceGains: null };
  }

  const gains = estimateWhiteBalanceGains(reference, roi);
  if (!gains) {
    return { reference, diagnostic, whiteBalanceGains: null };
  }

  return {
    reference: applyWhiteBalance(reference, gains),
    diagnostic: applyWhiteBalance(diagnostic, gains),
    whiteBalanceGains: gains
  };
}

