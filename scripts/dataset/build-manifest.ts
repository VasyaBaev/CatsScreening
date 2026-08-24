/**
 * Step-004 — Построение manifest датасета + фиксированный blind split.
 *
 * Зачем нужен manifest:
 * - иметь единый список файлов датасета с извлечёнными метаданными (pH, класс, свет, лоток),
 * - использовать этот список в последующих шагах (ROI‑разметка, калибровка, eval),
 * - обеспечить воспроизводимость (seed для blind set).
 *
 * Ограничения:
 * - `sources/` — read-only (по правилам репозитория): мы ничего туда не пишем и не перемещаем.
 * - В manifest сохраняем пути относительно корня репозитория.
 *
 * Запуск (PowerShell, из корня репо):
 *   npx tsx scripts/dataset/build-manifest.ts
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

type DatasetClass = 0 | 1;
type Tray = 'white' | 'gray' | 'yellow' | 'unknown';
type Light = 'day' | '3000K' | '6000K' | 'unknown';

export type DatasetManifestItem = {
  /** Стабильный ID (хеш от `relPath`). */
  id: string;
  /** Путь к изображению относительно корня репозитория (с `/`). */
  relPath: string;
  /** Имя файла (basename). */
  filename: string;
  /** pH, извлечённый из имени папки. */
  pH: number;
  /** 0 = норма, 1 = отклонение/риск (по диапазону 5.8–6.4). */
  class: DatasetClass;
  /** Тип лотка (фон). Для нестандартных цветов — `unknown`. */
  tray: Tray;
  /** Свет по протоколу. Для непонятных случаев — `unknown`. */
  light: Light;
  /** Сырые/вспомогательные заметки (если удалось извлечь полезные подсказки из имени). */
  notes: string | null;
};

type DatasetManifest = {
  version: 1;
  generatedAt: string;
  normalRange: { low: number; high: number; inclusive: boolean };
  inputDir: string;
  items: DatasetManifestItem[];
};

type BlindSet = {
  version: 1;
  generatedAt: string;
  seed: number;
  size: number;
  strategy: 'stratified_60_40';
  counts: { class0: number; class1: number };
  items: Array<{ id: string; relPath: string; pH: number; class: DatasetClass }>;
};

const NORMAL_RANGE = { low: 5.8, high: 6.4, inclusive: true } as const;

function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join('/');
}

function stableIdForRelPath(relPath: string): string {
  return crypto.createHash('sha1').update(relPath).digest('hex').slice(0, 12);
}

function parsePhFromFolderName(folderName: string): number {
  // Примеры: "6", "6,13", "4,6"
  const normalized = folderName.replace(',', '.');
  const value = Number(normalized);
  if (!Number.isFinite(value)) {
    throw new Error(`Не удалось распарсить pH из имени папки: "${folderName}"`);
  }
  return value;
}

function classFromPh(pH: number): DatasetClass {
  const inRange = NORMAL_RANGE.inclusive
    ? pH >= NORMAL_RANGE.low && pH <= NORMAL_RANGE.high
    : pH > NORMAL_RANGE.low && pH < NORMAL_RANGE.high;
  return inRange ? 0 : 1;
}

function parseLightFromFilename(filename: string): { light: Light; note?: string } {
  const name = filename.toLowerCase();

  // "окно" = daylight (day)
  if (name.includes('окно')) return { light: 'day' };

  // "2,7К" ~= 2700K -> по протоколу относим к "3000K"
  if (/[12][,.]7к/.test(name) || name.includes('2,7к') || name.includes('2.7к')) {
    return { light: '3000K', note: 'light_raw=2.7K' };
  }

  // "5К" ~= 5000K -> по протоколу относим к "6000K" (холодный свет 5К–6К)
  if (/[45]к/.test(name) || name.includes('5к')) {
    return { light: '6000K', note: 'light_raw=5K' };
  }

  return { light: 'unknown' };
}

function parseTrayFromFilename(filename: string): { tray: Tray; note?: string } {
  const name = filename.toLowerCase();

  // Базовые лотки из протокола
  if (name.includes('бел')) return { tray: 'white' };
  if (name.includes('сер')) return { tray: 'gray' };
  if (name.includes('жел')) return { tray: 'yellow' };

  // Нестандартные варианты, встречающиеся в первой пачке (не входят в протокол v1)
  if (name.includes('голуб')) return { tray: 'unknown', note: 'tray_raw=blue' };
  if (name.includes('корич')) return { tray: 'unknown', note: 'tray_raw=brown' };

  return { tray: 'unknown' };
}

