/**
 * Мобильный policy-driven Capture V10.
 * Оригиналы отправляются без перекодирования, фактическое состояние хранит сервер.
 */

import {
  type CaptureAttempt,
  type CaptureContext,
  type CapturePolicy,
  type CaptureSpecimenMode,
  type CaptureTaskSlot,
  type CreatePolicyCaptureAttemptRequest,
  type RoiShape,
} from '@cats-screening/shared';
import { useEffect, useMemo, useRef, useState } from 'react';

import { RoiEditor } from '../components/RoiEditor';
import {
  createCaptureAttempt,
  fetchCaptureAttempt,
  fetchCaptureAttemptByClientRequestId,
  fetchCaptureContext,
  finalizeCaptureAttempt,
  replaceCaptureAttempt,
  startCaptureReaction,
  updateCaptureSlotRoi,
  uploadCaptureSlot,
} from '../lib/api';
import { FIXED_WIDE_ROI, polygonFromRect, polygonToRoiShape, rectToRoiShape } from '../lib/roi';

const OPERATOR_KEY = 'cats.capture.operatorId';
const DEVICE_ROLE_KEY = 'cats.capture.deviceRole';
const ATTEMPT_KEY = 'cats.capture.attemptId';
const CREATE_REQUEST_KEY = 'cats.capture.createRequestId';
const NEW_SHARED_SPECIMEN = '__new_shared_specimen__';

type CaptureForm = {
  operatorId: string;
  deviceRole: string;
  specimenMode: '' | CaptureSpecimenMode;
  sourcePh: string;
  referencePh: string;
  sharedSpecimenId: string;
  lightLabel: string;
  angleLabel: string;
  distanceLabel: string;
};

type SlotDraft = {
  file: File | null;
  previewUrl: string | null;
  localPreview: boolean;
  roi: RoiShape;
  status: 'empty' | 'uploading' | 'saved' | 'error';
  progress: number | null;
  error: string | null;
  roiDirty: boolean;
};

type OperationState = {
  kind: 'create' | 'upload' | 'roi' | 'reaction' | 'finalize' | 'replacement';
  title: string;
  stage: string;
  status: 'running' | 'success' | 'error';
  progress: number | null;
  cancellable: boolean;
  message: string | null;
};

type OperationControls = {
  signal: AbortSignal;
  setStage: (stage: string) => void;
  setProgress: (progress: number | null) => void;
};

function readLocal(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function writeLocal(key: string, value: string) {
  try {
    if (value.trim()) window.localStorage.setItem(key, value.trim());
    else window.localStorage.removeItem(key);
  } catch {
    // localStorage опционален: серверное восстановление остаётся основным источником состояния.
  }
}

function initialForm(): CaptureForm {
  return {
    operatorId: readLocal(OPERATOR_KEY),
    deviceRole: readLocal(DEVICE_ROLE_KEY),
    specimenMode: '',
    sourcePh: '',
    referencePh: '',
    sharedSpecimenId: '',
    lightLabel: '',
    angleLabel: '',
    distanceLabel: '',
  };
}

function freshRoi(requirePolygon: boolean): RoiShape {
  return requirePolygon
    ? polygonToRoiShape(polygonFromRect(FIXED_WIDE_ROI))
    : rectToRoiShape(FIXED_WIDE_ROI);
}

function draftsForAttempt(attempt: CaptureAttempt): Record<string, SlotDraft> {
  const requirePolygon = attempt.policySnapshot?.requirePolygonRoi ?? false;
  return Object.fromEntries(
    attempt.task.slots.map((slot) => {
      const upload = attempt.uploads[slot.key];
      return [
        slot.key,
        {
          file: null,
          previewUrl: upload?.publicUrl ?? null,
          localPreview: false,
          roi: upload?.roi ?? freshRoi(requirePolygon),
          status: upload ? 'saved' : 'empty',
          progress: null,
          error: null,
          roiDirty: Boolean(upload && !upload.roi),
        },
      ];
    }),
  );
}

function duration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  return String(Math.floor(safe / 60)).padStart(2, '0') + ':' + String(safe % 60).padStart(2, '0');
}

function timing(slot: CaptureTaskSlot, elapsed: number): string {
  if (slot.targetSeconds === null || slot.toleranceSeconds === null) {
    return 'Прошло ' + duration(elapsed);
  }
  const remaining = slot.targetSeconds - elapsed;
  if (remaining > 0) return 'До целевого времени ' + duration(remaining);
  const over = Math.abs(remaining);
  return over <= slot.toleranceSeconds
    ? 'Целевое окно: +' + duration(over)
    : 'После целевого окна: +' + duration(over);
}

function slotStatus(draft: SlotDraft): string {
  if (draft.status === 'uploading') {
    return draft.progress === null ? 'Сервер сохраняет…' : 'Передано ' + draft.progress + '%';
  }
  if (draft.status === 'saved' && draft.roiDirty) return 'ROI нужно сохранить';
  if (draft.status === 'saved') return 'Сохранено';
  if (draft.status === 'error') return 'Нужен повтор';
  if (draft.file) return 'Готово к загрузке';
  return 'Фото не выбрано';
}

function phText(value: number): string {
  return String(value).replace('.', ',');
}

function specimenModeText(mode: CaptureSpecimenMode | undefined): string {
  return mode === 'shared' ? 'Общий образец' : 'Независимый образец';
}

function attemptStatusText(attempt: CaptureAttempt): string {
  if (attempt.status === 'finalized') return 'Пара сохранена';
  if (attempt.status === 'abandoned') return 'Попытка оставлена';
  if (attempt.status === 'superseded') return 'Заменена пересъёмкой';
  if (!attempt.reactionStartedAt) return 'Сначала сохраните reference';
  return 'Реакция начата — снимите diagnostic';
}

async function followReplacementChain(initial: CaptureAttempt): Promise<CaptureAttempt> {
  let current = initial;
  const visited = new Set([current.id]);
  while (current.replacedByAttemptId) {
    if (visited.has(current.replacedByAttemptId)) throw new Error('REPLACEMENT_CHAIN_CYCLE');
    visited.add(current.replacedByAttemptId);
    current = await fetchCaptureAttempt(current.replacedByAttemptId);
  }
  return current;
}

