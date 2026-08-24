/**
 * Локальное JSON-хранилище ручной ROI-разметки.
 *
 * Что делает:
 * - хранит актуальную разметку V5-V8 в одном JSON-файле;
 * - не трогает исходные `sources/`, потому что они остаются read-only;
 * - возвращает данные в формате shared-контракта, который потом сможет читать ML-pipeline.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  RoiLabelDatasetSchema,
  RoiPairLabelSchema,
  type RoiLabelDataset,
  type RoiPairLabel,
  type SaveRoiLabelRequest,
} from '@cats-screening/shared';

const DEFAULT_DATASET = 'v5-v8';
const defaultStorageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../storage',
);
const storageRoot = process.env.LOCAL_CAPTURE_STORAGE_DIR
  ? path.resolve(process.env.LOCAL_CAPTURE_STORAGE_DIR)
  : defaultStorageRoot;
const labelsPath = path.join(storageRoot, 'roi-labels-v5-v8.json');

function emptyDataset(dataset = DEFAULT_DATASET): RoiLabelDataset {
  return {
    version: 1,
    dataset,
    updatedAt: null,
    labels: {},
  };
}

export async function readLocalRoiLabels(): Promise<RoiLabelDataset> {
  try {
    const text = await readFile(labelsPath, 'utf8');
    return RoiLabelDatasetSchema.parse(JSON.parse(text));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyDataset();
    throw error;
  }
}

export async function saveLocalRoiLabel(input: SaveRoiLabelRequest): Promise<RoiPairLabel> {
  await mkdir(storageRoot, { recursive: true });

  const current = await readLocalRoiLabels();
  const now = new Date().toISOString();
  const label = RoiPairLabelSchema.parse({
    ...input,
    dataset: input.dataset || current.dataset || DEFAULT_DATASET,
    updatedAt: now,
  });
  const next = RoiLabelDatasetSchema.parse({
    ...current,
    dataset: current.dataset || label.dataset || DEFAULT_DATASET,
    updatedAt: now,
    labels: {
      ...current.labels,
      [label.pairId]: label,
    },
  });

  await writeFile(labelsPath, `${JSON.stringify(next, null, 2)}\r\n`, 'utf8');
  return label;
}
