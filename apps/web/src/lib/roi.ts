import type { RoiPoint, RoiRect, RoiShape } from '@cats-screening/shared';

export type { RoiPoint, RoiRect, RoiShape };

export const FIXED_CENTER_ROI: RoiRect = { x: 0.35, y: 0.36, w: 0.3, h: 0.24 };
export const FIXED_WIDE_ROI: RoiRect = { x: 0.28, y: 0.32, w: 0.44, h: 0.32 };
export const FIXED_SMALL_ROI: RoiRect = { x: 0.4, y: 0.4, w: 0.2, h: 0.16 };

export const MIN_ROI_SIZE = 0.04;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function clampRoiRect(rect: RoiRect): RoiRect {
  const w = clamp(rect.w, MIN_ROI_SIZE, 1);
  const h = clamp(rect.h, MIN_ROI_SIZE, 1);
  return {
    x: clamp(rect.x, 0, 1 - w),
    y: clamp(rect.y, 0, 1 - h),
    w,
    h
  };
}

export function polygonFromRect(rect: RoiRect): RoiPoint[] {
  const normalized = clampRoiRect(rect);
  return [
    { x: normalized.x, y: normalized.y },
    { x: normalized.x + normalized.w, y: normalized.y },
    { x: normalized.x + normalized.w, y: normalized.y + normalized.h },
    { x: normalized.x, y: normalized.y + normalized.h }
  ];
}

export function rectToRoiShape(rect: RoiRect): RoiShape {
  return {
    shape: 'rect',
    rect: clampRoiRect(rect),
    source: 'manual',
    updatedAt: new Date().toISOString()
  };
}

export function polygonToRoiShape(points: RoiPoint[]): RoiShape {
  return {
    shape: 'polygon',
    points: points.map((point) => ({
      x: clamp(point.x, 0, 1),
      y: clamp(point.y, 0, 1)
    })),
    source: 'manual',
    updatedAt: new Date().toISOString()
  };
}

export function boundingRectFromPoints(points: RoiPoint[]): RoiRect {
  if (points.length === 0) return FIXED_WIDE_ROI;

  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const left = clamp(Math.min(...xs), 0, 1);
  const top = clamp(Math.min(...ys), 0, 1);
  const right = clamp(Math.max(...xs), left + MIN_ROI_SIZE, 1);
  const bottom = clamp(Math.max(...ys), top + MIN_ROI_SIZE, 1);

  return clampRoiRect({
    x: left,
    y: top,
    w: right - left,
    h: bottom - top
  });
}

export function roiShapeToRect(shape: RoiShape | null | undefined): RoiRect {
  if (!shape) return FIXED_WIDE_ROI;
  if (shape.shape === 'rect') return clampRoiRect(shape.rect);
  return boundingRectFromPoints(shape.points);
}

/**
 * Возвращает относительную ROI-область для фиксированной стратегии.
 *
 * Что меняется:
 * - `fixed-wide` покрывает широкую центральную область и сейчас используется
 *   как дефолт для `fixed-wide/hsv-lab`;
 * - `fixed-center` и `fixed-small` нужны для сравнения устойчивости признаков;
 * - для `auto-flat` точные координаты приходят из feature-cache, поэтому эта
 *   функция используется только как fallback.
 */
export function roiForStrategy(strategy: string): RoiRect {
  if (strategy === 'fixed-wide') return FIXED_WIDE_ROI;
  if (strategy === 'fixed-small') return FIXED_SMALL_ROI;
  return FIXED_CENTER_ROI;
}

