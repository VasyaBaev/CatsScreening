import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  CapturePolicySchema,
  type CaptureAttempt,
  type CaptureAttemptUpload,
  type CapturePolicy,
  type CreateCaptureReplacementRequest,
  type CreatePolicyCaptureAttemptRequest,
  type RoiShape,
} from '@cats-screening/shared';

type CaptureStore = typeof import('./local-capture-store.js');

let storageDirectory = '';
let store: CaptureStore;

before(async () => {
  storageDirectory = await mkdtemp(path.join(os.tmpdir(), 'cats-capture-lifecycle-'));
  process.env.LOCAL_CAPTURE_STORAGE_DIR = storageDirectory;
  store = await import('./local-capture-store.js');
});

after(async () => {
  delete process.env.LOCAL_CAPTURE_STORAGE_DIR;
  await rm(storageDirectory, { recursive: true, force: true });
});

function policy(
  policyId: string,
  options: {
    roles?: string[];
    modes?: Array<'independent' | 'shared'>;
    target?: number;
  } = {},
): CapturePolicy {
  const roles = options.roles ?? ['iphone'];
  const modes = options.modes ?? ['independent'];
  return CapturePolicySchema.parse({
    policyId,
    version: 'test-1',
    seriesId: `series-${policyId}`,
    status: 'active',
    referencePh: 6.13,
    sourcePhValues: [5.8],
    deviceRoles: roles.map((role) => ({ value: role, label: role })),
    specimenModes: modes,
    quotas: roles.flatMap((deviceRole) =>
      modes.map((specimenMode) => ({
        sourcePh: 5.8,
        deviceRole,
        specimenMode,
        target: options.target ?? 2,
      })),
    ),
    conditions: {
      lights: [{ value: 'daylight', label: 'Дневной свет' }],
      angles: [{ value: 'straight', label: 'Ровно сверху' }],
      distances: [{ value: 'normal', label: 'Обычная' }],
    },
    requirePolygonRoi: true,
    instruction: 'Тестовая политика lifecycle.',
    reactionTargetSeconds: null,
    reactionToleranceSeconds: null,
    showFinalMixturePh: false,
    requireFinalMixturePh: false,
  });
}

function selection(
  change: Partial<CreatePolicyCaptureAttemptRequest> = {},
): CreatePolicyCaptureAttemptRequest {
  return {
    sourcePh: 5.8,
    referencePh: 6.13,
    deviceRole: 'iphone',
    specimenMode: 'independent',
    sharedSpecimenId: null,
    operatorId: 'operator-test',
    lightLabel: 'daylight',
    angleLabel: 'straight',
    distanceLabel: 'normal',
    ...change,
  };
}

function replacement(
  change: Partial<CreateCaptureReplacementRequest> = {},
): CreateCaptureReplacementRequest {
  return { ...selection(change), specimenChoice: change.specimenChoice ?? 'same' };
}

const polygonRoi: RoiShape = {
  shape: 'polygon',
  source: 'manual',
  points: [
    { x: 0.15, y: 0.2 },
    { x: 0.85, y: 0.2 },
    { x: 0.8, y: 0.8 },
    { x: 0.2, y: 0.8 },
  ],
};

function upload(slotKey: 'reference' | 'diagnostic', savedAt: string): CaptureAttemptUpload {
  return {
    slotKey,
    kind: slotKey,
    fileName: `${slotKey}.jpg`,
    contentType: 'image/jpeg',
    bytes: 4,
    sha256: (slotKey === 'reference' ? 'a' : 'b').repeat(64),
    uri: `local://${slotKey}.jpg`,
    publicUrl: null,
    savedAt,
    roi: null,
  };
}

async function saveReference(attempt: CaptureAttempt, roi: RoiShape = polygonRoi) {
  await store.saveLocalAttemptUpload(attempt.id, upload('reference', '2026-08-25T10:00:00.000Z'));
  return store.saveLocalAttemptSlotRoi(attempt.id, 'reference', roi);
}

