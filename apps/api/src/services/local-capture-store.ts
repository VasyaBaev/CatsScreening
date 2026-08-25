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
  type CreateCaptureReplacementRequest,
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

let transitionQueue = Promise.resolve();

function withCaptureTransition<T>(operation: () => Promise<T>): Promise<T> {
  const result = transitionQueue.then(operation, operation);
  transitionQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

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
  attemptStatus: CaptureAttempt['status'];
  included: boolean;
  exclusionReason: string | null;
  policySnapshot: CapturePolicy | null;
  pairId: string | null;
  displayLabel: string | null;
  taskCode: string;
  taskType: CaptureTask['taskType'];
  specimenId: string;
  sourcePh: number;
  referencePh: number | null;
  finalMixturePh: number | null;
  operatorId: string;
  device: string;
  deviceRole: string | null;
  specimenMode: CaptureAttempt['specimenMode'] | null;
  series: string;
  condition: CaptureAttempt['condition'];
  reactionStartedAt: string | null;
  diagnosticSavedAt: string | null;
  reactionElapsedSec: number | null;
  replacesAttemptId: string | null;
  replacedByAttemptId: string | null;
  images: CaptureAttemptUpload[];
};

function attemptPath(attemptId: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(attemptId)) throw new Error('ATTEMPT_NOT_FOUND');
  return path.join(attemptRoot, `${attemptId}.json`);
}

async function writeTextAtomically(filePath: string, text: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, text, 'utf8');
  await rename(temporaryPath, filePath);
}

