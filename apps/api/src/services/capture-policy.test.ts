import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  CapturePolicySchema,
  CaptureTaskSchema,
  type CapturePolicy,
  type CreatePolicyCaptureAttemptRequest,
} from '@cats-screening/shared';

type CaptureStore = typeof import('./local-capture-store.js');

let storageDirectory = '';
let store: CaptureStore;

before(async () => {
  storageDirectory = await mkdtemp(path.join(os.tmpdir(), 'cats-capture-policy-'));
  process.env.LOCAL_CAPTURE_STORAGE_DIR = storageDirectory;
  store = await import('./local-capture-store.js');
});

after(async () => {
  delete process.env.LOCAL_CAPTURE_STORAGE_DIR;
  await rm(storageDirectory, { recursive: true, force: true });
});

function activePolicy(
  policyId: string,
  modes: Array<'independent' | 'shared'> = ['independent', 'shared'],
): CapturePolicy {
  const quotas = [5.8, 6.4].flatMap((sourcePh) =>
    ['iphone', 'samsung'].flatMap((deviceRole) =>
      modes.map((specimenMode) => ({
        sourcePh,
        deviceRole,
        specimenMode,
        target: 3,
      })),
    ),
  );
  return CapturePolicySchema.parse({
    policyId,
    version: 'test-1',
    seriesId: `series-${policyId}`,
    status: 'active',
    referencePh: 6.13,
    sourcePhValues: [5.8, 6.4],
    deviceRoles: [
      { value: 'iphone', label: 'iPhone' },
      { value: 'samsung', label: 'Samsung' },
    ],
    specimenModes: modes,
    quotas,
    conditions: {
      lights: [{ value: 'daylight', label: 'Дневной свет' }],
      angles: [{ value: 'straight', label: 'Ровно сверху' }],
      distances: [{ value: 'normal', label: 'Обычная' }],
    },
    requirePolygonRoi: true,
    instruction: 'Тестовая активная политика.',
    reactionTargetSeconds: null,
    reactionToleranceSeconds: null,
    showFinalMixturePh: false,
    requireFinalMixturePh: false,
  });
}

function request(
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

test('policy schema проверяет active collections, ссылки quota, timing и final pH flags', () => {
  const policy = activePolicy('schema');
  assert.equal(CapturePolicySchema.safeParse({ ...policy, sourcePhValues: [] }).success, false);
  assert.equal(
    CapturePolicySchema.safeParse({ ...policy, reactionTargetSeconds: 20 }).success,
    false,
  );
  assert.equal(
    CapturePolicySchema.safeParse({
      ...policy,
      showFinalMixturePh: false,
      requireFinalMixturePh: true,
    }).success,
    false,
  );
  assert.equal(
    CapturePolicySchema.safeParse({
      ...policy,
      quotas: [{ ...policy.quotas[0], deviceRole: 'redmi' }],
    }).success,
    false,
  );
});

test('draft policy блокирует создание V10 attempt', async () => {
  const draft = CapturePolicySchema.parse({ ...activePolicy('draft'), status: 'draft' });
  await assert.rejects(store.createPolicyCaptureAttempt(draft, request()), /CAPTURE_POLICY_DRAFT/);
});

test('runtime context остаётся draft/closed и API возвращает понятный conflict', async () => {
  const { buildServer } = await import('../server.js');
  const app = await buildServer({ logger: false });
  try {
    const contextResponse = await app.inject({ method: 'GET', url: '/api/cases/context' });
    assert.equal(contextResponse.statusCode, 200);
    const context = contextResponse.json();
    assert.equal(context.policy.status, 'draft');
    assert.deepEqual(context.policy.sourcePhValues, []);
    assert.deepEqual(context.policy.quotas, []);
    assert.equal(context.policy.reactionTargetSeconds, null);
    assert.equal(context.policy.showFinalMixturePh, false);

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/cases/attempts',
      payload: request(),
    });
    assert.equal(createResponse.statusCode, 409);
    assert.deepEqual(createResponse.json(), {
      error: 'CAPTURE_POLICY_DRAFT',
      message: 'Политика V10 ожидает утверждения.',
    });
  } finally {
    await app.close();
  }
});

