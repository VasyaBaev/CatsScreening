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
  type CreatePolicyCaptureAttemptRequest,
  type RoiShape,
} from '@cats-screening/shared';

import { extractCaptureCameraMetadata } from '../services/image-metadata.js';

type CaptureStore = typeof import('../services/local-capture-store.js');

let storageDirectory = '';
let store: CaptureStore;
let policy: CapturePolicy;

const roi: RoiShape = {
  shape: 'rect',
  source: 'manual',
  rect: { x: 0.2, y: 0.2, w: 0.6, h: 0.6 },
};

const selection: CreatePolicyCaptureAttemptRequest = {
  sourcePh: 5.8,
  referencePh: 6.13,
  deviceRole: 'phone',
  specimenMode: 'independent',
  sharedSpecimenId: null,
  operatorId: 'admin-test',
  lightLabel: 'daylight',
  angleLabel: 'straight',
  distanceLabel: 'normal',
};

function upload(slotKey: 'reference' | 'diagnostic'): CaptureAttemptUpload {
  const bytes = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2Q==', 'base64');
  return {
    slotKey,
    kind: slotKey,
    fileName: `${slotKey}.jpg`,
    contentType: 'image/jpeg',
    bytes: bytes.byteLength,
    sha256: (slotKey === 'reference' ? 'a' : 'b').repeat(64),
    uri: `local://capture-hotfix/uploads/admin/${slotKey}.jpg`,
    publicUrl: null,
    savedAt: new Date().toISOString(),
    roi: null,
    cameraMetadata: extractCaptureCameraMetadata(bytes),
  };
}

async function saveSlot(attempt: CaptureAttempt, slotKey: 'reference' | 'diagnostic') {
  await store.saveLocalAttemptUpload(attempt.id, upload(slotKey));
  return store.saveLocalAttemptSlotRoi(attempt.id, slotKey, roi);
}

async function makeFinalizable(attempt: CaptureAttempt) {
  await saveSlot(attempt, 'reference');
  await store.startLocalCaptureReaction(attempt.id, new Date(Date.now() - 1000));
  await saveSlot(attempt, 'diagnostic');
}

async function finalizeAttempt(attempt: CaptureAttempt, included: boolean) {
  await makeFinalizable(attempt);
  return store.finalizeLocalCaptureAttempt(attempt.id, {
    finalMixturePh: null,
    included,
    exclusionReason: included ? null : 'admin test exclusion',
  });
}

before(async () => {
  storageDirectory = await mkdtemp(path.join(os.tmpdir(), 'cats-admin-series-'));
  process.env.LOCAL_CAPTURE_STORAGE_DIR = storageDirectory;
  store = await import('../services/local-capture-store.js');
  policy = CapturePolicySchema.parse({
    policyId: 'capture-v10',
    version: 'admin-test-1',
    seriesId: 'V10',
    status: 'active',
    referencePh: 6.13,
    sourcePhValues: [5.8],
    deviceRoles: [{ value: 'phone', label: 'Phone' }],
    specimenModes: ['independent'],
    quotas: [{ sourcePh: 5.8, deviceRole: 'phone', specimenMode: 'independent', target: 20 }],
    conditions: {
      lights: [{ value: 'daylight', label: 'Daylight' }],
      angles: [{ value: 'straight', label: 'Straight' }],
      distances: [{ value: 'normal', label: 'Normal' }],
    },
    requirePolygonRoi: false,
    instruction: 'Admin test policy.',
    reactionTargetSeconds: null,
    reactionToleranceSeconds: null,
    showFinalMixturePh: false,
    requireFinalMixturePh: false,
  });

  await store.createPolicyCaptureAttempt(policy, selection);
  await finalizeAttempt(await store.createPolicyCaptureAttempt(policy, selection), true);
  await finalizeAttempt(await store.createPolicyCaptureAttempt(policy, selection), false);

  const abandoned = await store.createPolicyCaptureAttempt(policy, selection);
  await store.replaceLocalCaptureAttempt(policy, abandoned.id, {
    ...selection,
    specimenChoice: 'same',
  });

  const superseded = await finalizeAttempt(
    await store.createPolicyCaptureAttempt(policy, selection),
    true,
  );
  await store.replaceLocalCaptureAttempt(policy, superseded.id, {
    ...selection,
    specimenChoice: 'same',
  });
});

