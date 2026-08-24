/**
 * Мобильный capture-flow по серверному заданию.
 * Оригиналы отправляются без перекодирования, состояние слотов хранит сервер.
 */

import {
  type CaptureAttempt,
  type CaptureTask,
  type CaptureTaskSlot,
  type RoiShape,
} from '@cats-screening/shared';
import { useEffect, useMemo, useRef, useState } from 'react';

import { RoiEditor } from '../components/RoiEditor';
import {
  createCaptureAttempt,
  fetchCaptureAttempt,
  fetchCaptureTask,
  finalizeCaptureAttempt,
  updateCaptureSlotRoi,
  uploadCaptureSlot,
} from '../lib/api';
import { FIXED_WIDE_ROI, rectToRoiShape } from '../lib/roi';

const LIGHTS = [
  ['daylight', 'Дневной свет'],
  ['warm_indoor', 'Тёплый комнатный'],
  ['cool_indoor', 'Холодный комнатный'],
  ['mixed_indoor', 'Смешанный'],
] as const;
const ANGLES = [
  ['straight', 'Ровно сверху'],
  ['slight_left', 'Наклон слева'],
  ['slight_right', 'Наклон справа'],
  ['slight_top', 'Наклон сверху'],
] as const;
const DISTANCES = [
  ['normal', 'Обычная'],
  ['slightly_near', 'Чуть ближе'],
  ['slightly_far', 'Чуть дальше'],
] as const;

const OPERATOR_KEY = 'cats.capture.operatorId';
const DEVICE_KEY = 'cats.capture.device';
const ATTEMPT_KEY = 'cats.capture.attemptId';

type CaptureForm = {
  taskCode: string;
  series: string;
  operatorId: string;
  device: string;
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
    // localStorage опционален: capture остаётся рабочим без восстановления.
  }
}

function inferDevice(): string {
  const ua = window.navigator.userAgent;
  const samsung = ua.match(/\bSM-[A-Z0-9]+\b/i)?.[0];
  if (samsung) return 'Samsung ' + samsung.toUpperCase();
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Android/i.test(ua)) return 'Android phone';
  if (/Windows/i.test(ua)) return 'Windows desktop';
  if (/Mac OS X/i.test(ua)) return 'macOS desktop';
  return '';
}

function initialForm(): CaptureForm {
  return {
    taskCode: '',
    series: 'V9',
    operatorId: readLocal(OPERATOR_KEY),
    device: readLocal(DEVICE_KEY) || inferDevice(),
    lightLabel: 'daylight',
    angleLabel: 'straight',
    distanceLabel: 'normal',
  };
}

function freshRoi(): RoiShape {
  return rectToRoiShape(FIXED_WIDE_ROI);
}

function draftsForTask(task: CaptureTask): Record<string, SlotDraft> {
  return Object.fromEntries(
    task.slots.map((slot) => [
      slot.key,
      {
        file: null,
        previewUrl: null,
        localPreview: false,
        roi: freshRoi(),
        status: 'empty',
        progress: null,
        error: null,
        roiDirty: false,
      },
    ]),
  );
}

