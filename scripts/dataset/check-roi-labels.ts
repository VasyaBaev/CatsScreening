/**
 * Проверка ROI-разметки перед публикацией в GitHub.
 *
 * Что проверяет:
 * - файл `data/dataset/roi-labels-v1.json` существует и читается;
 * - координаты ROI находятся в диапазоне 0..1;
 * - ROI не выходит за границы изображения;
 * - для каждого файла из `manifest-v1.json` есть разметка.
 *
 * Запуск:
 *   npm run roi:check
 */

import fs from 'node:fs/promises';
import path from 'node:path';

type RoiRect = { x: number; y: number; w: number; h: number };

type Manifest = {
  version: 1;
  items: Array<{ id: string; relPath: string; pH: number; class: 0 | 1 }>;
};

type RoiLabels = {
  version: 1;
  generatedAt: string;
  items: Record<string, RoiRect>;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validateRect(rect: unknown): string | null {
  if (!rect || typeof rect !== 'object') return 'ROI должен быть объектом { x, y, w, h }';

  const r = rect as Partial<RoiRect>;
  for (const field of ['x', 'y', 'w', 'h'] as const) {
    if (!isFiniteNumber(r[field])) return `Поле ${field} должно быть числом`;
  }

  if (r.x < 0 || r.x > 1 || r.y < 0 || r.y > 1) return 'x/y должны быть в диапазоне 0..1';
  if (r.w <= 0 || r.w > 1 || r.h <= 0 || r.h > 1) return 'w/h должны быть в диапазоне (0..1]';
  if (r.x + r.w > 1 || r.y + r.h > 1) return 'ROI выходит за границы кадра: x+w или y+h > 1';

  return null;
}

async function readJson<T>(relPath: string): Promise<T> {
  const absPath = path.join(process.cwd(), relPath);
  const text = await fs.readFile(absPath, 'utf-8');
  return JSON.parse(text) as T;
}

async function main() {
  const manifest = await readJson<Manifest>('data/dataset/manifest-v1.json');
  const labels = await readJson<RoiLabels>('data/dataset/roi-labels-v1.json');

  const manifestPaths = new Set(manifest.items.map((item) => item.relPath));
  const labelEntries = Object.entries(labels.items ?? {});

  const invalid: Array<{ relPath: string; reason: string }> = [];
  for (const [relPath, rect] of labelEntries) {
    const reason = validateRect(rect);
    if (reason) invalid.push({ relPath, reason });
  }

  const missing = manifest.items.filter((item) => !labels.items[item.relPath]).map((item) => item.relPath);
  const extra = labelEntries.map(([relPath]) => relPath).filter((relPath) => !manifestPaths.has(relPath));

  const summary = {
    totalPhotos: manifest.items.length,
    labeled: labelEntries.length,
    missing: missing.length,
    invalid: invalid.length,
    extra: extra.length
  };

  console.log(JSON.stringify(summary, null, 2));

  if (invalid.length > 0) {
    console.error('\nНекорректные ROI:');
    for (const item of invalid.slice(0, 20)) console.error(`- ${item.relPath}: ${item.reason}`);
  }

  if (missing.length > 0) {
    console.error('\nНе размечены фото:');
    for (const relPath of missing.slice(0, 30)) console.error(`- ${relPath}`);
  }

  if (extra.length > 0) {
    console.error('\nЛишние ключи ROI (нет в manifest):');
    for (const relPath of extra.slice(0, 20)) console.error(`- ${relPath}`);
  }

  if (invalid.length > 0 || missing.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

