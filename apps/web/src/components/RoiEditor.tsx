import { type PointerEvent, useMemo, useRef, useState } from 'react';

import {
  FIXED_WIDE_ROI,
  MIN_ROI_SIZE,
  boundingRectFromPoints,
  clampRoiRect,
  polygonFromRect,
  polygonToRoiShape,
  rectToRoiShape,
  roiShapeToRect,
  type RoiPoint,
  type RoiRect,
  type RoiShape
} from '../lib/roi';

type RectHandle = 'nw' | 'ne' | 'sw' | 'se';

type RectDragState = {
  type: 'move' | 'resize';
  pointerId: number;
  handle?: RectHandle;
  startPoint: RoiPoint;
  startRect: RoiRect;
};

type PolygonDragState = {
  pointerId: number;
  pointIndex: number;
};

type RoiEditorProps = {
  src?: string | null;
  alt: string;
  value?: RoiShape | null;
  onChange: (shape: RoiShape) => void;
  allowPolygon?: boolean;
  placeholder?: string;
  compact?: boolean;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function eventPoint(event: PointerEvent, image: HTMLImageElement | null): RoiPoint | null {
  if (!image) return null;

  const box = image.getBoundingClientRect();
  if (box.width <= 0 || box.height <= 0) return null;

  return {
    x: clamp((event.clientX - box.left) / box.width, 0, 1),
    y: clamp((event.clientY - box.top) / box.height, 0, 1)
  };
}

function resizeRect(start: RoiRect, point: RoiPoint, handle: RectHandle): RoiRect {
  let left = start.x;
  let top = start.y;
  let right = start.x + start.w;
  let bottom = start.y + start.h;

  if (handle.includes('w')) left = clamp(point.x, 0, right - MIN_ROI_SIZE);
  if (handle.includes('e')) right = clamp(point.x, left + MIN_ROI_SIZE, 1);
  if (handle.includes('n')) top = clamp(point.y, 0, bottom - MIN_ROI_SIZE);
  if (handle.includes('s')) bottom = clamp(point.y, top + MIN_ROI_SIZE, 1);

  return clampRoiRect({
    x: left,
    y: top,
    w: right - left,
    h: bottom - top
  });
}

function moveRect(start: RoiRect, startPoint: RoiPoint, point: RoiPoint): RoiRect {
  return clampRoiRect({
    ...start,
    x: start.x + point.x - startPoint.x,
    y: start.y + point.y - startPoint.y
  });
}

function polygonPoints(shape: RoiShape): RoiPoint[] {
  if (shape.shape === 'polygon') return shape.points;
  return polygonFromRect(shape.rect);
}

function pointList(points: RoiPoint[]): string {
  return points.map((point) => `${point.x * 100},${point.y * 100}`).join(' ');
}

/**
 * Редактор ручной ROI-области.
 *
 * Что делает:
 * - в режиме прямоугольника позволяет двигать область и тянуть ее за углы;
 * - в режиме многоугольника позволяет добавлять точки кликом/тапом и двигать вершины;
 * - всегда возвращает координаты 0..1, чтобы backend и ML-pipeline не зависели
 *   от размера превью в браузере.
 */
export function RoiEditor({
  src,
  alt,
  value,
  onChange,
  allowPolygon = true,
  placeholder = 'Фото не выбрано',
  compact = false
}: RoiEditorProps) {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const suppressClickRef = useRef(false);
  const shape = value ?? rectToRoiShape(FIXED_WIDE_ROI);
  const rect = roiShapeToRect(shape);
  const points = useMemo(() => polygonPoints(shape), [shape]);
  const [rectDrag, setRectDrag] = useState<RectDragState | null>(null);
  const [polygonDrag, setPolygonDrag] = useState<PolygonDragState | null>(null);

  function switchToRect() {
    onChange(rectToRoiShape(shape.shape === 'polygon' ? boundingRectFromPoints(shape.points) : rect));
  }

  function switchToPolygon() {
    onChange(polygonToRoiShape(shape.shape === 'polygon' ? shape.points : polygonFromRect(rect)));
  }

  function reset() {
    onChange(rectToRoiShape(FIXED_WIDE_ROI));
  }

  function beginRectDrag(event: PointerEvent<HTMLElement>, type: RectDragState['type'], handle?: RectHandle) {
    const point = eventPoint(event, imageRef.current);
    if (!point) return;

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setRectDrag({
      type,
      pointerId: event.pointerId,
      handle,
      startPoint: point,
      startRect: rect
    });
  }

  function updateRectDrag(event: PointerEvent<HTMLDivElement>) {
    if (!rectDrag || rectDrag.pointerId !== event.pointerId) return;

    const point = eventPoint(event, imageRef.current);
    if (!point) return;

    const next =
      rectDrag.type === 'move'
        ? moveRect(rectDrag.startRect, rectDrag.startPoint, point)
        : resizeRect(rectDrag.startRect, point, rectDrag.handle ?? 'se');
    onChange(rectToRoiShape(next));
  }

  function endRectDrag(event: PointerEvent<HTMLDivElement>) {
    if (rectDrag?.pointerId !== event.pointerId) return;
    setRectDrag(null);
  }

  function addPolygonPoint(event: PointerEvent<HTMLDivElement>) {
    if (shape.shape !== 'polygon') return;
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }

    const point = eventPoint(event, imageRef.current);
    if (!point) return;

    onChange(polygonToRoiShape([...shape.points, point]));
  }

  function beginPolygonPointDrag(event: PointerEvent<HTMLButtonElement>, pointIndex: number) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    suppressClickRef.current = true;
    setPolygonDrag({ pointerId: event.pointerId, pointIndex });
  }

  function updatePolygonDrag(event: PointerEvent<HTMLDivElement>) {
    if (!polygonDrag || polygonDrag.pointerId !== event.pointerId || shape.shape !== 'polygon') return;

    const point = eventPoint(event, imageRef.current);
    if (!point) return;

    const next = shape.points.map((item, index) => (index === polygonDrag.pointIndex ? point : item));
    onChange(polygonToRoiShape(next));
  }

  function endPolygonDrag(event: PointerEvent<HTMLDivElement>) {
    if (polygonDrag?.pointerId !== event.pointerId) return;
    setPolygonDrag(null);
  }

  function deleteLastPolygonPoint() {
    if (shape.shape !== 'polygon') return;
    if (shape.points.length <= 3) {
      switchToRect();
      return;
    }
    onChange(polygonToRoiShape(shape.points.slice(0, -1)));
  }

  return (
    <div className={`roi-editor ${compact ? 'is-compact' : ''}`}>
      <div className="roi-editor-toolbar">
        <div className="segmented-row two roi-mode-toggle">
          <button
            className={shape.shape === 'rect' ? 'active' : ''}
            type="button"
            onClick={switchToRect}
          >
            Прямоугольник
          </button>
          <button
            className={shape.shape === 'polygon' ? 'active' : ''}
            disabled={!allowPolygon}
            type="button"
            onClick={switchToPolygon}
          >
            Многоугольник
          </button>
        </div>
        <button type="button" className="secondary roi-reset-button" onClick={reset}>
          Сброс
        </button>
      </div>

      <div
        className={`roi-editor-stage ${src ? 'has-image' : ''}`}
        onPointerMove={(event) => {
          updateRectDrag(event);
          updatePolygonDrag(event);
        }}
        onPointerUp={(event) => {
          endRectDrag(event);
          endPolygonDrag(event);
        }}
        onPointerCancel={(event) => {
          endRectDrag(event);
          endPolygonDrag(event);
        }}
        onPointerDown={shape.shape === 'polygon' ? addPolygonPoint : undefined}
      >
        {src ? (
          <>
            <img ref={imageRef} src={src} alt={alt} draggable={false} />
            {shape.shape === 'rect' ? (
              <div
                className="roi-edit-rect"
                style={{
                  left: `${rect.x * 100}%`,
                  top: `${rect.y * 100}%`,
                  width: `${rect.w * 100}%`,
                  height: `${rect.h * 100}%`
                }}
                onPointerDown={(event) => beginRectDrag(event, 'move')}
              >
                {(['nw', 'ne', 'sw', 'se'] as RectHandle[]).map((handle) => (
                  <span
                    key={handle}
                    className={`roi-rect-handle handle-${handle}`}
                    onPointerDown={(event) => beginRectDrag(event, 'resize', handle)}
                  />
                ))}
              </div>
            ) : (
              <div className="roi-polygon-layer">
                <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                  <polygon points={pointList(points)} />
                  <polyline points={pointList(points)} />
                </svg>
                {points.map((point, index) => (
                  <button
                    key={`${index}-${point.x}-${point.y}`}
                    type="button"
                    className="roi-polygon-point"
                    style={{
                      left: `${point.x * 100}%`,
                      top: `${point.y * 100}%`
                    }}
                    aria-label={`Точка ROI ${index + 1}`}
                    onPointerDown={(event) => beginPolygonPointDrag(event, index)}
                  />
                ))}
              </div>
            )}
          </>
        ) : (
          <span className="roi-placeholder">{placeholder}</span>
        )}
      </div>

      <div className="roi-editor-footer">
        <span>
          {shape.shape === 'rect'
            ? 'Перетащите область или потяните за углы.'
            : 'Тап/клик по фото добавляет точку, точки можно двигать.'}
        </span>
        {shape.shape === 'polygon' ? (
          <button type="button" className="secondary" onClick={deleteLastPolygonPoint}>
            Удалить точку
          </button>
        ) : null}
      </div>
    </div>
  );
}