async function makeFinalizable(attempt: CaptureAttempt): Promise<CaptureAttempt> {
  await saveReference(attempt);
  await store.startLocalCaptureReaction(attempt.id, new Date('2026-08-25T10:00:05.000Z'));
  await store.saveLocalAttemptUpload(attempt.id, upload('diagnostic', '2026-08-25T10:00:12.250Z'));
  return store.saveLocalAttemptSlotRoi(attempt.id, 'diagnostic', polygonRoi);
}

test('reaction start требует только reference upload и идемпотентен', async () => {
  const currentPolicy = policy('reaction');
  const attempt = await store.createPolicyCaptureAttempt(currentPolicy, selection());
  assert.equal(attempt.reactionStartedAt, null);
  await assert.rejects(store.startLocalCaptureReaction(attempt.id), /REFERENCE_UPLOAD_REQUIRED/);

  await store.saveLocalAttemptUpload(attempt.id, upload('reference', '2026-08-25T10:00:00.000Z'));

  const first = await store.startLocalCaptureReaction(
    attempt.id,
    new Date('2026-08-25T10:00:05.000Z'),
  );
  const duplicate = await store.startLocalCaptureReaction(
    attempt.id,
    new Date('2026-08-25T11:00:00.000Z'),
  );
  assert.equal(first.reactionStartedAt, '2026-08-25T10:00:05.000Z');
  assert.equal(duplicate.reactionStartedAt, first.reactionStartedAt);
});

test('diagnostic upload до reaction start получает HTTP conflict', async () => {
  const currentPolicy = policy('diagnostic-gate');
  const attempt = await store.createPolicyCaptureAttempt(currentPolicy, selection());
  const { buildServer } = await import('../server.js');
  const app = await buildServer({ logger: false });
  try {
    const response = await app.inject({
      method: 'PUT',
      url: `/api/uploads/attempts/${attempt.id}/slots/diagnostic`,
      headers: {
        'content-type': 'image/jpeg',
        'x-file-name': 'diagnostic.jpg',
      },
      payload: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    });
    assert.equal(response.statusCode, 409);
    assert.deepEqual(response.json(), { error: 'REACTION_NOT_STARTED' });
    assert.equal((await store.getLocalCaptureAttempt(attempt.id)).uploads.diagnostic, undefined);
  } finally {
    await app.close();
  }
});

test('diagnostic savedAt и elapsed вычисляются по server-side upload timestamp', async () => {
  const currentPolicy = policy('elapsed');
  const attempt = await store.createPolicyCaptureAttempt(currentPolicy, selection());
  await saveReference(attempt);
  const started = await store.startLocalCaptureReaction(attempt.id, new Date(Date.now() - 5000));
  const { saveLocalAttemptImage } = await import('./local-image-storage.js');
  const storedUpload = await saveLocalAttemptImage({
    attemptId: attempt.id,
    slotKey: 'diagnostic',
    kind: 'diagnostic',
    fileName: 'diagnostic.jpg',
    contentType: 'image/jpeg',
    buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
  });
  const updated = await store.saveLocalAttemptUpload(attempt.id, storedUpload);

  assert.equal(updated.diagnosticSavedAt, storedUpload.savedAt);
  assert.equal(
    updated.reactionElapsedSec,
    (new Date(storedUpload.savedAt).getTime() - new Date(started.reactionStartedAt!).getTime()) /
      1000,
  );
  assert.ok((updated.reactionElapsedSec ?? 0) >= 4.5);
});

test('обе ROI можно разметить после diagnostic и затем завершить пару', async () => {
  const currentPolicy = policy('post-diagnostic-roi');
  const attempt = await store.createPolicyCaptureAttempt(currentPolicy, selection());
  await store.saveLocalAttemptUpload(attempt.id, upload('reference', '2026-08-25T10:00:00.000Z'));
  await store.startLocalCaptureReaction(attempt.id, new Date('2026-08-25T10:00:05.000Z'));
  await store.saveLocalAttemptUpload(attempt.id, upload('diagnostic', '2026-08-25T10:00:12.250Z'));
  await store.saveLocalAttemptSlotRoi(attempt.id, 'reference', polygonRoi);
  await store.saveLocalAttemptSlotRoi(attempt.id, 'diagnostic', polygonRoi);

  const finalized = await store.finalizeLocalCaptureAttempt(attempt.id, {
    finalMixturePh: null,
    included: true,
    exclusionReason: null,
  });
  assert.equal(finalized.status, 'finalized');
  assert.ok(finalized.uploads.reference?.roi);
  assert.ok(finalized.uploads.diagnostic?.roi);
});

