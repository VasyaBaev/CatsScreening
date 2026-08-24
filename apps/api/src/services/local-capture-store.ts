/**
 * Локальный JSONL-manifest для capture-MVP.
 *
 * Почему это нужно:
 * - локальный запуск не должен требовать Postgres credentials;
 * - каждая отправленная пара должна оставаться воспроизводимой для ML-pipeline;
 * - формат JSONL легко импортировать в будущий catalog builder.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  CaptureAttemptSchema,
  type CaptureAttempt,
  type CaptureAttemptUpload,
  type CaptureTask,
  type CreateCaptureAttemptRequest,
  type CreateCaseRequest,
  type FinalizeCaptureAttemptRequest,
  type RoiShape,
} from '@cats-screening/shared';

export type LocalStoredCase = {
  id: string;
  createdAt: string;
  score: number | null;
  confidence: number | null;
  metadata: unknown;
  qc: unknown;
  images: Array<{ kind: string; uri: string }>;
};

const defaultStorageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../storage',
);
const storageRoot = process.env.LOCAL_CAPTURE_STORAGE_DIR
  ? path.resolve(process.env.LOCAL_CAPTURE_STORAGE_DIR)
  : defaultStorageRoot;
const manifestPath = path.join(storageRoot, 'cases.jsonl');
const captureRoot = path.join(storageRoot, 'capture-hotfix');
const attemptRoot = path.join(captureRoot, 'attempts');
const captureManifestPath = path.join(captureRoot, 'cases.jsonl');

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
  confidence: number | null,
): Promise<LocalStoredCase> {
  await mkdir(storageRoot, { recursive: true });

  const item: LocalStoredCase = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    score,
    confidence,
    metadata: input.metadata,
    qc,
    images: input.images.map((image) => ({ kind: image.kind, uri: image.uri })),
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

export type FreshCaptureCase = {
  id: string;
  attemptId: string;
  createdAt: string;
  included: boolean;
  exclusionReason: string | null;
  taskCode: string;
  taskType: CaptureTask['taskType'];
  specimenId: string;
  sourcePh: number;
  finalMixturePh: number | null;
  operatorId: string;
  device: string;
  series: string;
  condition: CaptureAttempt['condition'];
  reactionStartedAt: string;
  images: CaptureAttemptUpload[];
};

function attemptPath(attemptId: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(attemptId)) throw new Error('ATTEMPT_NOT_FOUND');
  return path.join(attemptRoot, `${attemptId}.json`);
}

async function writeJsonAtomically(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\r\n`, 'utf8');
  await rename(temporaryPath, filePath);
}

export async function getLocalCaptureAttempt(attemptId: string): Promise<CaptureAttempt> {
  try {
    const raw = JSON.parse(await readFile(attemptPath(attemptId), 'utf8')) as unknown;
    return CaptureAttemptSchema.parse(raw);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('ATTEMPT_NOT_FOUND');
    throw error;
  }
}

export async function createLocalCaptureAttempt(
  task: CaptureTask,
  input: CreateCaptureAttemptRequest,
): Promise<CaptureAttempt> {
  const now = new Date().toISOString();
  const attempt: CaptureAttempt = {
    id: randomUUID(),
    task,
    status: 'active',
    operatorId: input.operatorId,
    device: input.device,
    series: input.series,
    condition: {
      lightLabel: input.lightLabel,
      angleLabel: input.angleLabel,
      distanceLabel: input.distanceLabel,
    },
    reactionStartedAt: now,
    finalMixturePh: null,
    uploads: {},
    createdAt: now,
    updatedAt: now,
    result: null,
  };

  await writeJsonAtomically(attemptPath(attempt.id), attempt);
  return attempt;
}

export async function saveLocalAttemptUpload(
  attemptId: string,
  upload: CaptureAttemptUpload,
): Promise<CaptureAttempt> {
  const attempt = await getLocalCaptureAttempt(attemptId);
  if (attempt.status === 'finalized') throw new Error('ATTEMPT_FINALIZED');

  const slot = attempt.task.slots.find((item) => item.key === upload.slotKey);
  if (!slot || slot.kind !== upload.kind) throw new Error('SLOT_NOT_FOUND');

  const updated: CaptureAttempt = {
    ...attempt,
    uploads: { ...attempt.uploads, [upload.slotKey]: upload },
    updatedAt: new Date().toISOString(),
  };
  await writeJsonAtomically(attemptPath(attemptId), updated);
  return updated;
}

export async function saveLocalAttemptSlotRoi(
  attemptId: string,
  slotKey: string,
  roi: RoiShape,
): Promise<CaptureAttempt> {
  const attempt = await getLocalCaptureAttempt(attemptId);
  if (attempt.status === 'finalized') throw new Error('ATTEMPT_FINALIZED');

  const upload = attempt.uploads[slotKey];
  if (!upload) throw new Error('SLOT_UPLOAD_NOT_FOUND');

  const updated: CaptureAttempt = {
    ...attempt,
    uploads: {
      ...attempt.uploads,
      [slotKey]: { ...upload, roi },
    },
    updatedAt: new Date().toISOString(),
  };
  await writeJsonAtomically(attemptPath(attemptId), updated);
  return updated;
}

async function readFreshCaptureCases(): Promise<FreshCaptureCase[]> {
  try {
    const text = await readFile(captureManifestPath, 'utf8');
    return text
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as FreshCaptureCase);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

function caseFromAttempt(attempt: CaptureAttempt): FreshCaptureCase {
  if (!attempt.result) throw new Error('ATTEMPT_NOT_FINALIZED');
  return {
    id: attempt.result.caseId,
    attemptId: attempt.id,
    createdAt: attempt.result.finalizedAt,
    included: attempt.result.included,
    exclusionReason: attempt.result.exclusionReason,
    taskCode: attempt.task.code,
    taskType: attempt.task.taskType,
    specimenId: attempt.task.specimenId,
    sourcePh: attempt.task.sourcePh,
    finalMixturePh: attempt.finalMixturePh,
    operatorId: attempt.operatorId,
    device: attempt.device,
    series: attempt.series,
    condition: attempt.condition,
    reactionStartedAt: attempt.reactionStartedAt,
    images: attempt.task.slots
      .map((slot) => attempt.uploads[slot.key])
      .filter((upload): upload is CaptureAttemptUpload => Boolean(upload)),
  };
}

async function ensureFreshCaseManifest(attempt: CaptureAttempt): Promise<void> {
  const item = caseFromAttempt(attempt);
  const items = await readFreshCaptureCases();
  if (items.some((current) => current.id === item.id)) return;

  items.push(item);
  await mkdir(captureRoot, { recursive: true });
  await writeFile(
    captureManifestPath,
    `${items.map((current) => JSON.stringify(current)).join('\r\n')}\r\n`,
    'utf8',
  );
}

export async function finalizeLocalCaptureAttempt(
  attemptId: string,
  input: FinalizeCaptureAttemptRequest,
): Promise<CaptureAttempt> {
  const attempt = await getLocalCaptureAttempt(attemptId);
  if (attempt.status === 'finalized') {
    await ensureFreshCaseManifest(attempt);
    return attempt;
  }

  const missing = attempt.task.slots
    .filter((slot) => slot.required && !attempt.uploads[slot.key])
    .map((slot) => slot.key);
  if (missing.length > 0) throw new Error(`REQUIRED_SLOTS_MISSING:${missing.join(',')}`);

  const finalizedAt = new Date().toISOString();
  const finalized: CaptureAttempt = {
    ...attempt,
    status: 'finalized',
    finalMixturePh: attempt.task.taskType === 'blank_qc' ? null : input.finalMixturePh,
    updatedAt: finalizedAt,
    result: {
      caseId: randomUUID(),
      finalizedAt,
      included: input.included,
      exclusionReason: input.exclusionReason,
    },
  };

  await writeJsonAtomically(attemptPath(attemptId), finalized);
  await ensureFreshCaseManifest(finalized);
  return finalized;
}

export async function listFreshCaptureCases(): Promise<FreshCaptureCase[]> {
  return (await readFreshCaptureCases()).reverse();
}