async function listFilesRecursive(rootDirAbs: string): Promise<string[]> {
  const result: string[] = [];
  const entries = await fs.readdir(rootDirAbs, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(rootDirAbs, entry.name);
    if (entry.isDirectory()) {
      const nested = await listFilesRecursive(fullPath);
      result.push(...nested);
      continue;
    }

    if (!entry.isFile()) continue;
    result.push(fullPath);
  }
  return result;
}

function mulberry32(seed: number): () => number {
  // Дет. генератор случайных чисел для воспроизводимости.
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle<T>(items: T[], seed: number): T[] {
  const rng = mulberry32(seed);
  const array = items.slice();
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function buildBlindSet(items: DatasetManifestItem[], seed: number, size: number): BlindSet {
  // Стратифицированная выборка ~60/40, чтобы в blind-set были оба класса.
  const class0 = items.filter((i) => i.class === 0);
  const class1 = items.filter((i) => i.class === 1);

  const desiredClass1 = Math.max(1, Math.round(size * 0.4));
  const desiredClass0 = Math.max(1, size - desiredClass1);

  const picked1 = seededShuffle(class1, seed + 1).slice(0, Math.min(desiredClass1, class1.length));
  const picked0 = seededShuffle(class0, seed).slice(0, Math.min(desiredClass0, class0.length));

  const picked = seededShuffle([...picked0, ...picked1], seed + 2).slice(0, size);

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    seed,
    size,
    strategy: 'stratified_60_40',
    counts: {
      class0: picked.filter((i) => i.class === 0).length,
      class1: picked.filter((i) => i.class === 1).length
    },
    items: picked.map((i) => ({ id: i.id, relPath: i.relPath, pH: i.pH, class: i.class }))
  };
}

async function ensureDir(dirAbs: string) {
  await fs.mkdir(dirAbs, { recursive: true });
}

async function main() {
  const repoRootAbs = process.cwd();
  const inputDirRel = 'sources/Photos/PH';
  const inputDirAbs = path.join(repoRootAbs, inputDirRel);

  const outDirRel = 'data/dataset';
  const outDirAbs = path.join(repoRootAbs, outDirRel);
  const manifestOutRel = `${outDirRel}/manifest-v1.json`;
  const blindOutRel = `${outDirRel}/blind-set-v1.json`;

  const seed = 1337;
  const blindSize = 10;

  const filesAbs = await listFilesRecursive(inputDirAbs);
  const imageFilesAbs = filesAbs.filter((f) => /\.(png|jpe?g|heic)$/i.test(f));

  const items: DatasetManifestItem[] = [];
  for (const fileAbs of imageFilesAbs) {
    const relPathOs = path.relative(repoRootAbs, fileAbs);
    const relPath = toPosixPath(relPathOs);
    const filename = path.basename(fileAbs);

    const phFolderName = path.basename(path.dirname(fileAbs));
    const pH = parsePhFromFolderName(phFolderName);

    const trayParsed = parseTrayFromFilename(filename);
    const lightParsed = parseLightFromFilename(filename);

    const notesParts = [trayParsed.note, lightParsed.note].filter(Boolean);
    const notes = notesParts.length > 0 ? notesParts.join(';') : null;

    const item: DatasetManifestItem = {
      id: stableIdForRelPath(relPath),
      relPath,
      filename,
      pH,
      class: classFromPh(pH),
      tray: trayParsed.tray,
      light: lightParsed.light,
      notes
    };

    items.push(item);
  }

  // Для стабильности порядка фиксируем сортировку по relPath.
  items.sort((a, b) => a.relPath.localeCompare(b.relPath, 'en'));

  const manifest: DatasetManifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    normalRange: NORMAL_RANGE,
    inputDir: inputDirRel,
    items
  };

  const blindSet = buildBlindSet(items, seed, blindSize);

  await ensureDir(outDirAbs);

  await fs.writeFile(path.join(repoRootAbs, manifestOutRel), JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
  await fs.writeFile(path.join(repoRootAbs, blindOutRel), JSON.stringify(blindSet, null, 2) + '\n', 'utf-8');

  const counts = items.reduce(
    (acc, item) => {
      acc.total += 1;
      acc[item.class] += 1;
      return acc;
    },
    { total: 0, 0: 0, 1: 0 } as { total: number; 0: number; 1: number }
  );

  // Лог — только для человека (в файлы пишем JSON).
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        ok: true,
        inputDir: inputDirRel,
        output: { manifest: manifestOutRel, blindSet: blindOutRel },
        counts,
        blindCounts: blindSet.counts
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});