test('reference ROI разблокируется после diagnostic, а отдельная замена фото запрещена', async () => {
  const currentPolicy = policy('reference-lock');
  const attempt = await store.createPolicyCaptureAttempt(currentPolicy, selection());
  await saveReference(attempt);
  await store.startLocalCaptureReaction(attempt.id);

  await assert.rejects(
    store.saveLocalAttemptUpload(attempt.id, upload('reference', '2026-08-25T10:00:30.000Z')),
    /REFERENCE_LOCKED_AFTER_REACTION/,
  );
  await assert.rejects(
    store.saveLocalAttemptSlotRoi(attempt.id, 'reference', {
      ...polygonRoi,
      points: polygonRoi.shape === 'polygon' ? polygonRoi.points.slice().reverse() : [],
    }),
    /REFERENCE_ROI_LOCKED_UNTIL_DIAGNOSTIC/,
  );

  await store.saveLocalAttemptUpload(attempt.id, upload('diagnostic', '2026-08-25T10:00:30.000Z'));
  const updatedReference = await store.saveLocalAttemptSlotRoi(attempt.id, 'reference', {
    ...polygonRoi,
    points: polygonRoi.shape === 'polygon' ? polygonRoi.points.slice().reverse() : [],
  });
  assert.ok(updatedReference.uploads.reference?.roi);
  await assert.rejects(
    store.saveLocalAttemptUpload(attempt.id, upload('diagnostic', '2026-08-25T10:00:40.000Z')),
    /DIAGNOSTIC_LOCKED_AFTER_UPLOAD/,
  );

  const { buildServer } = await import('../server.js');
  const app = await buildServer({ logger: false });
  try {
    const response = await app.inject({
      method: 'PUT',
      url: `/api/uploads/attempts/${attempt.id}/slots/reference`,
      headers: { 'content-type': 'image/jpeg', 'x-file-name': 'late-reference.jpg' },
      payload: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    });
    assert.equal(response.statusCode, 409);
    assert.deepEqual(response.json(), { error: 'REFERENCE_LOCKED_AFTER_REACTION' });

    const diagnosticResponse = await app.inject({
      method: 'PUT',
      url: `/api/uploads/attempts/${attempt.id}/slots/diagnostic`,
      headers: { 'content-type': 'image/jpeg', 'x-file-name': 'late-diagnostic.jpg' },
      payload: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    });
    assert.equal(diagnosticResponse.statusCode, 409);
    assert.deepEqual(diagnosticResponse.json(), { error: 'DIAGNOSTIC_LOCKED_AFTER_UPLOAD' });
  } finally {
    await app.close();
  }
});

test('active restart сохраняет history, освобождает reservation и связывает same specimen', async () => {
  const currentPolicy = policy('restart', { target: 1 });
  const attempt = await store.createPolicyCaptureAttempt(currentPolicy, selection());
  const result = await store.replaceLocalCaptureAttempt(
    currentPolicy,
    attempt.id,
    replacement({ specimenChoice: 'same' }),
  );

  assert.equal(result.previousAttempt.status, 'abandoned');
  assert.equal(result.previousAttempt.replacedByAttemptId, result.replacementAttempt.id);
  assert.equal(result.replacementAttempt.replacesAttemptId, attempt.id);
  assert.equal(result.replacementAttempt.task.specimenId, attempt.task.specimenId);
  assert.equal(result.replacementAttempt.reactionStartedAt, null);
  const summary = (await store.getLocalCaptureContext(currentPolicy)).quotaSummary;
  assert.equal(summary.actual, 0);
  assert.equal(summary.reserved, 1);
  assert.equal(
    (await store.listLocalCaptureAttempts()).filter(
      (item) => item.policySnapshot?.policyId === currentPolicy.policyId,
    ).length,
    2,
  );
});