function draftsForAttempt(attempt: CaptureAttempt): Record<string, SlotDraft> {
  return Object.fromEntries(
    attempt.task.slots.map((slot) => {
      const upload = attempt.uploads[slot.key];
      return [
        slot.key,
        {
          file: null,
          previewUrl: upload?.publicUrl ?? null,
          localPreview: false,
          roi: upload?.roi ?? freshRoi(),
          status: upload ? 'saved' : 'empty',
          progress: null,
          error: null,
          roiDirty: false,
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
  if (slot.targetSeconds === null) return 'Прошло ' + duration(elapsed);
  const remaining = slot.targetSeconds - elapsed;
  if (remaining > 0) return 'До целевого времени ' + duration(remaining);
  const over = Math.abs(remaining);
  return over <= (slot.toleranceSeconds ?? 0)
    ? 'Целевое окно: +' + duration(over)
    : 'После целевого окна: +' + duration(over);
}

function slotStatus(draft: SlotDraft): string {
  if (draft.status === 'uploading') {
    return draft.progress === null ? 'Сохранение ROI…' : 'Передано ' + draft.progress + '%';
  }
  if (draft.status === 'saved' && draft.roiDirty) return 'ROI изменена';
  if (draft.status === 'saved') return 'Сохранено';
  if (draft.status === 'error') return 'Нужен повтор';
  if (draft.file) return 'Готово к загрузке';
  return 'Фото не выбрано';
}

export function CapturePage() {
  const [form, setForm] = useState<CaptureForm>(initialForm);
  const [task, setTask] = useState<CaptureTask | null>(null);
  const [attempt, setAttempt] = useState<CaptureAttempt | null>(null);
  const [drafts, setDrafts] = useState<Record<string, SlotDraft>>({});
  const [restoring, setRestoring] = useState(true);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [startBusy, setStartBusy] = useState(false);
  const [busySlot, setBusySlot] = useState<string | null>(null);
  const [finalizeBusy, setFinalizeBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [finalPh, setFinalPh] = useState('');
  const [included, setIncluded] = useState(true);
  const [exclusionReason, setExclusionReason] = useState('');
  const [clock, setClock] = useState(Date.now());
  const localUrls = useRef(new Set<string>());

  const activeTask = attempt?.task ?? task;
  const finalized = attempt?.status === 'finalized';
  const elapsed = useMemo(() => {
    if (!attempt) return 0;
    const started = new Date(attempt.reactionStartedAt).getTime();
    return Number.isFinite(started) ? Math.max(0, Math.floor((clock - started) / 1000)) : 0;
  }, [attempt, clock]);

  const currentSlot = useMemo(() => {
    if (!activeTask) return null;
    return (
      activeTask.slots.find((slot) => {
        const draft = drafts[slot.key];
        return slot.required && (!draft || draft.status !== 'saved' || draft.roiDirty);
      }) ??
      activeTask.slots.find((slot) => {
        const draft = drafts[slot.key];
        return !draft || draft.status !== 'saved' || draft.roiDirty;
      }) ??
      null
    );
  }, [activeTask, drafts]);

  const ready = useMemo(
    () =>
      Boolean(activeTask) &&
      activeTask!.slots
        .filter((slot) => slot.required)
        .every((slot) => drafts[slot.key]?.status === 'saved' && !drafts[slot.key]?.roiDirty),
    [activeTask, drafts],
  );

  useEffect(() => writeLocal(OPERATOR_KEY, form.operatorId), [form.operatorId]);
  useEffect(() => writeLocal(DEVICE_KEY, form.device), [form.device]);

  useEffect(() => {
    let cancelled = false;
    const id = readLocal(ATTEMPT_KEY);
    if (!id) {
      setRestoring(false);
      return;
    }

    fetchCaptureAttempt(id)
      .then((restored) => {
        if (!cancelled) applyAttempt(restored);
      })
      .catch((reason) => {
        if (cancelled) return;
        writeLocal(ATTEMPT_KEY, '');
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
    if (!attempt || attempt.status !== 'active') return;
    setClock(Date.now());
    const interval = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [attempt?.id, attempt?.status]);

  useEffect(
    () => () => {
      for (const url of localUrls.current) URL.revokeObjectURL(url);
    },
    [],
  );

  function applyAttempt(next: CaptureAttempt) {
    setAttempt(next);
    setTask(next.task);
    setDrafts(draftsForAttempt(next));
    setForm((current) => ({
      ...current,
      taskCode: next.task.code,
      series: next.series,
      operatorId: next.operatorId,
      device: next.device,
      lightLabel: next.condition.lightLabel,
      angleLabel: next.condition.angleLabel,
      distanceLabel: next.condition.distanceLabel,
    }));
    setFinalPh(next.finalMixturePh?.toString() ?? '');
    setIncluded(next.result?.included ?? true);
    setExclusionReason(next.result?.exclusionReason ?? '');
    writeLocal(ATTEMPT_KEY, next.id);
  }

  function updateForm<K extends keyof CaptureForm>(key: K, value: CaptureForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    if (key === 'taskCode' && !attempt) {
      setTask(null);
      setDrafts({});
    }
  }

  function updateDraft(slotKey: string, change: Partial<SlotDraft>) {
    setDrafts((current) => {
      const draft = current[slotKey];
      return draft ? { ...current, [slotKey]: { ...draft, ...change } } : current;
    });
  }

  async function lookup() {
    const code = form.taskCode.trim().toUpperCase();
    if (!code) {
      setError('Введите код задания.');
      return;
    }
    try {
      setLookupBusy(true);
      setError(null);
      const found = await fetchCaptureTask(code);
      setTask(found);
      setDrafts(draftsForTask(found));
      setForm((current) => ({ ...current, taskCode: found.code }));
    } catch (reason) {
      setTask(null);
      setDrafts({});
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLookupBusy(false);
    }
  }

  async function start() {
    const operatorId = form.operatorId.trim();
    const device = form.device.trim();
    const series = form.series.trim();
    if (!operatorId || !device || !series || !form.taskCode.trim()) {
      setError('Заполните код, оператора, устройство и серию.');
      return;
    }
    try {
      setStartBusy(true);
      setError(null);
      const code = form.taskCode.trim().toUpperCase();
      const selected = task?.code === code ? task : await fetchCaptureTask(code);
      const created = await createCaptureAttempt({
        taskCode: selected.code,
        operatorId,
        device,
        series,
        lightLabel: form.lightLabel,
        angleLabel: form.angleLabel,
        distanceLabel: form.distanceLabel,
      });
      applyAttempt(created);
      setClock(Date.now());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setStartBusy(false);
    }
  }

  function chooseFile(slotKey: string, file: File | null) {
    const current = drafts[slotKey];
    if (!file || !current || finalized) return;
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
      status: 'empty',
      progress: null,
      error: null,
      roiDirty: false,
    });
  }

  function changeRoi(slotKey: string, roi: RoiShape) {
    const current = drafts[slotKey];
    if (!current || finalized) return;
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

    try {
      setBusySlot(slotKey);
      updateDraft(slotKey, {
        status: 'uploading',
        progress: draft.file ? 0 : null,
        error: null,
      });
      if (draft.file) {
        await uploadCaptureSlot({
          attemptId: attempt.id,
          slotKey,
          file: draft.file,
          onProgress: (loaded, total) =>
            updateDraft(slotKey, {
              progress: total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0,
            }),
        });
      }
      const updated = await updateCaptureSlotRoi(attempt.id, slotKey, draft.roi);
      setAttempt(updated);
      updateDraft(slotKey, {
        file: null,
        status: 'saved',
        progress: null,
        error: null,
        roiDirty: false,
      });
    } catch (reason) {
      updateDraft(slotKey, {
        status: 'error',
        progress: null,
        error: reason instanceof Error ? reason.message : String(reason),
      });
    } finally {
      setBusySlot(null);
    }
  }

  async function finish() {
    if (!attempt || attempt.status !== 'active' || !ready) return;
    let parsedPh: number | null = null;
    if (attempt.task.taskType !== 'blank_qc' && finalPh.trim()) {
      parsedPh = Number(finalPh.replace(',', '.'));
      if (!Number.isFinite(parsedPh) || parsedPh < 0 || parsedPh > 14) {
        setError('Финальный pH должен быть числом от 0 до 14.');
        return;
      }
    }
    if (!included && !exclusionReason.trim()) {
      setError('Укажите причину исключения кейса.');
      return;
    }

    try {
      setFinalizeBusy(true);
      setError(null);
      applyAttempt(
        await finalizeCaptureAttempt(attempt.id, {
          finalMixturePh: parsedPh,
          included,
          exclusionReason: included ? null : exclusionReason.trim(),
        }),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setFinalizeBusy(false);
    }
  }

  function newTask() {
    for (const url of localUrls.current) URL.revokeObjectURL(url);
    localUrls.current.clear();
    writeLocal(ATTEMPT_KEY, '');
    setAttempt(null);
    setTask(null);
    setDrafts({});
    setForm((current) => ({ ...current, taskCode: '' }));
    setFinalPh('');
    setIncluded(true);
    setExclusionReason('');
    setError(null);
  }

  const status = restoring
    ? 'Восстанавливаем предыдущую попытку…'
    : finalized
      ? 'Кейс сохранён'
      : attempt
        ? currentSlot
          ? 'Текущий шаг: ' + currentSlot.label
          : 'Все снимки сохранены — можно завершать'
        : task
          ? 'Задание найдено — можно начинать'
          : 'Введите код задания';

  return (
    <section className="capture-mobile">
      <header className="capture-mobile-header">
        <div>
          <p className="capture-kicker">Capture · Mobile First</p>
          <h1>Съёмка по заданию</h1>
          <p className="muted">
            Оригиналы сохраняются без сжатия. Повтор одного слота не сбрасывает остальные.
          </p>
        </div>
        {attempt ? (
          <div className="capture-timer">
            <span>Прошло</span>
            <strong>{duration(elapsed)}</strong>
          </div>
        ) : null}
      </header>

      <div className="capture-status-strip" role="status" aria-live="polite">
        <span
          className={'capture-status-dot ' + (finalized ? 'is-done' : attempt ? 'is-active' : '')}
        />
        <strong>{status}</strong>
        {attempt ? <span className="mono">#{attempt.id.slice(0, 8)}</span> : null}
      </div>

      <section className="panel capture-task-card">
        <SectionHeading number="1" title="Задание и сессия">
          {activeTask ? <span className="capture-task-code mono">{activeTask.code}</span> : null}
        </SectionHeading>

        <div className="capture-code-row">
          <label>
            Код задания
            <input
              value={form.taskCode}
              disabled={Boolean(attempt) || restoring}
              autoCapitalize="characters"
              autoComplete="off"
              placeholder="Например, PH400-A1"
              onChange={(event) => updateForm('taskCode', event.target.value.toUpperCase())}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void lookup();
                }
              }}
            />
          </label>
          <button
            type="button"
            className="secondary"
            disabled={Boolean(attempt) || lookupBusy || restoring}
            onClick={() => void lookup()}
          >
            {lookupBusy ? 'Проверяем…' : 'Проверить код'}
          </button>
        </div>
        <p className="control-hint">
          PH400…PH780 или blank BL613; можно добавить суффикс, например PH400-A1. Один код на разных
          телефонах означает один образец.
        </p>

        {activeTask ? (
          <dl className="capture-task-summary">
            <div>
              <dt>Тип</dt>
              <dd>{activeTask.taskType === 'blank_qc' ? 'Blank QC' : 'После реакции'}</dd>
            </div>
            <div>
              <dt>Исходный pH</dt>
              <dd>{activeTask.sourcePh}</dd>
            </div>
            <div>
              <dt>Образец</dt>
              <dd className="mono">{activeTask.specimenId}</dd>
            </div>
            <div>
              <dt>Снимков</dt>
              <dd>{activeTask.slots.length}</dd>
            </div>
          </dl>
        ) : null}

        <div className="capture-session-grid">
          <TextField
            label="Оператор"
            value={form.operatorId}
            disabled={Boolean(attempt)}
            placeholder="Имя или ID"
            onChange={(value) => updateForm('operatorId', value)}
          />
          <TextField
            label="Устройство"
            value={form.device}
            disabled={Boolean(attempt)}
            placeholder="Модель телефона"
            onChange={(value) => updateForm('device', value)}
          />
          <TextField
            label="Серия"
            value={form.series}
            disabled={Boolean(attempt)}
            placeholder="V9"
            onChange={(value) => updateForm('series', value)}
          />
        </div>

        <div className="capture-options-grid">
          <OptionField
            label="Свет"
            value={form.lightLabel}
            options={LIGHTS}
            disabled={Boolean(attempt)}
            onChange={(value) => updateForm('lightLabel', value)}
          />
          <OptionField
            label="Угол"
            value={form.angleLabel}
            options={ANGLES}
            disabled={Boolean(attempt)}
            onChange={(value) => updateForm('angleLabel', value)}
          />
          <OptionField
            label="Расстояние"
            value={form.distanceLabel}
            options={DISTANCES}
            disabled={Boolean(attempt)}
            onChange={(value) => updateForm('distanceLabel', value)}
          />
        </div>
      </section>

      {attempt && activeTask ? (
        <section className="capture-slot-section">
          <SectionHeading number="2" title="Снимки">
            <span className="muted">
              {
                activeTask.slots.filter(
                  (slot) => drafts[slot.key]?.status === 'saved' && !drafts[slot.key]?.roiDirty,
                ).length
              }{' '}
              / {activeTask.slots.length}
            </span>
          </SectionHeading>
          <div className="capture-slot-list">
            {activeTask.slots.map((slot) => (
              <CaptureSlot
                key={slot.key}
                slot={slot}
                draft={drafts[slot.key]}
                elapsed={elapsed}
                disabled={finalized || busySlot !== null}
                onFile={(file) => chooseFile(slot.key, file)}
                onRoi={(roi) => changeRoi(slot.key, roi)}
                onSave={() => void saveSlot(slot.key)}
              />
            ))}
          </div>
        </section>
      ) : null}

      {attempt ? (
        <section className="panel capture-finalize">
          <SectionHeading number="3" title="Завершение">
            {attempt.result ? (
              <span className="capture-saved-badge">Сохранено</span>
            ) : (
              <span className="muted">После всех снимков</span>
            )}
          </SectionHeading>

          {attempt.task.taskType === 'blank_qc' ? (
            <div className="capture-readonly-field">
              <span>Финальный pH</span>
              <strong>Для blank не требуется</strong>
            </div>
          ) : (
            <label>
              Финальный pH смеси, если измерен
              <input
                value={finalPh}
                disabled={finalized}
                inputMode="decimal"
                placeholder="Можно оставить пустым"
                onChange={(event) => setFinalPh(event.target.value)}
              />
            </label>
          )}

          <div className="capture-final-grid">
            <label>
              Статус кейса
              <select
                value={included ? 'included' : 'excluded'}
                disabled={finalized}
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
                disabled={finalized}
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

      <div className="capture-mobile-actions">
        {!attempt ? (
          <button
            type="button"
            className="primary"
            disabled={restoring || startBusy || lookupBusy}
            onClick={() => void start()}
          >
            {startBusy ? 'Создаём попытку…' : 'Начать попытку'}
          </button>
        ) : finalized ? (
          <button type="button" className="primary" onClick={newTask}>
            Новое задание
          </button>
        ) : (
          <>
            <div className="capture-action-status">
              <span>{ready ? 'Все обязательные снимки готовы' : 'Сначала сохраните снимки'}</span>
              {currentSlot ? <strong>{currentSlot.label}</strong> : null}
            </div>
            <button
              type="button"
              className="primary"
              disabled={!ready || finalizeBusy || busySlot !== null}
              onClick={() => void finish()}
            >
              {finalizeBusy ? 'Сохраняем…' : 'Завершить и сохранить'}
            </button>
          </>
        )}
      </div>
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

function OptionField(props: {
  label: string;
  value: string;
  options: ReadonlyArray<readonly [string, string]>;
  disabled: boolean;
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
        {props.options.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
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
  disabled: boolean;
  onFile: (file: File | null) => void;
  onRoi: (roi: RoiShape) => void;
  onSave: () => void;
}) {
  const { slot, draft } = props;
  if (!draft) return null;
  const hasAction = Boolean(draft.file || draft.roiDirty);
  const uploading = draft.status === 'uploading';
  const action = draft.file
    ? draft.status === 'error'
      ? 'Повторить загрузку'
      : 'Загрузить оригинал'
    : 'Сохранить ROI';

  return (
    <article
      className={
        'panel capture-slot-card slot-' + draft.status + (props.disabled ? ' is-locked' : '')
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

      <div className="capture-slot-timing">
        <span>{timing(slot, props.elapsed)}</span>
        {slot.targetSeconds === null ? (
          <small>Точное целевое время не задано — показываем только прошедшее.</small>
        ) : null}
      </div>

      <RoiEditor
        src={draft.previewUrl}
        alt={slot.label}
        value={draft.roi}
        onChange={props.disabled ? () => undefined : props.onRoi}
        allowPolygon={false}
        compact
        placeholder={
          draft.status === 'saved'
            ? 'Оригинал сохранён; предпросмотр недоступен'
            : 'Снимите или выберите фото'
        }
      />
      <p className="roi-guidance">
        Внутри рамки должен быть только чистый наполнитель — без бортика, плитки и фона.
      </p>

      <label className={'file-button capture-file-button ' + (props.disabled ? 'is-disabled' : '')}>
        {draft.previewUrl ? 'Снять / выбрать замену' : 'Снять / выбрать фото'}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          disabled={props.disabled}
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

      {uploading && draft.progress !== null ? (
        <div className="capture-upload-progress">
          <progress max={100} value={draft.progress} aria-label={'Загрузка ' + slot.label} />
          <span>
            {draft.progress < 100
              ? 'Передано ' + draft.progress + '%'
              : 'Оригинал передан, сервер сохраняет…'}
          </span>
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
          disabled={props.disabled || uploading}
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
