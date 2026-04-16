/**
 * Инструмент полуручной разметки ROI (области интереса) для первой пачки фото.
 *
 * Зачем это нужно:
 * - на старте у нас маленький датасет и много шумов (разный свет/фон/ракурс),
 * - чтобы алгоритм не “смотрел” на края лотка/фон и работал стабильно,
 *   мы фиксируем ROI прямоугольником для каждого кадра (в относительных координатах 0..1).
 *
 * Как пользоваться (в браузере):
 * 1) Выбрать папку `sources/Photos/PH` через кнопку (режим directory picker).
 * 2) На каждом фото мышью/тачем выделить прямоугольник ROI.
 * 3) Нажать “Скачать JSON” и сохранить файл как `data/dataset/roi-labels-v1.json`.
 *
 * Примечание:
 * - Мы пишем ключи в формате путей репозитория: `sources/Photos/PH/<pH>/<filename>`.
 * - Это удобно стыкуется с `data/dataset/manifest-v1.json`.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

type RoiRect = { x: number; y: number; w: number; h: number };

type RoiLabelsFile = {
  version: 1;
  generatedAt: string;
  items: Record<string, RoiRect>;
};

type ImageItem = {
  /** Ключ для ROI labels (repo-relative). */
  key: string;
  /** Читабельное имя (для UI). */
  label: string;
  /** Исходный файл из file picker. */
  file: File;
  /** Object URL для отображения в `<img>`. */
  url: string;
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), 1);
}

function normalizeSlashes(value: string): string {
  return value.replaceAll('\\', '/');
}

function toRepoRelPath(file: File): string {
  /**
   * В Chrome/Edge при `webkitdirectory` можно получить относительный путь внутри выбранной папки.
   * Типы TS этого поля не знают, поэтому читаем через `any`.
   */
  const anyFile = file as any;
  const webkitRelativePath = typeof anyFile.webkitRelativePath === 'string' ? (anyFile.webkitRelativePath as string) : '';

  const raw = webkitRelativePath.length > 0 ? webkitRelativePath : file.name;
  let rel = normalizeSlashes(raw).replace(/^\/+/, '');

  // Если пользователь выбрал папку `PH`, браузер может отдать путь вида `PH/6/(6) ...jpg`.
  if (rel.toLowerCase().startsWith('ph/')) rel = rel.slice(3);

  // Приводим к формату путей репозитория, как в manifest.
  if (!rel.startsWith('sources/Photos/PH/')) {
    rel = `sources/Photos/PH/${rel}`;
  }

  return rel;
}

function rectToStyle(rect: RoiRect, imgWidth: number, imgHeight: number) {
  return {
    left: `${rect.x * imgWidth}px`,
    top: `${rect.y * imgHeight}px`,
    width: `${rect.w * imgWidth}px`,
    height: `${rect.h * imgHeight}px`
  };
}