test('finalized reshoot supersedes old quota result и создаёт new specimen', async () => {
  const currentPolicy = policy('reshoot', { target: 1 });
  const attempt = await store.createPolicyCaptureAttempt(currentPolicy, selection());
  await makeFinalizable(attempt);
  const finalized = await store.finalizeLocalCaptureAttempt(attempt.id, {
    finalMixturePh: null,
    included: true,
    exclusionReason: null,
  });
  assert.equal((await store.getLocalCaptureContext(currentPolicy)).quotaSummary.actual, 1);

  const result = await store.replaceLocalCaptureAttempt(
    currentPolicy,
    finalized.id,
    replacement({ specimenChoice: 'new' }),
  );
  assert.equal(result.previousAttempt.status, 'superseded');
  assert.notEqual(result.replacementAttempt.task.specimenId, finalized.task.specimenId);
  assert.equal(result.replacementAttempt.replacesAttemptId, finalized.id);
  const summary = (await store.getLocalCaptureContext(currentPolicy)).quotaSummary;
  assert.equal(summary.actual, 0);
  assert.equal(summary.reserved, 1);
});

test('excluded finalize идемпотентен и не закрывает quota', async () => {
  const currentPolicy = policy('excluded', { target: 1 });
  const attempt = await store.createPolicyCaptureAttempt(currentPolicy, selection());
  await makeFinalizable(attempt);
  const first = await store.finalizeLocalCaptureAttempt(attempt.id, {
    finalMixturePh: null,
    included: false,
    exclusionReason: 'Тестовое исключение',
  });
  const duplicate = await store.finalizeLocalCaptureAttempt(attempt.id, {
    finalMixturePh: null,
    included: false,
    exclusionReason: 'Повтор не должен менять результат',
  });

  assert.equal(duplicate.result?.caseId, first.result?.caseId);
  const summary = (await store.getLocalCaptureContext(currentPolicy)).quotaSummary;
  assert.equal(summary.actual, 0);
  assert.equal(summary.reserved, 0);
  assert.equal(summary.available, 1);
  assert.equal(
    (await store.listFreshCaptureCases()).filter((item) => item.attemptId === attempt.id).length,
    1,
  );
});

test('parallel requests reserve последнюю quota cell только один раз', async () => {
  const currentPolicy = policy('quota-race', { target: 1 });
  const results = await Promise.allSettled([
    store.createPolicyCaptureAttempt(currentPolicy, selection()),
    store.createPolicyCaptureAttempt(currentPolicy, selection()),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
  const rejected = results.find((result) => result.status === 'rejected');
  assert.match(String(rejected?.reason), /CAPTURE_QUOTA_FULL/);
  assert.equal((await store.getLocalCaptureContext(currentPolicy)).quotaSummary.reserved, 1);
});

test('parallel same specimen/device requests возвращают одну active attempt', async () => {
  const currentPolicy = policy('specimen-race', {
    roles: ['iphone', 'samsung'],
    modes: ['shared'],
    target: 1,
  });
  const first = await store.createPolicyCaptureAttempt(
    currentPolicy,
    selection({ specimenMode: 'shared' }),
  );
  const samsungSelection = selection({
    deviceRole: 'samsung',
    specimenMode: 'shared',
    sharedSpecimenId: first.task.specimenId,
  });
  const [left, right] = await Promise.all([
    store.createPolicyCaptureAttempt(currentPolicy, samsungSelection),
    store.createPolicyCaptureAttempt(currentPolicy, samsungSelection),
  ]);
  assert.equal(left.id, right.id);
  const samsungAttempts = (await store.listLocalCaptureAttempts()).filter(
    (attempt) =>
      attempt.policySnapshot?.policyId === currentPolicy.policyId &&
      attempt.task.specimenId === first.task.specimenId &&
      attempt.deviceRole === 'samsung' &&
      attempt.status === 'active',
  );
  assert.equal(samsungAttempts.length, 1);
});
