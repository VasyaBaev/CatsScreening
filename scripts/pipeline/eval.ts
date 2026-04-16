/**
 * Step-009 — Eval на blind set.
 *
 * Скрипт:
 * - читает calibration model (`data/models/calibration-v0.json`),
 * - прогоняет blind set (`data/dataset/blind-set-v1.json`),
 * - считает метрики (Balanced Accuracy, recall по классам, coverage по QC),
 * - сохраняет отчёт в `data/eval/` (JSON + Markdown).
 *
 * Запуск:
 *   npx tsx scripts/pipeline/eval.ts
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import type { RoiRect } from '@cats-screening/cv-core';
import {
  buildFeatureVector,
  classifyPh,
  confidenceFromKnn,
  computeDeltaFeatures,
  extractRoiFeatures,
  knnPredict,
  riskScoreFromPh,
  runQualityChecksForRoi,
  type KnnCalibrationModel,
  type QcFlags
} from '@cats-screening/cv-core';

import { loadImageAsRgb } from '../lib/image-io.js';

type ManifestItem = {
  id: string;
  relPath: string;
  filename: string;
  pH: number;
  class: 0 | 1;
  tray: string;
  light: string;
  notes: string | null;
};

type Manifest = {
  version: 1;
  generatedAt: string;
  normalRange: { low: number; high: number; inclusive: boolean };
  items: ManifestItem[];
};

type BlindSet = {
  version: 1;
  seed: number;
  size: number;
  items: Array<{ id: string; relPath: string; pH: number; class: 0 | 1 }>;
};

type RoiLabelsFile = {
  version: 1;
  generatedAt: string;
  items: Record<string, RoiRect>;
};

type AnchorInfo = { id: string; relPath: string; pH: number };

type CalibrationWithDataset = KnnCalibrationModel & {
  dataset?: {
    targetWidth: number;
    anchors: Record<string, AnchorInfo>;
  };
};

type EvalRow = {
  id: string;
  relPath: string;
  tray: string;
  light: string;
  pHTrue: number;
  classTrue: 0 | 1;
  pHEstimate: number;
  classPred: 0 | 1;
  score: number;
  confidence: number;
  qcFlags: QcFlags;
  avgDistance: number;
};

function groupKey(item: { tray: string; light: string }): string {
  return `tray=${item.tray}|light=${item.light}`;
}

async function readJson<T>(filePath: string): Promise<T> {
  const abs = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
  const text = await fs.readFile(abs, 'utf-8');
  return JSON.parse(text) as T;
}

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

function formatQc(flags: QcFlags): string {
  const parts: string[] = [];
  if (flags.blur) parts.push('blur');
  if (flags.glare) parts.push('glare');
  if (flags.dark) parts.push('dark');
  return parts.length > 0 ? parts.join('|') : 'ok';
}

function balancedAccuracy(rows: EvalRow[]) {
  const n0 = rows.filter((r) => r.classTrue === 0).length;
  const n1 = rows.filter((r) => r.classTrue === 1).length;

  const tp0 = rows.filter((r) => r.classTrue === 0 && r.classPred === 0).length;
  const tp1 = rows.filter((r) => r.classTrue === 1 && r.classPred === 1).length;

  const recall0 = n0 > 0 ? tp0 / n0 : null;
  const recall1 = n1 > 0 ? tp1 / n1 : null;

  const ba = recall0 !== null && recall1 !== null ? (recall0 + recall1) / 2 : null;

  return { n0, n1, tp0, tp1, recall0, recall1, balancedAccuracy: ba };
}

async function main() {
  const manifestPath = 'data/dataset/manifest-v1.json';
  const blindPath = 'data/dataset/blind-set-v1.json';
  const roiLabelsPath = 'data/dataset/roi-labels-v1.json';
  const calibrationPath = 'data/models/calibration-v0.json';
  const outJsonPath = 'data/eval/eval-v0.json';
  const outMdPath = 'data/eval/eval-v0.md';

  const manifest = await readJson<Manifest>(manifestPath);
  const blind = await readJson<BlindSet>(blindPath);
  const roiLabels = await readJson<RoiLabelsFile>(roiLabelsPath);
  const calibration = await readJson<CalibrationWithDataset>(calibrationPath);

  if (!calibration.dataset?.anchors) {
    throw new Error(`В calibration модели нет anchors. Пересобери калибровку через scripts/pipeline/build-calibration.ts`);
  }

  const targetWidth = calibration.dataset.targetWidth ?? 1024;
  const anchors = calibration.dataset.anchors;

  const byId = new Map(manifest.items.map((i) => [i.id, i] as const));
  const missingRoi: string[] = [];

  // Кэш признаков anchor.
  const anchorFeaturesCache = new Map<string, ReturnType<typeof extractRoiFeatures>>();

  const rows: EvalRow[] = [];

  for (const blindItem of blind.items) {
    const item = byId.get(blindItem.id);
    if (!item) {
      throw new Error(`Blind item отсутствует в manifest: ${blindItem.id}`);
    }

    const roi = roiLabels.items[item.relPath];
    if (!roi) {
      missingRoi.push(item.relPath);
      continue;
    }

    const gk = groupKey(item);
    const anchor = anchors[gk];
    if (!anchor) {
      throw new Error(`Не найден anchor для группы ${gk}. Пересобери калибровку.`);
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
    const qc = runQualityChecksForRoi(diagImage, roi);
    const diagFeatures = extractRoiFeatures(diagImage, roi);
    const delta = computeDeltaFeatures(refFeatures, diagFeatures);
    const fv = buildFeatureVector(delta, qc);

    const pred = knnPredict(calibration, fv.vector);
    const classPred = classifyPh(pred.pHEstimate, calibration.normalRange);
    const score = riskScoreFromPh(pred.pHEstimate, calibration.normalRange);
    const confidence = confidenceFromKnn(pred.avgDistance, calibration, qc.flags);

    rows.push({
      id: item.id,
      relPath: item.relPath,
      tray: item.tray,
      light: item.light,
      pHTrue: item.pH,
      classTrue: item.class,
      pHEstimate: pred.pHEstimate,
      classPred,
      score,
      confidence,
      qcFlags: qc.flags,
      avgDistance: pred.avgDistance
    });
  }

  if (missingRoi.length > 0) {
    const preview = missingRoi.slice(0, 10).join('\n');
    throw new Error(
      [
        `Не хватает ROI разметки для ${missingRoi.length} файлов (blind/anchors).`,
        `Примеры (первые 10):`,
        preview
      ].join('\n')
    );
  }

  const metrics = balancedAccuracy(rows);
  const coverage = rows.length > 0 ? rows.filter((r) => !r.qcFlags.blur && !r.qcFlags.glare && !r.qcFlags.dark).length / rows.length : 0;

  const errors = rows.filter((r) => r.classPred !== r.classTrue);

  const out = {
    ok: true,
    generatedAt: new Date().toISOString(),
    inputs: { manifestPath, blindPath, roiLabelsPath, calibrationPath },
    metrics: { ...metrics, coverage },
    rows,
    errors
  };

  await ensureDir(path.join(process.cwd(), 'data/eval'));
  await fs.writeFile(path.join(process.cwd(), outJsonPath), JSON.stringify(out, null, 2) + '\n', 'utf-8');

  const mdLines: string[] = [];
  mdLines.push(`# Eval v0`);
  mdLines.push(`Дата: ${new Date().toISOString()}`);
  mdLines.push('');
  mdLines.push(`- Blind set: \`${blindPath}\``);
  mdLines.push(`- Calibration: \`${calibrationPath}\``);
  mdLines.push('');
  mdLines.push(`## Метрики`);
  mdLines.push('');
  mdLines.push(`- Balanced Accuracy: ${metrics.balancedAccuracy ?? 'n/a'}`);
  mdLines.push(`- Recall(class0): ${metrics.recall0 ?? 'n/a'} (tp0=${metrics.tp0}/${metrics.n0})`);
  mdLines.push(`- Recall(class1): ${metrics.recall1 ?? 'n/a'} (tp1=${metrics.tp1}/${metrics.n1})`);
  mdLines.push(`- Coverage(QC ok): ${coverage}`);
  mdLines.push('');
  mdLines.push(`## Ошибки (${errors.length}/${rows.length})`);
  mdLines.push('');
  mdLines.push(`| file | true | pred | pH_true | pH_est | score | conf | qc |`);
  mdLines.push(`|---|---:|---:|---:|---:|---:|---:|---|`);
  for (const e of errors) {
    mdLines.push(
      `| \`${e.relPath}\` | ${e.classTrue} | ${e.classPred} | ${e.pHTrue} | ${e.pHEstimate.toFixed(3)} | ${e.score.toFixed(3)} | ${e.confidence.toFixed(
        3
      )} | ${formatQc(e.qcFlags)} |`
    );
  }

  mdLines.push('');
  mdLines.push(`## Все строки`);
  mdLines.push('');
  mdLines.push(`| file | true | pred | pH_true | pH_est | score | conf | qc |`);
  mdLines.push(`|---|---:|---:|---:|---:|---:|---:|---|`);
  for (const r of rows) {
    mdLines.push(
      `| \`${r.relPath}\` | ${r.classTrue} | ${r.classPred} | ${r.pHTrue} | ${r.pHEstimate.toFixed(3)} | ${r.score.toFixed(3)} | ${r.confidence.toFixed(
        3
      )} | ${formatQc(r.qcFlags)} |`
    );
  }

  await fs.writeFile(path.join(process.cwd(), outMdPath), mdLines.join('\r\n') + '\r\n', 'utf-8');

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ok: true, outJsonPath, outMdPath, metrics: out.metrics }, null, 2));
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});

