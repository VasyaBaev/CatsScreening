/**
 * Генератор data pack для web Playground.
 *
 * Что делает:
 * - читает curated V5-V8 manifest и feature-cache из уже выполненных ML-экспериментов;
 * - выбирает paired-compatible признаки, которые можно быстро обучать в браузере;
 * - создаёт облегчённые JPEG-превью, чтобы не тащить в сайт исходные 255+ MB;
 * - пишет `apps/web/public/playground/v5-v8/playground.json`.
 *
 * Почему это отдельный build-step:
 * - исходные фото остаются в `sources/` и `data/lab/`, без переименования и перемещения;
 * - web-приложение получает стабильный маленький контракт;
 * - VPS-деплой может пересобрать pack без ручной подготовки.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';

type LabManifest = {
  version: number;
  generatedAt: string;
  normalRange: {
    low: number;
    high: number;
    inclusive: boolean;
  };
  items: LabPair[];
};

type LabPair = {
  id: string;
  kind: string;
  device: string;
  lightCct: string;
  pH: number;
  class: 0 | 1;
  referencePath: string;
  diagnosticPath: string;
  captureDeltaSec: number | null;
  sourceVersion: string;
  warnings: string[];
};

type FeatureRow = {
  id: string;
  source: string;
  protocol: string;
  kind: string;
  device: string;
  lightCct: string;
  pH: number;
  class: 0 | 1;
  zone: 'low' | 'normal' | 'high';
  warnings: string[];
  sourceVersion: string;
  roiStrategy: string;
  featureSet: string;
  vectorSpec: string[];
  vector: number[];
  referenceRoi: RoiRect;
  diagnosticRoi: RoiRect;
  qcFlags?: Record<string, boolean>;
  qcMetrics?: Record<string, number>;
};

type RoiRect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

type PlaygroundFeature = {
  key: string;
  label: string;
  roiStrategy: string;
  featureSet: string;
  vectorSpec: string[];
  vector: number[];
  referenceRoi: RoiRect;
  diagnosticRoi: RoiRect;
};

type PlaygroundPair = {
  id: string;
  kind: string;
  device: string;
  lightCct: string;
  pH: number;
  class: 0 | 1;
  zone: 'low' | 'normal' | 'high';
  sourceVersion: string;
  captureDeltaSec: number | null;
  warnings: string[];
  referenceUrl: string;
  diagnosticUrl: string;
  features: Record<string, PlaygroundFeature>;
};

const rootDir = process.cwd();
const manifestPath = path.join(rootDir, 'data/lab/ph-v5-v8/manifest.json');
const featureCachePath = path.join(rootDir, 'data/eval/ph-existing-feature-cache.jsonl');
const publicRoot = path.join(rootDir, 'apps/web/public/playground/v5-v8');
const publicImageDir = path.join(publicRoot, 'images');
const outputJsonPath = path.join(publicRoot, 'playground.json');

const selectedFeatureSets = new Set(['core', 'hsv-lab', 'lab-rgb', 'delta-only']);
const selectedRoiStrategies = new Set(['fixed-wide', 'fixed-center', 'auto-flat']);

function normalizeWebPath(filePath: string): string {
  return filePath.replaceAll('\\', '/');
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, 'utf8')) as T;
}

async function readJsonl<T>(filePath: string): Promise<T[]> {
  const text = await fs.readFile(filePath, 'utf8');
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

function featureKey(row: FeatureRow): string {
  return `${row.roiStrategy}/${row.featureSet}`;
}

function featureLabel(row: FeatureRow): string {
  return `${row.roiStrategy} · ${row.featureSet}`;
}

function pHToZone(pH: number, range: LabManifest['normalRange']): 'low' | 'normal' | 'high' {
  const lowOk = range.inclusive ? pH >= range.low : pH > range.low;
  const highOk = range.inclusive ? pH <= range.high : pH < range.high;
  if (lowOk && highOk) return 'normal';
  return pH < range.low ? 'low' : 'high';
}

async function writePreview(sourcePath: string, outputName: string): Promise<string> {
  const absoluteSource = path.isAbsolute(sourcePath) ? sourcePath : path.join(rootDir, sourcePath);
  const outputPath = path.join(publicImageDir, outputName);

  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  await sharp(absoluteSource, { failOn: 'none' })
    .rotate()
    .resize({ width: 1200, withoutEnlargement: true })
    .jpeg({ quality: 76, mozjpeg: true })
    .toFile(outputPath);

  return `/playground/v5-v8/images/${normalizeWebPath(outputName)}`;
}

async function main() {
  const manifest = await readJson<LabManifest>(manifestPath);
  const featureRows = await readJsonl<FeatureRow>(featureCachePath);
  const featuresByPair = new Map<string, Record<string, PlaygroundFeature>>();

  for (const row of featureRows) {
    if (row.source !== 'V5-V8' || row.protocol !== 'paired') continue;
    if (!selectedFeatureSets.has(row.featureSet)) continue;
    if (!selectedRoiStrategies.has(row.roiStrategy)) continue;

    const features = featuresByPair.get(row.id) ?? {};
    const key = featureKey(row);
    features[key] = {
      key,
      label: featureLabel(row),
      roiStrategy: row.roiStrategy,
      featureSet: row.featureSet,
      vectorSpec: row.vectorSpec,
      vector: row.vector,
      referenceRoi: row.referenceRoi,
      diagnosticRoi: row.diagnosticRoi,
    };
    featuresByPair.set(row.id, features);
  }

  await fs.mkdir(publicImageDir, { recursive: true });

  const pairs: PlaygroundPair[] = [];
  for (const item of manifest.items) {
    const features = featuresByPair.get(item.id);
    if (!features || Object.keys(features).length === 0) {
      throw new Error(`Нет Playground features для пары ${item.id}`);
    }

    const referenceName = `${item.id}__ref.jpg`;
    const diagnosticName = `${item.id}__diag.jpg`;

    pairs.push({
      id: item.id,
      kind: item.kind,
      device: item.device,
      lightCct: item.lightCct,
      pH: item.pH,
      class: item.class,
      zone: pHToZone(item.pH, manifest.normalRange),
      sourceVersion: item.sourceVersion,
      captureDeltaSec: item.captureDeltaSec,
      warnings: item.warnings ?? [],
      referenceUrl: await writePreview(item.referencePath, referenceName),
      diagnosticUrl: await writePreview(item.diagnosticPath, diagnosticName),
      features,
    });
  }

  const featureOptions = Array.from(
    new Map(
      pairs.flatMap((pair) =>
        Object.values(pair.features).map((feature) => [
          feature.key,
          {
            key: feature.key,
            label: feature.label,
            roiStrategy: feature.roiStrategy,
            featureSet: feature.featureSet,
            vectorSpec: feature.vectorSpec,
          },
        ]),
      ),
    ).values(),
  ).sort((a, b) => a.key.localeCompare(b.key));

  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: {
      manifestPath: normalizeWebPath(path.relative(rootDir, manifestPath)),
      featureCachePath: normalizeWebPath(path.relative(rootDir, featureCachePath)),
      sourceVersions: ['V5', 'V6', 'V7', 'V8'],
    },
    normalRange: manifest.normalRange,
    defaultFeatureKey: 'fixed-wide/hsv-lab',
    featureOptions,
    pairs,
  };

  await fs.writeFile(outputJsonPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  console.log(
    JSON.stringify(
      {
        ok: true,
        output: normalizeWebPath(path.relative(rootDir, outputJsonPath)),
        imageDir: normalizeWebPath(path.relative(rootDir, publicImageDir)),
        pairs: pairs.length,
        featureOptions: featureOptions.length,
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