after(async () => {
  delete process.env.LOCAL_CAPTURE_STORAGE_DIR;
  await rm(storageDirectory, { recursive: true, force: true });
});

test('server summary считает всю серию и current valid quota', async () => {
  const attempts = await store.listLocalCaptureAttempts();
  const cases = await store.listFreshCaptureCases();
  const summary = store.summarizeCaptureAdmin(policy, attempts, cases);

  assert.equal(summary.counts.attempts, 7);
  assert.equal(summary.counts.cases, 3);
  assert.equal(summary.counts.finalizedIncluded, 1);
  assert.equal(summary.counts.active, 3);
  assert.equal(summary.counts.reserved, 3);
  assert.equal(summary.counts.abandoned, 1);
  assert.equal(summary.counts.superseded, 1);
  assert.equal(summary.counts.reshoots, 2);
  assert.equal(summary.counts.excluded, 1);
  assert.deepEqual(
    summary.quota.cells.map((cell) => ({
      sourcePh: cell.sourcePh,
      deviceRole: cell.deviceRole,
      specimenMode: cell.specimenMode,
      actual: cell.actual,
      target: cell.target,
      missing: cell.missing,
      reserved: cell.reserved,
    })),
    [
      {
        sourcePh: 5.8,
        deviceRole: 'phone',
        specimenMode: 'independent',
        actual: 1,
        target: 20,
        missing: 19,
        reserved: 3,
      },
    ],
  );
});

test('Admin pagination не ограничивает counters, exports сохраняют policy/history/uploads', async () => {
  const { buildServer } = await import('../server.js');
  const app = await buildServer({ logger: false });
  try {
    const page = await app.inject({ method: 'GET', url: '/api/admin/cases?limit=1&offset=0' });
    assert.equal(page.statusCode, 200);
    const body = page.json();
    assert.equal(body.items.length, 1);
    assert.equal(body.summary.counts.cases, 3);
    assert.equal(body.summary.counts.attempts, 7);
    assert.equal(body.summary.counts.active, 3);
    assert.equal(body.summary.policy.status, 'draft');
    assert.equal(body.attemptHistory.length, 7);

    const [casesJsonl, attemptsJsonl, csv] = await Promise.all([
      app.inject({ method: 'GET', url: '/api/admin/export.jsonl' }),
      app.inject({ method: 'GET', url: '/api/admin/export.attempts.jsonl' }),
      app.inject({ method: 'GET', url: '/api/admin/export.csv' }),
    ]);
    const exportedCases = casesJsonl.body
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const exportedAttempts = attemptsJsonl.body
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));

    assert.equal(exportedCases.length, 3);
    assert.ok(exportedCases.every((item) => item.policySnapshot.version === 'admin-test-1'));
    assert.ok(exportedCases.every((item) => item.images[0].cameraMetadata));
    assert.equal(
      exportedCases.find((item) => item.attemptStatus === 'superseded').replacedByAttemptId !==
        null,
      true,
    );
    assert.equal(exportedAttempts.length, 7);
    assert.ok(exportedAttempts.some((item) => item.status === 'abandoned'));
    assert.ok(exportedAttempts.some((item) => item.status === 'superseded'));
    assert.ok(exportedAttempts.filter((item) => item.replacesAttemptId).length === 2);
    assert.equal(csv.body.trim().split(/\r?\n/).length, 4);
    assert.match(csv.body.split(/\r?\n/, 1)[0], /policyVersion/);
    assert.match(csv.body, /cameraMetadata/);
  } finally {
    await app.close();
  }
});