function contextQuery(form: CaptureForm) {
  return {
    deviceRole: form.deviceRole || undefined,
    specimenMode: form.specimenMode || undefined,
    sourcePh: form.sourcePh ? Number(form.sourcePh) : undefined,
  };
}

export function CapturePage() {
  const [form, setForm] = useState<CaptureForm>(initialForm);
  const [context, setContext] = useState<CaptureContext | null>(null);
  const [attempt, setAttempt] = useState<CaptureAttempt | null>(null);
  const [drafts, setDrafts] = useState<Record<string, SlotDraft>>({});
  const [contextLoading, setContextLoading] = useState(true);
  const [restoring, setRestoring] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [finalPh, setFinalPh] = useState('');
  const [included, setIncluded] = useState(true);
  const [exclusionReason, setExclusionReason] = useState('');
  const [replacementMode, setReplacementMode] = useState(false);
  const [specimenChoice, setSpecimenChoice] = useState<'same' | 'new'>('same');
  const [operation, setOperation] = useState<OperationState | null>(null);
  const [clock, setClock] = useState(Date.now());
  const localUrls = useRef(new Set<string>());
  const operationAbort = useRef<AbortController | null>(null);

  const policy = attempt?.policySnapshot ?? context?.policy ?? null;
  const terminal = Boolean(attempt && attempt.status !== 'active');
  const finalized = attempt?.status === 'finalized';
  const elapsed = useMemo(() => {
    if (!attempt?.reactionStartedAt) return 0;
    const started = new Date(attempt.reactionStartedAt).getTime();
    return Number.isFinite(started) ? Math.max(0, Math.floor((clock - started) / 1000)) : 0;
  }, [attempt, clock]);

  const referenceSlot = attempt?.task.slots.find((slot) => slot.kind === 'reference');
  const referenceUpload = referenceSlot ? attempt?.uploads[referenceSlot.key] : undefined;
  const referenceDraft = referenceSlot ? drafts[referenceSlot.key] : undefined;
  const referenceCaptured = Boolean(referenceUpload && !referenceDraft?.file);
  const diagnosticSaved = Boolean(
    attempt?.task.slots.some(
      (slot) => slot.kind === 'diagnostic' && Boolean(attempt.uploads[slot.key]),
    ),
  );
  const ready = Boolean(
    attempt?.status === 'active' &&
    attempt.task.slots
      .filter((slot) => slot.required)
      .every((slot) => {
        const upload = attempt.uploads[slot.key];
        const draft = drafts[slot.key];
        return Boolean(
          upload?.roi &&
          (!policy?.requirePolygonRoi || upload.roi.shape === 'polygon') &&
          draft?.status === 'saved' &&
          !draft.roiDirty,
        );
      }),
  );

  useEffect(() => writeLocal(OPERATOR_KEY, form.operatorId), [form.operatorId]);
  useEffect(() => writeLocal(DEVICE_ROLE_KEY, form.deviceRole), [form.deviceRole]);

  useEffect(() => {
    const controller = new AbortController();
    if (!context) setContextLoading(true);
    fetchCaptureContext(contextQuery(form), controller.signal)
      .then((next) => {
        setContext(next);
        setForm((current) => {
          const role = next.policy.deviceRoles.some((item) => item.value === current.deviceRole)
            ? current.deviceRole
            : '';
          const mode = next.policy.specimenModes.includes(
            current.specimenMode as CaptureSpecimenMode,
          )
            ? current.specimenMode
            : '';
          const optionValue = (
            currentValue: string,
            options: CapturePolicy['conditions']['lights'],
          ) =>
            options.some((option) => option.value === currentValue)
              ? currentValue
              : (options[0]?.value ?? '');
          return {
            ...current,
            deviceRole: role,
            specimenMode: mode,
            lightLabel: optionValue(current.lightLabel, next.policy.conditions.lights),
            angleLabel: optionValue(current.angleLabel, next.policy.conditions.angles),
            distanceLabel: optionValue(current.distanceLabel, next.policy.conditions.distances),
          };
        });
      })
      .catch((reason) => {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setContextLoading(false);
      });
    return () => controller.abort();
  }, [form.deviceRole, form.specimenMode, form.sourcePh]);

  useEffect(() => {
    let cancelled = false;
    const id = readLocal(ATTEMPT_KEY);
    const clientRequestId = readLocal(CREATE_REQUEST_KEY);
    if (!id && !clientRequestId) {
      setRestoring(false);
      return;
    }

    const restore = id
      ? fetchCaptureAttempt(id)
      : fetchCaptureAttemptByClientRequestId(clientRequestId);
    restore
      .then(async (restored) => {
        const current = await followReplacementChain(restored);
        if (!current.policySnapshot) {
          writeLocal(ATTEMPT_KEY, '');
          throw new Error('Старая попытка не относится к Capture V10 и не восстанавливается.');
        }
        if (!cancelled) applyAttempt(current);
      })
      .catch((reason) => {
        if (cancelled) return;
        setError(
          'Не удалось восстановить попытку: ' +
            (reason instanceof Error ? reason.message : String(reason)),
        );
      })
      .finally(() => {
        if (!cancelled) setRestoring(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!attempt?.reactionStartedAt || attempt.status !== 'active') return;
    setClock(Date.now());
    const interval = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [attempt?.id, attempt?.reactionStartedAt, attempt?.status]);

  useEffect(
    () => () => {
      for (const url of localUrls.current) URL.revokeObjectURL(url);
      operationAbort.current?.abort();
    },
    [],
  );

  function clearLocalPreviews(keep: ReadonlySet<string> = new Set()) {
    for (const url of localUrls.current) {
      if (keep.has(url)) continue;
      URL.revokeObjectURL(url);
      localUrls.current.delete(url);
    }
  }

  function applyAttempt(next: CaptureAttempt, draftOverrides: Record<string, SlotDraft> = {}) {
    const retainedPreviewUrls = new Set(
      Object.values(draftOverrides)
        .filter((draft) => draft.localPreview && draft.previewUrl)
        .map((draft) => draft.previewUrl as string),
    );
    clearLocalPreviews(retainedPreviewUrls);
    setAttempt(next);
    setDrafts({ ...draftsForAttempt(next), ...draftOverrides });
    setForm((current) => ({
      ...current,
      operatorId: next.operatorId,
      deviceRole: next.deviceRole ?? '',
      specimenMode: next.specimenMode ?? '',
      sourcePh: String(next.task.sourcePh),
      referencePh: next.referencePh === undefined ? '' : String(next.referencePh),
      sharedSpecimenId: next.specimenMode === 'shared' ? next.task.specimenId : '',
      lightLabel: next.condition.lightLabel,
      angleLabel: next.condition.angleLabel,
      distanceLabel: next.condition.distanceLabel,
    }));
    setFinalPh(next.finalMixturePh?.toString() ?? '');
    setIncluded(next.result?.included ?? true);
    setExclusionReason(next.result?.exclusionReason ?? '');
    setReplacementMode(false);
    setSpecimenChoice('same');
    writeLocal(ATTEMPT_KEY, next.id);
    writeLocal(CREATE_REQUEST_KEY, '');
    setClock(Date.now());
  }

  function updateForm<K extends keyof CaptureForm>(key: K, value: CaptureForm[K]) {
    setForm((current) => ({
      ...current,
      [key]: value,
      ...(key === 'sourcePh' || key === 'specimenMode' ? { sharedSpecimenId: '' } : {}),
    }));
  }

  function updateDraft(slotKey: string, change: Partial<SlotDraft>) {
    setDrafts((current) => {
      const draft = current[slotKey];
      return draft ? { ...current, [slotKey]: { ...draft, ...change } } : current;
    });
  }

  async function refreshContext(signal?: AbortSignal) {
    const next = await fetchCaptureContext(contextQuery(form), signal);
    setContext(next);
    return next;
  }

  async function reconcileAttempt(
    attemptId: string,
    retryDraft?: { slotKey: string; draft: SlotDraft },
  ) {
    const restored = await followReplacementChain(await fetchCaptureAttempt(attemptId));
    const draftOverrides: Record<string, SlotDraft> = {};
    if (retryDraft && restored.id === attemptId) {
      const serverUpload = restored.uploads[retryDraft.slotKey];
      const roiConfirmed =
        serverUpload?.roi &&
        JSON.stringify(serverUpload.roi) === JSON.stringify(retryDraft.draft.roi);
      if (!serverUpload && retryDraft.draft.file) {
        draftOverrides[retryDraft.slotKey] = {
          ...retryDraft.draft,
          status: 'error',
          progress: null,
          error: 'Оригинал не подтверждён сервером. Можно повторить загрузку.',
        };
      } else if (serverUpload && !roiConfirmed) {
        const serverDraft = draftsForAttempt(restored)[retryDraft.slotKey];
        if (serverDraft) {
          draftOverrides[retryDraft.slotKey] = {
            ...serverDraft,
            roi: retryDraft.draft.roi,
            status: 'saved',
            roiDirty: true,
            error: 'Оригинал сохранён, но ROI не подтверждена. Повторите сохранение ROI.',
          };
        }
      }
    }
    applyAttempt(restored, draftOverrides);
    const nextContext = await fetchCaptureContext({
      deviceRole: restored.deviceRole,
      specimenMode: restored.specimenMode,
      sourcePh: restored.task.sourcePh,
    });
    setContext(nextContext);
  }

  async function runOperation(
    config: {
      kind: OperationState['kind'];
      title: string;
      stage: string;
      successMessage: string;
      cancellable?: boolean;
      reconcileAttemptId?: string;
      reconcileClientRequestId?: string;
      retryDraft?: { slotKey: string; draft: SlotDraft };
    },
    action: (controls: OperationControls) => Promise<void>,
  ) {
    const controller = new AbortController();
    operationAbort.current = controller;
    const updateOperation = (change: Partial<OperationState>) =>
      setOperation((current) => (current ? { ...current, ...change } : current));
    setOperation({
      kind: config.kind,
      title: config.title,
      stage: config.stage,
      status: 'running',
      progress: null,
      cancellable: config.cancellable ?? true,
      message: null,
    });
    setError(null);

    try {
      await action({
        signal: controller.signal,
        setStage: (stage) => updateOperation({ stage, progress: null }),
        setProgress: (progress) => updateOperation({ progress }),
      });
      updateOperation({
        status: 'success',
        stage: 'Готово',
        progress: null,
        cancellable: false,
        message: config.successMessage,
      });
    } catch (reason) {
      const cancelled = controller.signal.aborted;
      updateOperation({ stage: 'Сверяем фактическое состояние с сервером…', progress: null });
      let reconciliation = 'Состояние сервера не удалось перечитать.';
      let reconciled = false;
      try {
        if (config.reconcileAttemptId) {
          await reconcileAttempt(config.reconcileAttemptId, config.retryDraft);
        } else if (config.reconcileClientRequestId) {
          applyAttempt(
            await followReplacementChain(
              await fetchCaptureAttemptByClientRequestId(config.reconcileClientRequestId),
            ),
          );
        } else await refreshContext();
        reconciled = true;
        reconciliation = 'Фактическое состояние сервера восстановлено.';
      } catch (reconcileReason) {
        reconciliation +=
          ' ' +
          (reconcileReason instanceof Error ? reconcileReason.message : String(reconcileReason));
      }
      if (!reconciled && config.retryDraft) {
        const retryDraft = config.retryDraft.draft;
        updateDraft(config.retryDraft.slotKey, {
          status: retryDraft.file ? 'error' : 'saved',
          progress: null,
          roiDirty: retryDraft.file ? retryDraft.roiDirty : true,
          error: retryDraft.file
            ? 'Связь с сервером потеряна. Исходный файл сохранён в этой вкладке — можно повторить.'
            : 'Связь с сервером потеряна. ROI не подтверждена — можно повторить сохранение.',
        });
      }
      const detail = reason instanceof Error ? reason.message : String(reason);
      updateOperation({
        status: 'error',
        stage: cancelled ? 'Запрос отменён' : 'Операция не завершена',
        progress: null,
        cancellable: false,
        message: cancelled
          ? `Клиентский запрос остановлен. Rollback не обещается. ${reconciliation}`
          : `${detail}. ${reconciliation}`,
      });
    } finally {
      operationAbort.current = null;
    }
  }

  function buildSelection(): CreatePolicyCaptureAttemptRequest | null {
    const sourcePh = Number(form.sourcePh);
    const referencePh = Number(form.referencePh);
    if (
      !form.operatorId.trim() ||
      !form.deviceRole ||
      !form.specimenMode ||
      !form.sourcePh ||
      !form.referencePh ||
      !form.lightLabel ||
      !form.angleLabel ||
      !form.distanceLabel
    ) {
      setError('Выберите оба pH, роль устройства, тип образца и заполните данные сессии.');
      return null;
    }
    if (!Number.isFinite(sourcePh) || !Number.isFinite(referencePh)) {
      setError('pH должен быть выбран из политики.');
      return null;
    }
    if (form.specimenMode === 'shared' && !replacementMode && !form.sharedSpecimenId) {
      setError('Выберите общий образец или создание нового.');
      return null;
    }
    return {
      sourcePh,
      referencePh,
      deviceRole: form.deviceRole,
      specimenMode: form.specimenMode,
      sharedSpecimenId:
        form.specimenMode === 'shared' &&
        form.sharedSpecimenId &&
        form.sharedSpecimenId !== NEW_SHARED_SPECIMEN
          ? form.sharedSpecimenId
          : null,
      operatorId: form.operatorId.trim(),
      lightLabel: form.lightLabel,
      angleLabel: form.angleLabel,
      distanceLabel: form.distanceLabel,
    };
  }

  async function startAttempt() {
    const input = buildSelection();
    if (!input) return;
    writeLocal(ATTEMPT_KEY, '');
    const clientRequestId = readLocal(CREATE_REQUEST_KEY) || window.crypto.randomUUID();
    writeLocal(CREATE_REQUEST_KEY, clientRequestId);
    await runOperation(
      {
        kind: 'create',
        title: 'Создаём новую пару',
        stage: 'Сервер резервирует quota и создаёт ID…',
        successMessage: 'Пара создана. Можно снимать reference.',
        cancellable: false,
        reconcileClientRequestId: clientRequestId,
      },
      async ({ signal }) => {
        const created = await createCaptureAttempt(input, clientRequestId, signal);
        applyAttempt(created);
        await refreshContext(signal);
      },
    );
  }

  function chooseFile(slotKey: string, file: File | null) {
    const current = drafts[slotKey];
    if (!file || !current || terminal || replacementMode) return;
    if (current.localPreview && current.previewUrl) {
      URL.revokeObjectURL(current.previewUrl);
      localUrls.current.delete(current.previewUrl);
    }
    const previewUrl = URL.createObjectURL(file);
    localUrls.current.add(previewUrl);
    updateDraft(slotKey, {
      file,
      previewUrl,
      localPreview: true,
      roi: freshRoi(policy?.requirePolygonRoi ?? false),
      status: 'empty',
      progress: null,
      error: null,
      roiDirty: false,
    });
  }

  function changeRoi(slotKey: string, roi: RoiShape) {
    const current = drafts[slotKey];
    if (!current || terminal || replacementMode) return;
    updateDraft(slotKey, {
      roi,
      roiDirty: current.status === 'saved' || current.roiDirty,
      error: null,
    });
  }

  async function saveSlot(slotKey: string) {
    if (!attempt || attempt.status !== 'active') return;
    const draft = drafts[slotKey];
    if (!draft || (!draft.file && !draft.roiDirty)) return;
    const hasFile = Boolean(draft.file);
    updateDraft(slotKey, {
      status: 'uploading',
      progress: hasFile ? 0 : null,
      error: null,
    });

    await runOperation(
      {
        kind: hasFile ? 'upload' : 'roi',
        title: hasFile ? 'Сохраняем оригинал' : 'Сохраняем ROI',
        stage: hasFile ? 'Передаём исходный файл…' : 'Сервер сохраняет ROI…',
        successMessage: hasFile
          ? 'Исходный файл сохранён. ROI можно разметить отдельно.'
          : 'Изменённая ROI сохранена.',
        reconcileAttemptId: attempt.id,
        retryDraft: { slotKey, draft },
      },
      async ({ signal, setProgress }) => {
        if (draft.file) {
          const uploaded = await uploadCaptureSlot({
            attemptId: attempt.id,
            slotKey,
            file: draft.file,
            signal,
            onProgress: (loaded, total) => {
              const progress = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
              setProgress(progress);
              updateDraft(slotKey, { progress });
            },
          });
          setAttempt(uploaded.attempt);
          updateDraft(slotKey, {
            file: null,
            status: 'saved',
            progress: null,
            error: null,
            roiDirty: true,
          });
          return;
        }
        const updated = await updateCaptureSlotRoi(attempt.id, slotKey, draft.roi, signal);
        setAttempt(updated);
        updateDraft(slotKey, {
          file: null,
          status: 'saved',
          progress: null,
          error: null,
          roiDirty: false,
        });
      },
    );
  }

  async function beginReaction() {
    if (!attempt || !referenceCaptured || attempt.reactionStartedAt) return;
    await runOperation(
      {
        kind: 'reaction',
        title: 'Начинаем реакцию',
        stage: 'Сервер фиксирует время старта…',
        successMessage: 'Время реакции зафиксировано. Diagnostic доступен.',
        reconcileAttemptId: attempt.id,
      },
      async ({ signal }) => {
        const updated = await startCaptureReaction(attempt.id, signal);
        applyAttempt(updated);
      },
    );
  }

  async function finish() {
    if (!attempt || attempt.status !== 'active' || !ready || !policy) return;
    let parsedPh: number | null = null;
    if (policy.showFinalMixturePh) {
      if (finalPh.trim()) {
        parsedPh = Number(finalPh.replace(',', '.'));
        if (!Number.isFinite(parsedPh) || parsedPh < 0 || parsedPh > 14) {
          setError('Финальный pH должен быть числом от 0 до 14.');
          return;
        }
      } else if (policy.requireFinalMixturePh) {
        setError('Политика требует финальный pH смеси.');
        return;
      }
    }
    if (!included && !exclusionReason.trim()) {
      setError('Укажите причину исключения кейса.');
      return;
    }

    await runOperation(
      {
        kind: 'finalize',
        title: 'Завершаем пару',
        stage: 'Сервер проверяет slots, ROI и сохраняет результат…',
        successMessage: 'Пара сохранена, quota summary обновлена.',
        reconcileAttemptId: attempt.id,
      },
      async ({ signal }) => {
        const updated = await finalizeCaptureAttempt(
          attempt.id,
          {
            finalMixturePh: parsedPh,
            included,
            exclusionReason: included ? null : exclusionReason.trim(),
          },
          signal,
        );
        applyAttempt(updated);
        await refreshContext(signal);
      },
    );
  }

  function prepareReplacement() {
    if (!attempt || (attempt.status !== 'active' && attempt.status !== 'finalized')) return;
    setReplacementMode(true);
    setSpecimenChoice('same');
    setForm((current) => ({
      ...current,
      operatorId: attempt.operatorId,
      deviceRole: attempt.deviceRole ?? '',
      specimenMode: attempt.specimenMode ?? '',
      sourcePh: '',
      referencePh: '',
      sharedSpecimenId: '',
      lightLabel: attempt.condition.lightLabel,
      angleLabel: attempt.condition.angleLabel,
      distanceLabel: attempt.condition.distanceLabel,
    }));
    setError(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function cancelReplacementPreparation() {
    if (attempt) applyAttempt(attempt);
    else setReplacementMode(false);
  }

  async function submitReplacement() {
    if (!attempt) return;
    const selection = buildSelection();
    if (!selection) return;
    if (
      specimenChoice === 'same' &&
      (selection.sourcePh !== attempt.task.sourcePh ||
        selection.specimenMode !== attempt.specimenMode)
    ) {
      setError('Для того же образца заново выберите прежний source pH и прежний тип образца.');
      return;
    }

    await runOperation(
      {
        kind: 'replacement',
        title: attempt.status === 'finalized' ? 'Создаём пересъёмку' : 'Начинаем пару заново',
        stage: 'Сервер сохраняет history и резервирует replacement…',
        successMessage: 'Replacement создан. Оба снимка нужно сделать заново.',
        reconcileAttemptId: attempt.id,
      },
      async ({ signal }) => {
        const result = await replaceCaptureAttempt(
          attempt.id,
          { ...selection, sharedSpecimenId: null, specimenChoice },
          signal,
        );
        applyAttempt(result.replacementAttempt);
        await refreshContext(signal);
      },
    );
  }

  function newPair() {
    clearLocalPreviews();
    writeLocal(ATTEMPT_KEY, '');
    writeLocal(CREATE_REQUEST_KEY, '');
    setAttempt(null);
    setDrafts({});
    setForm((current) => ({
      ...current,
      sourcePh: '',
      referencePh: '',
      sharedSpecimenId: '',
    }));
    setFinalPh('');
    setIncluded(true);
    setExclusionReason('');
    setReplacementMode(false);
    setError(null);
  }

  const selectionVisible = policy?.status === 'active' && (!attempt || replacementMode);
  const status = restoring
    ? 'Восстанавливаем предыдущую попытку…'
    : attempt
      ? attemptStatusText(attempt)
      : policy?.status === 'draft'
        ? 'Серия закрыта до утверждения policy'
        : 'Выберите параметры новой пары';

  return (
    <section className="capture-mobile" aria-busy={operation?.status === 'running'}>
      <header className="capture-mobile-header">
        <div>
          <p className="capture-kicker">Capture V10 · Mobile First</p>
          <h1>Съёмка пары</h1>
          <p className="muted">
            Сервер задаёт допустимые pH, quota и идентификаторы. Оператор выбирает доступный pH.
            Оригиналы сохраняются без перекодирования.
          </p>
        </div>
        {attempt?.reactionStartedAt ? (
          <div className="capture-timer">
            <span>Реакция</span>
            <strong>{duration(elapsed)}</strong>
          </div>
        ) : null}
      </header>

      <div className="capture-status-strip" role="status" aria-live="polite">
        <span
          className={
            'capture-status-dot ' +
            (finalized ? 'is-done' : attempt?.status === 'active' ? 'is-active' : '')
          }
        />
        <strong>{status}</strong>
        {attempt ? <span className="mono">#{attempt.id.slice(0, 8)}</span> : null}
      </div>

      {contextLoading && !context ? <div className="panel muted">Загружаем policy…</div> : null}

      {policy?.status === 'draft' && !attempt ? (
        <section className="panel capture-policy-closed" role="status">
          <p className="capture-kicker">Серия {policy.seriesId}</p>
          <h2>Новая съёмка закрыта</h2>
          <p>{policy.instruction}</p>
          <dl className="capture-policy-meta">
            <div>
              <dt>Policy</dt>
              <dd className="mono">{policy.policyId}</dd>
            </div>
            <div>
              <dt>Версия</dt>
              <dd className="mono">{policy.version}</dd>
            </div>
            <div>
              <dt>Статус</dt>
              <dd>draft / closed</dd>
            </div>
          </dl>
        </section>
      ) : null}

      {selectionVisible && policy ? (
        <section className="panel capture-task-card capture-selection-card">
          <SectionHeading number="1" title={replacementMode ? 'Пара для пересъёмки' : 'Новая пара'}>
            <span className="capture-task-code">{policy.seriesId}</span>
          </SectionHeading>
          <p className="capture-policy-instruction">{policy.instruction}</p>
          {replacementMode && attempt ? (
            <div className="capture-replacement-hint">
              Старый контекст: source pH {phText(attempt.task.sourcePh)}, reference pH{' '}
              {attempt.referencePh === undefined ? '—' : phText(attempt.referencePh)}. Значения не
              перенесены: выберите оба pH заново.
            </div>
          ) : null}

          <div className="capture-session-grid">
            <TextField
              label="Оператор"
              value={form.operatorId}
              disabled={false}
              placeholder="Имя или ID"
              onChange={(value) => updateForm('operatorId', value)}
            />
            <SelectField
              label="Роль устройства"
              value={form.deviceRole}
              disabled={replacementMode}
              placeholder="Выберите роль"
              options={policy.deviceRoles.map((role) => ({ value: role.value, label: role.label }))}
              onChange={(value) => updateForm('deviceRole', value)}
            />
            <SelectField
              label="Тип образца"
              value={form.specimenMode}
              disabled={replacementMode && specimenChoice === 'same'}
              placeholder="Выберите тип"
              options={policy.specimenModes.map((mode) => ({
                value: mode,
                label: specimenModeText(mode),
              }))}
              onChange={(value) => updateForm('specimenMode', value as CaptureSpecimenMode)}
            />
          </div>

          <div className="capture-ph-grid">
            <label>
              Source pH
              <select
                value={form.sourcePh}
                disabled={!form.deviceRole || !form.specimenMode}
                onChange={(event) => updateForm('sourcePh', event.target.value)}
              >
                <option value="">Выберите pH</option>
                {policy.sourcePhValues.map((sourcePh) => {
                  const cell = context?.quotaSummary.cells.find(
                    (item) =>
                      item.sourcePh === sourcePh &&
                      item.deviceRole === form.deviceRole &&
                      item.specimenMode === form.specimenMode,
                  );
                  const ownReplacementCell = Boolean(
                    replacementMode &&
                    attempt &&
                    attempt.task.sourcePh === sourcePh &&
                    attempt.deviceRole === form.deviceRole &&
                    attempt.specimenMode === form.specimenMode,
                  );
                  const completed = Boolean(cell && cell.actual >= cell.target);
                  const unavailable = !cell || (cell.available === 0 && !ownReplacementCell);
                  const progress = cell
                    ? completed
                      ? `готово ${cell.actual}/${cell.target}`
                      : `${cell.actual}/${cell.target}${cell.reserved ? ` · резерв ${cell.reserved}` : ''}`
                    : 'quota не объявлена';
                  return (
                    <option key={sourcePh} value={String(sourcePh)} disabled={unavailable}>
                      pH {phText(sourcePh)} — {progress}
                    </option>
                  );
                })}
              </select>
            </label>
            <label>
              Reference pH
              <select
                value={form.referencePh}
                onChange={(event) => updateForm('referencePh', event.target.value)}
              >
                <option value="">Выберите pH</option>
                <option value={String(policy.referencePh)}>
                  pH {phText(policy.referencePh)} — исходный индикатор
                </option>
              </select>
            </label>
          </div>

          {replacementMode ? (
            <div className="segmented-block">
              <span>Образец для replacement</span>
              <div className="segmented-row two">
                <button
                  type="button"
                  className={specimenChoice === 'same' ? 'active' : ''}
                  onClick={() => {
                    setSpecimenChoice('same');
                    if (attempt?.specimenMode) updateForm('specimenMode', attempt.specimenMode);
                  }}
                >
                  Тот же образец
                </button>
                <button
                  type="button"
                  className={specimenChoice === 'new' ? 'active' : ''}
                  onClick={() => setSpecimenChoice('new')}
                >
                  Новый образец
                </button>
              </div>
            </div>
          ) : form.specimenMode === 'shared' ? (
            <label>
              Общий образец
              <select
                value={form.sharedSpecimenId}
                onChange={(event) => updateForm('sharedSpecimenId', event.target.value)}
              >
                <option value="">Выберите общий образец</option>
                <option value={NEW_SHARED_SPECIMEN}>Создать новый общий образец</option>
                {context?.availableSharedSpecimens.map((specimen) => (
                  <option key={specimen.specimenId} value={specimen.specimenId}>
                    {specimen.displayLabel} · готово:{' '}
                    {specimen.completedDeviceRoles.join(', ') || '—'}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <div className="capture-options-grid">
            <SelectField
              label="Свет"
              value={form.lightLabel}
              placeholder="Выберите свет"
              options={policy.conditions.lights}
              onChange={(value) => updateForm('lightLabel', value)}
            />
            <SelectField
              label="Угол"
              value={form.angleLabel}
              placeholder="Выберите угол"
              options={policy.conditions.angles}
              onChange={(value) => updateForm('angleLabel', value)}
            />
            <SelectField
              label="Расстояние"
              value={form.distanceLabel}
              placeholder="Выберите расстояние"
              options={policy.conditions.distances}
              onChange={(value) => updateForm('distanceLabel', value)}
            />
          </div>

          <div className="capture-selection-actions">
            {replacementMode ? (
              <button type="button" className="secondary" onClick={cancelReplacementPreparation}>
                Отменить подготовку
              </button>
            ) : null}
            <button
              type="button"
              className="primary"
              disabled={restoring || contextLoading}
              onClick={() => void (replacementMode ? submitReplacement() : startAttempt())}
            >
              {replacementMode ? 'Создать replacement' : 'Создать пару'}
            </button>
          </div>
        </section>
      ) : null}

      {attempt ? (
        <section className="panel capture-attempt-summary">
          <SectionHeading number="2" title={attempt.displayLabel ?? 'Серверный образец'}>
            <span className="capture-saved-badge">{attemptStatusText(attempt)}</span>
          </SectionHeading>
          <dl className="capture-task-summary">
            <div>
              <dt>Source pH</dt>
              <dd>{phText(attempt.task.sourcePh)}</dd>
            </div>
            <div>
              <dt>Reference pH</dt>
              <dd>{attempt.referencePh === undefined ? '—' : phText(attempt.referencePh)}</dd>
            </div>
            <div>
              <dt>Роль</dt>
              <dd>{attempt.deviceRole ?? '—'}</dd>
            </div>
            <div>
              <dt>Тип</dt>
              <dd>{specimenModeText(attempt.specimenMode)}</dd>
            </div>
          </dl>
          <p className="control-hint">
            Pair ID создаёт сервер: <span className="mono">{attempt.pairId}</span>
          </p>
        </section>
      ) : null}

      {attempt ? (
        <section className="capture-slot-section">
          <SectionHeading number="3" title="Снимки">
            <span className="muted">
              {
                attempt.task.slots.filter(
                  (slot) => drafts[slot.key]?.status === 'saved' && !drafts[slot.key]?.roiDirty,
                ).length
              }{' '}
              / {attempt.task.slots.length}
            </span>
          </SectionHeading>
          <div className="capture-slot-list">
            {attempt.task.slots.map((slot) => {
              const diagnosticLocked = slot.kind === 'diagnostic' && !attempt.reactionStartedAt;
              const hasUpload = Boolean(attempt.uploads[slot.key]);
              const referenceDuringReaction =
                slot.kind === 'reference' && Boolean(attempt.reactionStartedAt) && !diagnosticSaved;
              const commonLocked = terminal || replacementMode;
              const photoDisabled =
                commonLocked ||
                diagnosticLocked ||
                (slot.kind === 'reference' && Boolean(attempt.reactionStartedAt)) ||
                (slot.kind === 'diagnostic' && hasUpload);
              const roiDisabled =
                commonLocked || diagnosticLocked || !hasUpload || referenceDuringReaction;
              return (
                <CaptureSlot
                  key={slot.key}
                  slot={slot}
                  draft={drafts[slot.key]}
                  elapsed={elapsed}
                  reactionStarted={Boolean(attempt.reactionStartedAt)}
                  requirePolygon={policy?.requirePolygonRoi ?? false}
                  photoDisabled={photoDisabled}
                  roiDisabled={roiDisabled}
                  lockedReason={
                    terminal
                      ? 'Пара завершена. Для исправления используйте «Переснять пару».'
                      : replacementMode
                        ? 'Сначала создайте replacement-пару.'
                        : diagnosticLocked
                          ? 'Сначала сохраните reference и нажмите «Начать реакцию».'
                          : referenceDuringReaction
                            ? 'Reference временно зафиксирован до сохранения diagnostic.'
                            : slot.kind === 'reference' && attempt.reactionStartedAt
                              ? 'Фото reference зафиксировано. ROI можно редактировать.'
                              : slot.kind === 'diagnostic' && hasUpload
                                ? 'Фото diagnostic зафиксировано. ROI можно редактировать.'
                                : null
                  }
                  onFile={(file) => chooseFile(slot.key, file)}
                  onRoi={(roi) => changeRoi(slot.key, roi)}
                  onSave={() => void saveSlot(slot.key)}
                />
              );
            })}
          </div>
        </section>
      ) : null}

      {attempt?.status === 'active' &&
      !attempt.reactionStartedAt &&
      referenceCaptured &&
      !replacementMode ? (
        <section className="panel capture-reaction-action">
          <h2>Reference сохранён</h2>
          <p>ROI можно разметить сейчас или после diagnostic. Нажмите кнопку перед смешиванием.</p>
          <button type="button" className="primary" onClick={() => void beginReaction()}>
            Начать реакцию
          </button>
        </section>
      ) : null}

      {attempt ? (
        <section className="panel capture-finalize">
          <SectionHeading number="4" title="Завершение">
            {attempt.result ? (
              <span className="capture-saved-badge">Сохранено</span>
            ) : (
              <span className="muted">После diagnostic</span>
            )}
          </SectionHeading>

          {policy?.showFinalMixturePh ? (
            <label>
              Финальный pH смеси {policy.requireFinalMixturePh ? '(обязательно)' : '(если измерен)'}
              <input
                value={finalPh}
                disabled={terminal}
                required={policy.requireFinalMixturePh}
                inputMode="decimal"
                placeholder={policy.requireFinalMixturePh ? 'Введите pH' : 'Можно оставить пустым'}
                onChange={(event) => setFinalPh(event.target.value)}
              />
            </label>
          ) : null}

          <div className="capture-final-grid">
            <label>
              Статус кейса
              <select
                value={included ? 'included' : 'excluded'}
                disabled={terminal}
                onChange={(event) => setIncluded(event.target.value === 'included')}
              >
                <option value="included">Включить в датасет</option>
                <option value="excluded">Исключить</option>
              </select>
            </label>
            {!included ? (
              <TextField
                label="Причина исключения"
                value={exclusionReason}
                disabled={terminal}
                placeholder="Почему кейс нельзя использовать"
                onChange={setExclusionReason}
              />
            ) : null}
          </div>

          {attempt.result ? (
            <div className="success">
              Кейс <span className="mono">{attempt.result.caseId}</span> сохранён{' '}
              {attempt.result.included ? 'и включён в датасет' : 'как исключённый'}.
            </div>
          ) : null}
        </section>
      ) : null}

      {error ? (
        <div className="error-box" role="alert">
          {error}
        </div>
      ) : null}

      {attempt && !replacementMode ? (
        <div className="capture-mobile-actions">
          {attempt.status === 'active' ? (
            <>
              <button type="button" className="secondary" onClick={prepareReplacement}>
                Начать пару заново
              </button>
              <button
                type="button"
                className="primary"
                disabled={!ready}
                onClick={() => void finish()}
              >
                Завершить и сохранить
              </button>
            </>
          ) : attempt.status === 'finalized' ? (
            <>
              <button type="button" className="secondary" onClick={prepareReplacement}>
                Переснять пару
              </button>
              <button type="button" className="primary" onClick={newPair}>
                Новая пара
              </button>
            </>
          ) : (
            <button type="button" className="primary" onClick={newPair}>
              Вернуться к новой паре
            </button>
          )}
        </div>
      ) : null}

      {operation ? (
        <OperationOverlay
          operation={operation}
          onCancel={() => operationAbort.current?.abort()}
          onClose={() => {
            if (operation.status !== 'running') setOperation(null);
          }}
        />
      ) : null}
    </section>
  );
}

function SectionHeading(props: { number: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="capture-section-heading">
      <div>
        <span className="capture-step-number">{props.number}</span>
        <h2>{props.title}</h2>
      </div>
      {props.children}
    </div>
  );
}

function TextField(props: {
  label: string;
  value: string;
  disabled: boolean;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      {props.label}
      <input
        required
        value={props.value}
        disabled={props.disabled}
        placeholder={props.placeholder}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </label>
  );
}

function SelectField(props: {
  label: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  placeholder: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      {props.label}
      <select
        value={props.value}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.target.value)}
      >
        <option value="">{props.placeholder}</option>
        {props.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function CaptureSlot(props: {
  slot: CaptureTaskSlot;
  draft?: SlotDraft;
  elapsed: number;
  reactionStarted: boolean;
  requirePolygon: boolean;
  photoDisabled: boolean;
  roiDisabled: boolean;
  lockedReason: string | null;
  onFile: (file: File | null) => void;
  onRoi: (roi: RoiShape) => void;
  onSave: () => void;
}) {
  const { slot, draft } = props;
  if (!draft) return null;
  const hasAction = Boolean(draft.file || draft.roiDirty);
  const uploading = draft.status === 'uploading';
  const controlsLocked = props.photoDisabled && props.roiDisabled;
  const actionDisabled = draft.file ? props.photoDisabled : props.roiDisabled;
  const action = draft.file
    ? draft.status === 'error'
      ? 'Повторить загрузку'
      : 'Загрузить оригинал'
    : 'Сохранить ROI';

  return (
    <article
      className={
        'panel capture-slot-card slot-' + draft.status + (controlsLocked ? ' is-locked' : '')
      }
    >
      <div className="capture-slot-head">
        <div>
          <span className="capture-slot-kind">
            {slot.required ? 'Обязательный' : 'Дополнительный'}
          </span>
          <h3>{slot.label}</h3>
        </div>
        <span className={'slot-status slot-status-' + draft.status}>{slotStatus(draft)}</span>
      </div>

      {slot.kind === 'diagnostic' ? (
        <div className="capture-slot-timing">
          <span>
            {props.reactionStarted ? timing(slot, props.elapsed) : 'Реакция ещё не начата'}
          </span>
          {slot.targetSeconds === null || slot.toleranceSeconds === null ? (
            <small>Научное окно не задано — показываем только честный elapsed.</small>
          ) : null}
        </div>
      ) : null}

      {props.lockedReason ? (
        <div className="capture-slot-lock-note">{props.lockedReason}</div>
      ) : null}

      <RoiEditor
        src={draft.previewUrl}
        alt={slot.label}
        value={draft.roi}
        onChange={props.roiDisabled ? () => undefined : props.onRoi}
        allowPolygon
        requirePolygon={props.requirePolygon}
        compact
        placeholder={
          draft.status === 'saved'
            ? 'Оригинал сохранён; предпросмотр недоступен'
            : 'Снимите или выберите фото'
        }
      />
      <p className="roi-guidance">
        {props.requirePolygon
          ? 'Обведите наполнитель многоугольником без бортика, плитки и фона.'
          : 'В ROI должен быть только чистый наполнитель — без бортика, плитки и фона.'}
      </p>

      <label
        className={'file-button capture-file-button ' + (props.photoDisabled ? 'is-disabled' : '')}
      >
        {draft.previewUrl ? 'Снять / выбрать замену' : 'Снять / выбрать фото'}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          disabled={props.photoDisabled}
          onChange={(event) => {
            props.onFile(event.target.files?.[0] ?? null);
            event.currentTarget.value = '';
          }}
        />
      </label>

      {draft.file ? (
        <div className="capture-file-meta">
          <span title={draft.file.name}>{draft.file.name}</span>
          <strong>{(draft.file.size / 1048576).toFixed(2)} МБ</strong>
        </div>
      ) : null}

      {draft.error ? (
        <div className="capture-slot-error" role="alert">
          {draft.error}
        </div>
      ) : null}

      {hasAction ? (
        <button
          type="button"
          className="primary capture-slot-action"
          disabled={actionDisabled || uploading}
          onClick={props.onSave}
        >
          {uploading ? slotStatus(draft) : action}
        </button>
      ) : draft.status === 'saved' ? (
        <div className="capture-slot-success">Оригинал и ROI сохранены</div>
      ) : null}
    </article>
  );
}

function OperationOverlay(props: {
  operation: OperationState;
  onCancel: () => void;
  onClose: () => void;
}) {
  const { operation } = props;
  return (
    <div className="capture-operation-backdrop" role="presentation">
      <div
        className={'capture-operation-dialog operation-' + operation.status}
        role="dialog"
        aria-modal="true"
        aria-labelledby="capture-operation-title"
      >
        <div className="capture-operation-indicator" aria-hidden="true">
          {operation.status === 'running' ? <span className="capture-spinner" /> : null}
          {operation.status === 'success' ? '✓' : null}
          {operation.status === 'error' ? '!' : null}
        </div>
        <h2 id="capture-operation-title">{operation.title}</h2>
        <p>{operation.stage}</p>
        {operation.status === 'running' && operation.progress !== null ? (
          <div className="capture-operation-progress">
            <progress max={100} value={operation.progress} />
            <strong>{operation.progress}%</strong>
          </div>
        ) : null}
        {operation.message ? (
          <div className="capture-operation-message">{operation.message}</div>
        ) : null}
        <div className="capture-operation-actions">
          {operation.status === 'running' && operation.cancellable ? (
            <button type="button" className="secondary" onClick={props.onCancel}>
              Отменить запрос
            </button>
          ) : null}
          {operation.status !== 'running' ? (
            <button type="button" className="primary" onClick={props.onClose}>
              Продолжить
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
