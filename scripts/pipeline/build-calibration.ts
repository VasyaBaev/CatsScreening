/**
 * Step-008 — Сборка калибровки (kNN) для pH_estimate и risk score.
 *
 * Этот скрипт:
 * - читает `manifest-v1.json` и `roi-labels-v1.json`,
 * - исключает blind set (чтобы не было утечки),
 * - для каждого (tray, light) выбирает “anchor” (pH ближе всего к 6.13),
 * - строит признаки как diagnostic относительно anchor,
 * - сохраняет JSON-модель калибровки для последующего scoring/eval.
 *
 * Запуск (PowerShell, из корня репо):
 *   npx tsx scripts/pipeline/build-calibration.ts
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import type { RoiRect } from '@cats-screening/cv-core';
import {
  buildFeatureVector,
  computeDeltaFeatures,
  extractRoiFeatures,
  runQualityChecksForRoi,
  type KnnCalibrationModel
} from '@cats-screening/cv-core';

import { loadImageAsRgb } from '../lib/image-io.js';

type Manifest = {
  version: 1;
  generatedAt: string;
  normalRange: { low: number; high: number; inclusive: boolean };
  inputDir: string;
  items: Array<{
    id: string;
    relPath: string;
    filename: string;
    pH: number;
    class: 0 | 1;
    tray: string;
    light: string;
    notes: string | null;
  }>;
};

type RoiLabelsFile = {
  version: 1;
  generatedAt: string;
  items: Record<string, RoiRect>;
};

type BlindSet = {
  version: 1;
  seed: number;
  size: number;
  items: Array<{ id: string; relPath: string; pH: number; class: 0 | 1 }>;
};

type AnchorInfo = { id: string; relPath: string; pH: number };

function euclideanDistance(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error(`Вектора разной длины: ${a.length} vs ${b.length}`);
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    sum += d * d;
  }
  return Math.sqrt(sum);
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 1;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p)));
  return sorted[idx] ?? 1;
}

function computeDistanceScale(vectors: Array<{ vector: number[] }>): number {
  if (vectors.length < 2) return 1;
  const mins: number[] = [];
  for (let i = 0; i < vectors.length; i += 1) {
    let best = Infinity;
    for (let j = 0; j < vectors.length; j += 1) {
      if (i === j) continue;
      const d = euclideanDistance(vectors[i]!.vector, vectors[j]!.vector);
      if (d < best) best = d;
    }
    if (Number.isFinite(best)) mins.push(best);
  }
  // Берём p90 min-distance как “разумный” масштаб.
  return Math.max(1e-6, percentile(mins, 0.9));
}

function groupKey(item: { tray: string; light: string }): string {
  return `tray=${item.tray}|light=${item.light}`;
}

function pickAnchor(items: Array<{ id: string; relPath: string; pH: number }>, targetPh: number): AnchorInfo {
  let best = items[0]!;
  let bestDist = Math.abs(best.pH - targetPh);

  for (const item of items) {
    const dist = Math.abs(item.pH - targetPh);
    if (dist < bestDist) {
      best = item;
      bestDist = dist;
      continue;
    }
    // Детерминированный tie-breaker.
    if (dist === bestDist && item.relPath < best.relPath) {
      best = item;
      bestDist = dist;
    }
  }

  return best;
}

async function readJson<T>(filePath: string): Promise<T> {
  const abs = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
  const text = await fs.readFile(abs, 'utf-8');
  return JSON.parse(text) as T;
}

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

async function main() {
  const manifestPath = 'data/dataset/manifest-v1.json';
  const blindPath = 'data/dataset/blind-set-v1.json';
  const roiLabelsPath = 'data/dataset/roi-labels-v1.json';
  const outPath = 'data/models/calibration-v0.json';

  const targetWidth = 1024;
  const anchorTargetPh = 6.13;
  const algoVersion = 'v0.1';
  const vectorSpec = [
    'deltaHueSin',
    'deltaHueCos',
    'deltaSat',
    'deltaVal',
    'deltaLabA',
    'deltaLabB',
    'qc.glareRatio',
    'qc.meanLumaNorm'
  ];

  const manifest = await readJson<Manifest>(manifestPath);
  const blind = await readJson<BlindSet>(blindPath);
  const roiLabels = await readJson<RoiLabelsFile>(roiLabelsPath).catch(() => {
    throw new Error(
      [
        `Не найден файл ROI-разметки: ${roiLabelsPath}`,
        `Сначала разметь ROI через /tools/roi-labeler и сохрани файл как ${roiLabelsPath}.`,
        `См. docs/dataset/README.md`
      ].join('\n')
    );
  });

  if (roiLabels.version !== 1) {
    throw new Error(`Неподдерживаемая версия ROI labels: ${String(roiLabels.version)}`);
  }

  const blindIds = new Set(blind.items.map((i) => i.id));
  const trainItems = manifest.items.filter((i) => !blindIds.has(i.id));

  // Группируем по (tray, light) и выбираем anchors из training (без утечки в blind set).
  const groups = new Map<string, Array<{ id: string; relPath: string; pH: number; tray: string; light: string; class: 0 | 1 }>>();
  for (const item of trainItems) {
    const key = groupKey(item);
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }

  const anchors: Record<string, AnchorInfo> = {};
  for (const [key, items] of groups.entries()) {
    anchors[key] = pickAnchor(items, anchorTargetPh);
  }

  // Кэшируем признаки anchor, чтобы не считать их много раз.
  const anchorFeaturesCache = new Map<string, ReturnType<typeof extractRoiFeatures>>();

  const vectors: KnnCalibrationModel['vectors'] = [];

  const missingRoi: string[] = [];

  for (const item of trainItems) {
    const key = groupKey(item);
    const anchor = anchors[key];
    if (!anchor) continue;

    const roi = roiLabels.items[item.relPath];
    if (!roi) {
      missingRoi.push(item.relPath);
      continue;
    }

    const anchorRoi = roiLabels.items[anchor.relPath];
    if (!anchorRoi) {
      missingRoi.push(anchor.relPath);
      continue;
    }

    let refFeatures = anchorFeaturesCache.get(anchor.relPath);
    if (!refFeatures) {
      const refImage = await loadImageAsRgb(anchor.relPath, { targetWidth });
      refFeatures = extractRoiFeatures(refImage, anchorRoi);
      anchorFeaturesCache.set(anchor.relPath, refFeatures);
    }

    const diagImage = await loadImageAsRgb(item.relPath, { targetWidth });

    // QC считаем по диагностическому кадру (в датасетном контуре diagnostic=item, reference=anchor).
    const qc = runQualityChecksForRoi(diagImage, roi);
    const diagFeatures = extractRoiFeatures(diagImage, roi);
    const delta = computeDeltaFeatures(refFeatures, diagFeatures);
    const fv = buildFeatureVector(delta, qc);

    vectors.push({
      id: item.id,
      pH: item.pH,
      class: item.class,
      vector: fv.vector
    });
  }

  if (missingRoi.length > 0) {
    const preview = missingRoi.slice(0, 10).join('\n');
    throw new Error(
      [
        `Не хватает ROI разметки для ${missingRoi.length} файлов (из training).`,
        `Сначала разметь их через /tools/roi-labeler и пересохрани ${roiLabelsPath}.`,
        `Примеры (первые 10):`,
        preview
      ].join('\n')
    );
  }

  const distanceScale = computeDistanceScale(vectors);
  const k = Math.max(1, Math.min(5, vectors.length));

  const model: KnnCalibrationModel & {
    dataset: {
      manifestPath: string;
      blindSetPath: string;
      roiLabelsPath: string;
      targetWidth: number;
      anchorTargetPh: number;
      anchors: Record<string, AnchorInfo>;
    };
  } = {
    version: 1,
    algoVersion,
    generatedAt: new Date().toISOString(),
    normalRange: manifest.normalRange,
    k,
    distanceScale,
    vectorSpec,
    vectors,
    dataset: {
      manifestPath,
      blindSetPath: blindPath,
      roiLabelsPath,
      targetWidth,
      anchorTargetPh,
      anchors
    }
  };

  await ensureDir(path.join(process.cwd(), 'data/models'));
  await fs.writeFile(path.join(process.cwd(), outPath), JSON.stringify(model, null, 2) + '\n', 'utf-8');

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        ok: true,
        outPath,
        vectors: vectors.length,
        k,
        distanceScale,
        anchors: Object.keys(anchors).length
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

