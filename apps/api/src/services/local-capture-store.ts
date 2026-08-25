/**
 * Локальный JSONL-manifest для capture-MVP.
 *
 * Почему это нужно:
 * - локальный запуск не должен требовать Postgres credentials;
 * - каждая отправленная пара должна оставаться воспроизводимой для ML-pipeline;
 * - формат JSONL легко импортировать в будущий catalog builder.
 */

import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  CaptureAttemptSchema,
  CaptureContextSchema,
  CaptureQuotaSummarySchema,
  type CaptureAttempt,
  type CaptureAttemptUpload,
  type CaptureContext,
  type CaptureContextQuery,
  type CapturePolicy,
  type CaptureQuotaSummary,
  type CaptureSharedSpecimen,
  type CaptureTask,
  type CreateCaptureAttemptRequest,
  type CreateCaseRequest,
  type CreatePolicyCaptureAttemptRequest,
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

export async function listLocalCaptureAttempts(): Promise<CaptureAttempt[]> {
  try {
    const entries = (await readdir(attemptRoot, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => entry.name);
    const attempts = await Promise.all(
      entries.map(async (entry) => {
        const raw = JSON.parse(await readFile(path.join(attemptRoot, entry), 'utf8')) as unknown;
        return CaptureAttemptSchema.parse(raw);
      }),
    );
    return attempts.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

function belongsToPolicy(attempt: CaptureAttempt, policy: CapturePolicy): boolean {
  return (
    attempt.policySnapshot?.policyId === policy.policyId &&
    attempt.policySnapshot.seriesId === policy.seriesId
  );
}

export function summarizeCapturePolicyQuotas(
  policy: CapturePolicy,
  attempts: CaptureAttempt[],
): CaptureQuotaSummary {
  const currentAttempts = attempts.filter((attempt) => belongsToPolicy(attempt, policy));
  const cells = policy.quotas.map((quota) => {
    const matching = currentAttempts.filter(
      (attempt) =>
        attempt.task.sourcePh === quota.sourcePh &&
        attempt.deviceRole === quota.deviceRole &&
        attempt.specimenMode === quota.specimenMode,
    );
    const actual = matching.filter(
      (attempt) => attempt.status === 'finalized' && attempt.result?.included === true,
    ).length;
    const reserved = matching.filter((attempt) => attempt.status === 'active').length;
    return {
      ...quota,
      actual,
      reserved,
      available: Math.max(0, quota.target - actual - reserved),
    };
  });

  return CaptureQuotaSummarySchema.parse({
    policyId: policy.policyId,
    policyVersion: policy.version,
    seriesId: policy.seriesId,
    target: cells.reduce((total, cell) => total + cell.target, 0),
    actual: cells.reduce((total, cell) => total + cell.actual, 0),
    reserved: cells.reduce((total, cell) => total + cell.reserved, 0),
    available: cells.reduce((total, cell) => total + cell.available, 0),
    cells,
  });
}

function availableSharedSpecimens(
  policy: CapturePolicy,
  attempts: CaptureAttempt[],
  query: CaptureContextQuery,
): CaptureSharedSpecimen[] {
  if (query.specimenMode && query.specimenMode !== 'shared') return [];

  const groups = new Map<
    string,
    {
      displayLabel: string;
      sourcePh: number;
      completed: Set<string>;
      reserved: Set<string>;
    }
  >();
  for (const attempt of attempts) {
    if (
      !belongsToPolicy(attempt, policy) ||
      attempt.specimenMode !== 'shared' ||
      !attempt.deviceRole ||
      !attempt.displayLabel
    ) {
      continue;
    }
    if (query.sourcePh !== undefined && attempt.task.sourcePh !== query.sourcePh) continue;

    const group = groups.get(attempt.task.specimenId) ?? {
      displayLabel: attempt.displayLabel,
      sourcePh: attempt.task.sourcePh,
      completed: new Set<string>(),
      reserved: new Set<string>(),
    };
    if (attempt.status === 'active') group.reserved.add(attempt.deviceRole);
    if (attempt.status === 'finalized' && attempt.result?.included) {
      group.completed.add(attempt.deviceRole);
    }
    groups.set(attempt.task.specimenId, group);
  }

  const roles = policy.deviceRoles.map((role) => role.value);
  return [...groups.entries()]
    .map(([specimenId, group]) => ({
      specimenId,
      displayLabel: group.displayLabel,
      sourcePh: group.sourcePh,
      completedDeviceRoles: [...group.completed],
      reservedDeviceRoles: [...group.reserved],
      missingDeviceRoles: roles.filter(
        (role) => !group.completed.has(role) && !group.reserved.has(role),
      ),
    }))
    .filter(
      (specimen) =>
        !query.deviceRole ||
        (!specimen.completedDeviceRoles.includes(query.deviceRole) &&
          !specimen.reservedDeviceRoles.includes(query.deviceRole)),
    );
}

export async function getLocalCaptureContext(
  policy: CapturePolicy,
  query: CaptureContextQuery = {},
): Promise<CaptureContext> {
  const attempts = await listLocalCaptureAttempts();
  return CaptureContextSchema.parse({
    policy,
    quotaSummary: summarizeCapturePolicyQuotas(policy, attempts),
    availableSharedSpecimens: availableSharedSpecimens(policy, attempts, query),
  });
}

function assertPolicySelection(
  policy: CapturePolicy,
  input: CreatePolicyCaptureAttemptRequest,
): void {
  if (policy.status !== 'active') throw new Error('CAPTURE_POLICY_DRAFT');
  if (!policy.sourcePhValues.includes(input.sourcePh)) throw new Error('SOURCE_PH_NOT_ALLOWED');
  if (input.referencePh !== policy.referencePh) throw new Error('REFERENCE_PH_NOT_ALLOWED');
  if (!policy.deviceRoles.some((role) => role.value === input.deviceRole)) {
    throw new Error('DEVICE_ROLE_NOT_ALLOWED');
  }
  if (!policy.specimenModes.includes(input.specimenMode)) {
    throw new Error('SPECIMEN_MODE_NOT_ALLOWED');
  }
  if (!policy.conditions.lights.some((option) => option.value === input.lightLabel)) {
    throw new Error('LIGHT_NOT_ALLOWED');
  }
  if (!policy.conditions.angles.some((option) => option.value === input.angleLabel)) {
    throw new Error('ANGLE_NOT_ALLOWED');
  }
  if (!policy.conditions.distances.some((option) => option.value === input.distanceLabel)) {
    throw new Error('DISTANCE_NOT_ALLOWED');
  }
  if (
    !policy.quotas.some(
      (quota) =>
        quota.sourcePh === input.sourcePh &&
        quota.deviceRole === input.deviceRole &&
        quota.specimenMode === input.specimenMode,
    )
  ) {
    throw new Error('CAPTURE_QUOTA_NOT_DECLARED');
  }
  if (input.specimenMode === 'independent' && input.sharedSpecimenId) {
    throw new Error('SHARED_SPECIMEN_NOT_ALLOWED');
  }
}

export async function createPolicyCaptureAttempt(
  policy: CapturePolicy,
  input: CreatePolicyCaptureAttemptRequest,
): Promise<CaptureAttempt> {
  assertPolicySelection(policy, input);
  const attempts = await listLocalCaptureAttempts();
  let specimenId = input.sharedSpecimenId ?? randomUUID();
  let displayLabel = `Образец #${specimenId.slice(0, 8)}`;

  if (input.specimenMode === 'shared' && input.sharedSpecimenId) {
    const sameSpecimen = attempts.filter(
      (attempt) =>
        belongsToPolicy(attempt, policy) &&
        attempt.specimenMode === 'shared' &&
        attempt.task.specimenId === input.sharedSpecimenId,
    );
    if (sameSpecimen.length === 0) throw new Error('SHARED_SPECIMEN_NOT_FOUND');
    if (sameSpecimen.some((attempt) => attempt.task.sourcePh !== input.sourcePh)) {
      throw new Error('SHARED_SPECIMEN_PH_MISMATCH');
    }
    const existing = sameSpecimen.find((attempt) => attempt.deviceRole === input.deviceRole);
    if (existing?.status === 'active') return existing;
    if (existing?.status === 'finalized' && existing.result?.included) {
      throw new Error('SHARED_SPECIMEN_ROLE_COMPLETE');
    }
    displayLabel = sameSpecimen[0]?.displayLabel ?? displayLabel;
  }

  const summary = summarizeCapturePolicyQuotas(policy, attempts);
  const quota = summary.cells.find(
    (cell) =>
      cell.sourcePh === input.sourcePh &&
      cell.deviceRole === input.deviceRole &&
      cell.specimenMode === input.specimenMode,
  );
  if (!quota || quota.available === 0) throw new Error('CAPTURE_QUOTA_FULL');

  const pairId = randomUUID();
  const now = new Date().toISOString();
  const task: CaptureTask = {
    code: pairId,
    taskType: 'reacted_specimen',
    specimenId,
    sourcePh: input.sourcePh,
    slots: [
      {
        key: 'reference',
        kind: 'reference',
        label: 'До реакции',
        required: true,
        targetSeconds: null,
        toleranceSeconds: null,
      },
      {
        key: 'diagnostic',
        kind: 'diagnostic',
        label: 'После реакции',
        required: true,
        targetSeconds: policy.reactionTargetSeconds,
        toleranceSeconds: policy.reactionToleranceSeconds,
      },
    ],
  };
  const deviceLabel =
    policy.deviceRoles.find((role) => role.value === input.deviceRole)?.label ?? input.deviceRole;
  const attempt = CaptureAttemptSchema.parse({
    id: randomUUID(),
    task,
    status: 'active',
    operatorId: input.operatorId,
    device: deviceLabel,
    series: policy.seriesId,
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
    policySnapshot: policy,
    pairId,
    displayLabel,
    deviceRole: input.deviceRole,
    specimenMode: input.specimenMode,
    referencePh: input.referencePh,
  });

  await writeJsonAtomically(attemptPath(attempt.id), attempt);
  return attempt;
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