async function writeJsonAtomically(filePath: string, value: unknown): Promise<void> {
  await writeTextAtomically(filePath, `${JSON.stringify(value, null, 2)}\r\n`);
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

export type CaptureAdminSummary = {
  policy: Pick<CapturePolicy, 'policyId' | 'version' | 'seriesId' | 'status'>;
  counts: {
    attempts: number;
    cases: number;
    finalizedIncluded: number;
    active: number;
    reserved: number;
    abandoned: number;
    superseded: number;
    reshoots: number;
    excluded: number;
  };
  quota: {
    target: number;
    actual: number;
    missing: number;
    cells: Array<CaptureQuotaSummary['cells'][number] & { missing: number }>;
  };
};

export function summarizeCaptureAdmin(
  policy: CapturePolicy,
  attempts: CaptureAttempt[],
  cases: FreshCaptureCase[],
): CaptureAdminSummary {
  const relevantAttempts = attempts.filter((attempt) => belongsToPolicy(attempt, policy));
  const relevantCases = cases.filter(
    (item) =>
      item.policySnapshot?.policyId === policy.policyId &&
      item.policySnapshot.seriesId === policy.seriesId,
  );
  const quota = summarizeCapturePolicyQuotas(policy, relevantAttempts);
  const cells = quota.cells.map((cell) => ({
    ...cell,
    missing: Math.max(0, cell.target - cell.actual),
  }));
  return {
    policy: {
      policyId: policy.policyId,
      version: policy.version,
      seriesId: policy.seriesId,
      status: policy.status,
    },
    counts: {
      attempts: relevantAttempts.length,
      cases: relevantCases.length,
      finalizedIncluded: relevantAttempts.filter(
        (attempt) => attempt.status === 'finalized' && attempt.result?.included === true,
      ).length,
      active: relevantAttempts.filter((attempt) => attempt.status === 'active').length,
      reserved: relevantAttempts.filter((attempt) => attempt.status === 'active').length,
      abandoned: relevantAttempts.filter((attempt) => attempt.status === 'abandoned').length,
      superseded: relevantAttempts.filter((attempt) => attempt.status === 'superseded').length,
      reshoots: relevantAttempts.filter((attempt) => Boolean(attempt.replacesAttemptId)).length,
      excluded: relevantAttempts.filter((attempt) => attempt.result?.included === false).length,
    },
    quota: {
      target: quota.target,
      actual: quota.actual,
      missing: Math.max(0, quota.target - quota.actual),
      cells,
    },
  };
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

async function createPolicyCaptureAttemptUnlocked(
  policy: CapturePolicy,
  input: CreatePolicyCaptureAttemptRequest,
  options: { specimenId?: string; replacesAttemptId?: string; clientRequestId?: string } = {},
): Promise<CaptureAttempt> {
  assertPolicySelection(policy, input);
  const attempts = await listLocalCaptureAttempts();
  if (options.clientRequestId) {
    const existing = attempts.find(
      (attempt) =>
        belongsToPolicy(attempt, policy) && attempt.clientRequestId === options.clientRequestId,
    );
    if (existing) return existing;
  }
  const selectedSharedSpecimenId = options.specimenId ?? input.sharedSpecimenId;
  const specimenId = selectedSharedSpecimenId ?? randomUUID();
  let displayLabel = `Образец #${specimenId.slice(0, 8)}`;

  if (input.specimenMode === 'shared' && selectedSharedSpecimenId) {
    const sameSpecimen = attempts.filter(
      (attempt) =>
        belongsToPolicy(attempt, policy) &&
        attempt.specimenMode === 'shared' &&
        attempt.task.specimenId === selectedSharedSpecimenId,
    );
    if (sameSpecimen.length === 0) throw new Error('SHARED_SPECIMEN_NOT_FOUND');
    if (sameSpecimen.some((attempt) => attempt.task.sourcePh !== input.sourcePh)) {
      throw new Error('SHARED_SPECIMEN_PH_MISMATCH');
    }
    const activeExisting = sameSpecimen.find(
      (attempt) => attempt.deviceRole === input.deviceRole && attempt.status === 'active',
    );
    if (activeExisting) return activeExisting;
    if (
      sameSpecimen.some(
        (attempt) =>
          attempt.deviceRole === input.deviceRole &&
          attempt.status === 'finalized' &&
          attempt.result?.included,
      )
    ) {
      throw new Error('SHARED_SPECIMEN_ROLE_COMPLETE');
    }
    displayLabel = sameSpecimen[0]?.displayLabel ?? displayLabel;
  } else if (options.specimenId) {
    displayLabel =
      attempts.find((attempt) => attempt.task.specimenId === options.specimenId)?.displayLabel ??
      displayLabel;
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
    reactionStartedAt: null,
    diagnosticSavedAt: null,
    reactionElapsedSec: null,
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
    clientRequestId: options.clientRequestId,
    replacesAttemptId: options.replacesAttemptId,
  });

  await writeJsonAtomically(attemptPath(attempt.id), attempt);
  return attempt;
}

export function createPolicyCaptureAttempt(
  policy: CapturePolicy,
  input: CreatePolicyCaptureAttemptRequest,
  clientRequestId?: string,
): Promise<CaptureAttempt> {
  return withCaptureTransition(() =>
    createPolicyCaptureAttemptUnlocked(policy, input, { clientRequestId }),
  );
}

export async function getLocalCaptureAttemptByClientRequestId(
  policy: CapturePolicy,
  clientRequestId: string,
): Promise<CaptureAttempt> {
  const attempt = (await listLocalCaptureAttempts()).find(
    (item) => belongsToPolicy(item, policy) && item.clientRequestId === clientRequestId,
  );
  if (!attempt) throw new Error('ATTEMPT_NOT_FOUND');
  return attempt;
}

async function saveLocalAttemptUploadUnlocked(
  attemptId: string,
  upload: CaptureAttemptUpload,
): Promise<CaptureAttempt> {
  const attempt = await getLocalCaptureAttempt(attemptId);
  if (attempt.status !== 'active') throw new Error('ATTEMPT_NOT_ACTIVE');

  const slot = attempt.task.slots.find((item) => item.key === upload.slotKey);
  if (!slot || slot.kind !== upload.kind) throw new Error('SLOT_NOT_FOUND');
  if (slot.kind === 'reference' && attempt.reactionStartedAt) {
    throw new Error('REFERENCE_LOCKED_AFTER_REACTION');
  }
  if (slot.kind === 'diagnostic' && !attempt.reactionStartedAt) {
    throw new Error('REACTION_NOT_STARTED');
  }
  if (slot.kind === 'diagnostic' && attempt.uploads[slot.key]) {
    throw new Error('DIAGNOSTIC_LOCKED_AFTER_UPLOAD');
  }

  const reactionElapsedSec =
    slot.kind === 'diagnostic' && attempt.reactionStartedAt
      ? Math.max(
          0,
          (new Date(upload.savedAt).getTime() - new Date(attempt.reactionStartedAt).getTime()) /
            1000,
        )
      : attempt.reactionElapsedSec;

  const updated: CaptureAttempt = {
    ...attempt,
    uploads: { ...attempt.uploads, [upload.slotKey]: upload },
    diagnosticSavedAt: slot.kind === 'diagnostic' ? upload.savedAt : attempt.diagnosticSavedAt,
    reactionElapsedSec,
    updatedAt: new Date().toISOString(),
  };
  await writeJsonAtomically(attemptPath(attemptId), updated);
  return updated;
}

export function saveLocalAttemptUpload(
  attemptId: string,
  upload: CaptureAttemptUpload,
): Promise<CaptureAttempt> {
  return withCaptureTransition(() => saveLocalAttemptUploadUnlocked(attemptId, upload));
}

async function saveLocalAttemptSlotRoiUnlocked(
  attemptId: string,
  slotKey: string,
  roi: RoiShape,
): Promise<CaptureAttempt> {
  const attempt = await getLocalCaptureAttempt(attemptId);
  if (attempt.status !== 'active') throw new Error('ATTEMPT_NOT_ACTIVE');

  const upload = attempt.uploads[slotKey];
  if (!upload) throw new Error('SLOT_UPLOAD_NOT_FOUND');
  if (upload.kind === 'reference' && attempt.reactionStartedAt) {
    const diagnosticSaved = attempt.task.slots.some(
      (slot) => slot.kind === 'diagnostic' && Boolean(attempt.uploads[slot.key]),
    );
    if (!diagnosticSaved) throw new Error('REFERENCE_ROI_LOCKED_UNTIL_DIAGNOSTIC');
  }

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

export function saveLocalAttemptSlotRoi(
  attemptId: string,
  slotKey: string,
  roi: RoiShape,
): Promise<CaptureAttempt> {
  return withCaptureTransition(() => saveLocalAttemptSlotRoiUnlocked(attemptId, slotKey, roi));
}

export function startLocalCaptureReaction(
  attemptId: string,
  startedAt: Date = new Date(),
): Promise<CaptureAttempt> {
  return withCaptureTransition(async () => {
    const attempt = await getLocalCaptureAttempt(attemptId);
    if (attempt.status !== 'active') throw new Error('ATTEMPT_NOT_ACTIVE');
    if (attempt.reactionStartedAt) return attempt;

    const referenceSlot = attempt.task.slots.find((slot) => slot.kind === 'reference');
    const referenceUpload = referenceSlot ? attempt.uploads[referenceSlot.key] : undefined;
    if (!referenceUpload) throw new Error('REFERENCE_UPLOAD_REQUIRED');
    if (!Number.isFinite(startedAt.getTime())) throw new Error('INVALID_REACTION_START_TIME');

    const updated: CaptureAttempt = {
      ...attempt,
      reactionStartedAt: startedAt.toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await writeJsonAtomically(attemptPath(attemptId), updated);
    return updated;
  });
}

export function replaceLocalCaptureAttempt(
  policy: CapturePolicy,
  attemptId: string,
  input: CreateCaptureReplacementRequest,
): Promise<{ previousAttempt: CaptureAttempt; replacementAttempt: CaptureAttempt }> {
  return withCaptureTransition(async () => {
    const previousAttempt = await getLocalCaptureAttempt(attemptId);
    if (previousAttempt.replacedByAttemptId) {
      return {
        previousAttempt,
        replacementAttempt: await getLocalCaptureAttempt(previousAttempt.replacedByAttemptId),
      };
    }
    if (previousAttempt.status !== 'active' && previousAttempt.status !== 'finalized') {
      throw new Error('ATTEMPT_NOT_REPLACEABLE');
    }
    if (!belongsToPolicy(previousAttempt, policy)) throw new Error('CAPTURE_POLICY_MISMATCH');
    if (input.deviceRole !== previousAttempt.deviceRole) {
      throw new Error('REPLACEMENT_DEVICE_ROLE_MISMATCH');
    }
    if (input.specimenChoice === 'same') {
      if (input.specimenMode !== previousAttempt.specimenMode) {
        throw new Error('SAME_SPECIMEN_MODE_MISMATCH');
      }
      if (input.sourcePh !== previousAttempt.task.sourcePh) {
        throw new Error('SAME_SPECIMEN_PH_MISMATCH');
      }
    }

    const { specimenChoice: _specimenChoice, ...selection } = input;
    const replacementInput: CreatePolicyCaptureAttemptRequest = {
      ...selection,
      sharedSpecimenId: null,
    };
    const transitioned: CaptureAttempt = {
      ...previousAttempt,
      status: previousAttempt.status === 'finalized' ? 'superseded' : 'abandoned',
      updatedAt: new Date().toISOString(),
    };
    await writeJsonAtomically(attemptPath(previousAttempt.id), transitioned);

    let replacementAttempt: CaptureAttempt;
    try {
      replacementAttempt = await createPolicyCaptureAttemptUnlocked(policy, replacementInput, {
        specimenId: input.specimenChoice === 'same' ? previousAttempt.task.specimenId : undefined,
        replacesAttemptId: previousAttempt.id,
      });
    } catch (error) {
      await writeJsonAtomically(attemptPath(previousAttempt.id), previousAttempt);
      throw error;
    }

    const linkedPrevious: CaptureAttempt = {
      ...transitioned,
      replacedByAttemptId: replacementAttempt.id,
    };
    await writeJsonAtomically(attemptPath(previousAttempt.id), linkedPrevious);
    if (linkedPrevious.result) await ensureFreshCaseManifest(linkedPrevious);
    return { previousAttempt: linkedPrevious, replacementAttempt };
  });
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
    attemptStatus: attempt.status,
    included: attempt.result.included,
    exclusionReason: attempt.result.exclusionReason,
    policySnapshot: attempt.policySnapshot ?? null,
    pairId: attempt.pairId ?? null,
    displayLabel: attempt.displayLabel ?? null,
    taskCode: attempt.task.code,
    taskType: attempt.task.taskType,
    specimenId: attempt.task.specimenId,
    sourcePh: attempt.task.sourcePh,
    referencePh: attempt.referencePh ?? null,
    finalMixturePh: attempt.finalMixturePh,
    operatorId: attempt.operatorId,
    device: attempt.device,
    deviceRole: attempt.deviceRole ?? null,
    specimenMode: attempt.specimenMode ?? null,
    series: attempt.series,
    condition: attempt.condition,
    reactionStartedAt: attempt.reactionStartedAt,
    diagnosticSavedAt: attempt.diagnosticSavedAt,
    reactionElapsedSec: attempt.reactionElapsedSec,
    replacesAttemptId: attempt.replacesAttemptId ?? null,
    replacedByAttemptId: attempt.replacedByAttemptId ?? null,
    images: attempt.task.slots
      .map((slot) => attempt.uploads[slot.key])
      .filter((upload): upload is CaptureAttemptUpload => Boolean(upload)),
  };
}

async function ensureFreshCaseManifest(attempt: CaptureAttempt): Promise<void> {
  const item = caseFromAttempt(attempt);
  const items = await readFreshCaptureCases();
  const existingIndex = items.findIndex((current) => current.id === item.id);
  if (existingIndex >= 0) items[existingIndex] = item;
  else items.push(item);
  await writeTextAtomically(
    captureManifestPath,
    `${items.map((current) => JSON.stringify(current)).join('\r\n')}\r\n`,
  );
}

async function finalizeLocalCaptureAttemptUnlocked(
  attemptId: string,
  input: FinalizeCaptureAttemptRequest,
): Promise<CaptureAttempt> {
  const attempt = await getLocalCaptureAttempt(attemptId);
  if (attempt.status === 'finalized') {
    await ensureFreshCaseManifest(attempt);
    return attempt;
  }
  if (attempt.status !== 'active') throw new Error('ATTEMPT_NOT_ACTIVE');

  const missing = attempt.task.slots
    .filter((slot) => slot.required && !attempt.uploads[slot.key])
    .map((slot) => slot.key);
  if (missing.length > 0) throw new Error(`REQUIRED_SLOTS_MISSING:${missing.join(',')}`);

  const missingRois = attempt.task.slots
    .filter((slot) => slot.required && !attempt.uploads[slot.key]?.roi)
    .map((slot) => slot.key);
  if (missingRois.length > 0) throw new Error(`REQUIRED_ROIS_MISSING:${missingRois.join(',')}`);

  if (attempt.policySnapshot?.requirePolygonRoi) {
    const invalidRois = attempt.task.slots
      .filter((slot) => slot.required && attempt.uploads[slot.key]?.roi?.shape !== 'polygon')
      .map((slot) => slot.key);
    if (invalidRois.length > 0) {
      throw new Error(`POLYGON_ROIS_REQUIRED:${invalidRois.join(',')}`);
    }
  }
  if (attempt.policySnapshot && !attempt.reactionStartedAt) {
    throw new Error('REACTION_NOT_STARTED');
  }
  if (
    attempt.policySnapshot &&
    !attempt.policySnapshot.showFinalMixturePh &&
    input.finalMixturePh !== null
  ) {
    throw new Error('FINAL_MIXTURE_PH_NOT_ALLOWED');
  }
  if (attempt.policySnapshot?.requireFinalMixturePh && input.finalMixturePh === null) {
    throw new Error('FINAL_MIXTURE_PH_REQUIRED');
  }

  const finalizedAt = new Date().toISOString();
  const finalized: CaptureAttempt = {
    ...attempt,
    status: 'finalized',
    finalMixturePh:
      attempt.task.taskType === 'blank_qc'
        ? null
        : attempt.policySnapshot
          ? attempt.policySnapshot.showFinalMixturePh
            ? input.finalMixturePh
            : null
          : input.finalMixturePh,
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

export function finalizeLocalCaptureAttempt(
  attemptId: string,
  input: FinalizeCaptureAttemptRequest,
): Promise<CaptureAttempt> {
  return withCaptureTransition(() => finalizeLocalCaptureAttemptUnlocked(attemptId, input));
}

export async function listFreshCaptureCases(): Promise<FreshCaptureCase[]> {
  return (await readFreshCaptureCases()).reverse();
}