export function RoiLabelerPage() {
  const [images, setImages] = useState<ImageItem[]>([]);
  const [index, setIndex] = useState(0);
  const [labels, setLabels] = useState<Record<string, RoiRect>>({});
  const [error, setError] = useState<string | null>(null);

  const imgRef = useRef<HTMLImageElement | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const [draftRect, setDraftRect] = useState<RoiRect | null>(null);

  // Чистим object URLs при замене списка.
  useEffect(() => {
    return () => {
      for (const item of images) URL.revokeObjectURL(item.url);
    };
  }, [images]);

  const current = images[index] ?? null;
  const currentKey = current?.key ?? '';
  const currentSavedRect = currentKey ? labels[currentKey] ?? null : null;

  const jsonText = useMemo(() => {
    const file: RoiLabelsFile = {
      version: 1,
      generatedAt: new Date().toISOString(),
      items: labels
    };
    return JSON.stringify(file, null, 2);
  }, [labels]);

  function setCurrentRect(rect: RoiRect) {
    if (!currentKey) return;
    setLabels((prev) => ({ ...prev, [currentKey]: rect }));
  }

  function getPointerPos01(event: React.PointerEvent): { x: number; y: number } | null {
    const img = imgRef.current;
    if (!img) return null;

    const rect = img.getBoundingClientRect();
    if (rect.width <= 1 || rect.height <= 1) return null;

    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    return { x: clamp01(x), y: clamp01(y) };
  }

  function onPickFiles(files: FileList | null) {
    try {
      setError(null);
      if (!files || files.length === 0) return;

      const picked: ImageItem[] = [];
      for (const file of Array.from(files)) {
        // Отфильтруем очевидно неподходящее: оставим только картинки.
        if (!file.type.startsWith('image/')) continue;

        const key = toRepoRelPath(file);
        const url = URL.createObjectURL(file);
        picked.push({ key, label: key, file, url });
      }

      // Стабильная сортировка по ключу, чтобы навигация была предсказуемой.
      picked.sort((a, b) => a.key.localeCompare(b.key, 'en'));

      setImages(picked);
      setIndex(0);
      setDraftRect(null);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
    }
  }

  function downloadJson() {
    const blob = new Blob([jsonText], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = 'roi-labels-v1.json';
    a.click();

    URL.revokeObjectURL(url);
  }

  async function copyJson() {
    try {
      setError(null);
      await navigator.clipboard.writeText(jsonText);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
    }
  }

  function importJson(file: File | null) {
    if (!file) return;

    void (async () => {
      try {
        setError(null);
        const text = await file.text();
        const parsed = JSON.parse(text) as Partial<RoiLabelsFile>;
        if (parsed.version !== 1 || typeof parsed.items !== 'object' || !parsed.items) {
          throw new Error('Неверный формат ROI labels: ожидается { version: 1, items: { ... } }');
        }
        setLabels(parsed.items as Record<string, RoiRect>);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setError(message);
      }
    })();
  }

  function clearCurrent() {
    if (!currentKey) return;
    setLabels((prev) => {
      const copy = { ...prev };
      delete copy[currentKey];
      return copy;
    });
    setDraftRect(null);
  }

  function onPointerDown(event: React.PointerEvent) {
    if (!current) return;

    const pos = getPointerPos01(event);
    if (!pos) return;

    dragStart.current = pos;
    setDraftRect({ x: pos.x, y: pos.y, w: 0, h: 0 });
  }

  function onPointerMove(event: React.PointerEvent) {
    if (!dragStart.current) return;

    const pos = getPointerPos01(event);
    if (!pos) return;

    const start = dragStart.current;
    const x1 = Math.min(start.x, pos.x);
    const y1 = Math.min(start.y, pos.y);
    const x2 = Math.max(start.x, pos.x);
    const y2 = Math.max(start.y, pos.y);

    setDraftRect({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
  }

  function onPointerUp() {
    if (!dragStart.current) return;

    dragStart.current = null;
    if (!draftRect) return;

    // Защита от “клика” без выделения: игнорируем слишком маленькие прямоугольники.
    const minSize = 0.02; // 2% от размера стороны
    if (draftRect.w < minSize || draftRect.h < minSize) {
      setDraftRect(null);
      return;
    }

    setCurrentRect(draftRect);
    setDraftRect(null);
  }

  const imgSize = useMemo(() => {
    const img = imgRef.current;
    if (!img) return { width: 0, height: 0 };
    return { width: img.clientWidth, height: img.clientHeight };
  }, [current?.url]);

  return (
    <section>
      <h1>ROI labeler (полуручной режим)</h1>

      <p style={{ maxWidth: 900 }}>
        Этот инструмент нужен, чтобы разметить ROI прямоугольником для каждого изображения из первой пачки. ROI сохраняется в относительных
        координатах 0..1 и привязывается к ключу вида <code>sources/Photos/PH/…</code>.
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center', marginBottom: 12 }}>
        <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
          <span>Выбрать папку (рекомендуется)</span>
          {/* `webkitdirectory` не типизирован в React, поэтому задаём через any. */}
          <input
            type="file"
            multiple
            {...({ webkitdirectory: 'true' } as any)}
            onChange={(e) => onPickFiles(e.target.files)}
          />
        </label>

        <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
          <span>или файлы</span>
          <input type="file" multiple accept="image/*" onChange={(e) => onPickFiles(e.target.files)} />
        </label>

        <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
          <span>Импорт ROI JSON</span>
          <input type="file" accept="application/json" onChange={(e) => importJson(e.target.files?.[0] ?? null)} />
        </label>

        <button type="button" onClick={downloadJson} disabled={Object.keys(labels).length === 0}>
          Скачать JSON
        </button>
        <button type="button" onClick={() => void copyJson()} disabled={Object.keys(labels).length === 0}>
          Скопировать JSON
        </button>
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
        <button type="button" onClick={() => setIndex((i) => Math.max(i - 1, 0))} disabled={index <= 0}>
          ← Prev
        </button>
        <button
          type="button"
          onClick={() => setIndex((i) => Math.min(i + 1, Math.max(images.length - 1, 0)))}
          disabled={index >= images.length - 1}
        >
          Next →
        </button>

        <span>
          Файлов: {images.length} | Текущий: {images.length > 0 ? index + 1 : 0}/{images.length} | ROI размечено:{' '}
          {Object.keys(labels).length}
        </span>

        <button type="button" onClick={clearCurrent} disabled={!currentSavedRect}>
          Очистить ROI
        </button>
      </div>

      {error ? (
        <pre style={{ whiteSpace: 'pre-wrap', padding: 12, background: '#fff3f3', border: '1px solid #ffd0d0' }}>{error}</pre>
      ) : null}

      {current ? (
        <div>
          <div style={{ fontFamily: 'monospace', fontSize: 12, marginBottom: 8 }}>{current.key}</div>

          <div style={{ position: 'relative', display: 'inline-block' }}>
            <img
              ref={imgRef}
              src={current.url}
              alt={current.label}
              style={{ maxWidth: 900, width: '100%', height: 'auto', display: 'block', border: '1px solid #eee' }}
              onLoad={() => {
                // Ничего не делаем, но onLoad помогает React пересчитать layout до первого drag.
              }}
            />

            {/* Overlay для выделения прямоугольника */}
            <div
              style={{ position: 'absolute', inset: 0, cursor: 'crosshair' }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={onPointerUp}
            />

            {/* Текущий сохранённый ROI */}
            {currentSavedRect && imgSize.width > 0 && imgSize.height > 0 ? (
              <div
                style={{
                  position: 'absolute',
                  border: '2px solid #00a3ff',
                  boxShadow: '0 0 0 9999px rgba(0,0,0,0.05)',
                  pointerEvents: 'none',
                  ...rectToStyle(currentSavedRect, imgSize.width, imgSize.height)
                }}
              />
            ) : null}

            {/* Черновик при перетаскивании */}
            {draftRect && imgSize.width > 0 && imgSize.height > 0 ? (
              <div
                style={{
                  position: 'absolute',
                  border: '2px dashed #ff7a00',
                  background: 'rgba(255,122,0,0.08)',
                  pointerEvents: 'none',
                  ...rectToStyle(draftRect, imgSize.width, imgSize.height)
                }}
              />
            ) : null}
          </div>

          <div style={{ marginTop: 10, fontSize: 12, color: '#444' }}>
            Подсказка: после выделения прямоугольника он сохраняется автоматически. Синим показан сохранённый ROI, оранжевым — черновик.
          </div>
        </div>
      ) : (
        <div style={{ padding: 12, border: '1px dashed #ddd', maxWidth: 900 }}>
          Выбери папку <code>sources/Photos/PH</code> или несколько файлов, чтобы начать разметку.
        </div>
      )}

      <details style={{ marginTop: 16 }}>
        <summary>Формат JSON</summary>
        <pre style={{ whiteSpace: 'pre-wrap', padding: 12, background: '#f8f8f8', border: '1px solid #eee', maxWidth: 900 }}>
          {jsonText}
        </pre>
      </details>
    </section>
  );
}

