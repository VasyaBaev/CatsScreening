/**
 * Локальный JSONL-manifest для capture-MVP.
 *
 * Почему это нужно:
 * - локальный запуск не должен требовать Postgres credentials;
 * - каждая отправленная пара должна оставаться воспроизводимой для ML-pipeline;
 * - формат JSONL легко импортировать в будущий catalog builder.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import type { CreateCaseRequest } from '@cats-screening/shared';

export type LocalStoredCase = {
  id: string;
  createdAt: string;
  score: number | null;
  confidence: number | null;
  metadata: unknown;
  qc: unknown;
  images: Array<{ kind: string; uri: string }>;
};

const defaultStorageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../storage');
const storageRoot = process.env.LOCAL_CAPTURE_STORAGE_DIR
  ? path.resolve(process.env.LOCAL_CAPTURE_STORAGE_DIR)
  : defaultStorageRoot;
const manifestPath = path.join(storageRoot, 'cases.jsonl');

async function readManifestLines(): Promise<string[]> {
  try {
    const text = await readFile(manifestPath, 'utf8');
    return text.split(/\r?\n/).filter(Boolean);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

export async function appendLocalCase(
  input: CreateCaseRequest,
  qc: unknown,
  score: number | null,
  confidence: number | null
): Promise<LocalStoredCase> {
  await mkdir(storageRoot, { recursive: true });

  const item: LocalStoredCase = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    score,
    confidence,
    metadata: input.metadata,
    qc,
    images: input.images.map((image) => ({ kind: image.kind, uri: image.uri }))
  };

  const lines = await readManifestLines();
  lines.push(JSON.stringify(item));
  await writeFile(manifestPath, `${lines.join('\r\n')}\r\n`, 'utf8');

  return item;
}

export async function listLocalCases(limit: number, offset: number): Promise<LocalStoredCase[]> {
  const lines = await readManifestLines();
  return lines
    .map((line) => JSON.parse(line) as LocalStoredCase)
    .reverse()
    .slice(offset, offset + limit);
}

export async function listAllLocalCases(): Promise<LocalStoredCase[]> {
  const lines = await readManifestLines();
  return lines.map((line) => JSON.parse(line) as LocalStoredCase).reverse();
}