test('active policy принимает только объявленные pH, role и specimen mode', async () => {
  const policy = activePolicy('selection', ['independent']);
  await assert.rejects(
    store.createPolicyCaptureAttempt(policy, request({ sourcePh: 6.2 })),
    /SOURCE_PH_NOT_ALLOWED/,
  );
  await assert.rejects(
    store.createPolicyCaptureAttempt(policy, request({ referencePh: 6 })),
    /REFERENCE_PH_NOT_ALLOWED/,
  );
  await assert.rejects(
    store.createPolicyCaptureAttempt(policy, request({ deviceRole: 'redmi' })),
    /DEVICE_ROLE_NOT_ALLOWED/,
  );
  await assert.rejects(
    store.createPolicyCaptureAttempt(policy, request({ specimenMode: 'shared' })),
    /SPECIMEN_MODE_NOT_ALLOWED/,
  );
});

test('server создаёт opaque IDs, policy snapshot и independent specimen', async () => {
  const policy = activePolicy('opaque');
  const attempt = await store.createPolicyCaptureAttempt(policy, request());

  assert.match(attempt.id, /^[0-9a-f-]{36}$/);
  assert.match(attempt.pairId ?? '', /^[0-9a-f-]{36}$/);
  assert.match(attempt.task.specimenId, /^[0-9a-f-]{36}$/);
  assert.equal(attempt.task.code, attempt.pairId);
  assert.notEqual(attempt.task.code, 'PH580');
  assert.equal(attempt.series, policy.seriesId);
  assert.deepEqual(attempt.policySnapshot, policy);
  assert.match(attempt.displayLabel ?? '', /^Образец #[0-9a-f]{8}$/);
});

test('shared specimen доступен второй роли без ручного ID', async () => {
  const policy = activePolicy('shared');
  const first = await store.createPolicyCaptureAttempt(policy, request({ specimenMode: 'shared' }));
  const context = await store.getLocalCaptureContext(policy, {
    sourcePh: 5.8,
    deviceRole: 'samsung',
    specimenMode: 'shared',
  });
  assert.equal(context.availableSharedSpecimens.length, 1);
  assert.equal(context.availableSharedSpecimens[0]?.specimenId, first.task.specimenId);

  const second = await store.createPolicyCaptureAttempt(
    policy,
    request({
      deviceRole: 'samsung',
      specimenMode: 'shared',
      sharedSpecimenId: first.task.specimenId,
    }),
  );
  assert.equal(second.task.specimenId, first.task.specimenId);
  assert.notEqual(second.id, first.id);

  const sameRole = await store.getLocalCaptureContext(policy, {
    sourcePh: 5.8,
    deviceRole: 'iphone',
    specimenMode: 'shared',
  });
  assert.equal(sameRole.availableSharedSpecimens.length, 0);
});

test('quota context считает temporary filesystem attempts и игнорирует legacy', async () => {
  const policy = activePolicy('quota');
  await store.createPolicyCaptureAttempt(policy, request());
  await store.createLocalCaptureAttempt(
    CaptureTaskSchema.parse({
      code: 'PH580-LEGACY',
      taskType: 'reacted_specimen',
      specimenId: 'legacy-specimen',
      sourcePh: 5.8,
      slots: [
        {
          key: 'reference',
          kind: 'reference',
          label: 'Reference',
          required: true,
          targetSeconds: null,
          toleranceSeconds: null,
        },
      ],
    }),
    {
      taskCode: 'PH580-LEGACY',
      operatorId: 'legacy',
      device: 'legacy',
      series: policy.seriesId,
      lightLabel: 'daylight',
      angleLabel: 'straight',
      distanceLabel: 'normal',
    },
  );

  const context = await store.getLocalCaptureContext(policy);
  const cell = context.quotaSummary.cells.find(
    (item) =>
      item.sourcePh === 5.8 && item.deviceRole === 'iphone' && item.specimenMode === 'independent',
  );
  assert.deepEqual(cell, {
    sourcePh: 5.8,
    deviceRole: 'iphone',
    specimenMode: 'independent',
    target: 3,
    actual: 0,
    reserved: 1,
    available: 2,
  });
  assert.equal(context.quotaSummary.reserved, 1);
});
