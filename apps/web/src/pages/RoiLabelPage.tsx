/**
 * Страница ручной ROI-разметки лабораторного V5-V8 и новой съемочной серии V9.
 *
 * Что делает:
 * - показывает лабораторные пары из Playground и новые V9-пары из публичной съемки;
 * - дает оператору вручную уточнить область наполнителя на reference и diagnostic;
 * - сохраняет результат в отдельный JSON через API, не изменяя исходные фото.
 */

import {
  type CaseRoiSet,
  type RoiLabelDataset,
  type RoiLabelStatus,
  type SaveRoiLabelRequest,
} from '@cats-screening/shared';
import { type FormEvent, useEffect, useMemo, useState } from 'react';

import { FieldCaption } from '../components/InfoHint';
import { RoiEditor } from '../components/RoiEditor';
import {
  checkRoiAuth,
  exportRoiLabels,
  fetchRoiLabels,
  fetchV9RoiCases,
  saveRoiLabel,
  type RoiAuthCredentials,
} from '../lib/api';
import { rectToRoiShape, roiForStrategy, type RoiRect, type RoiShape } from '../lib/roi';

type Zone = 'low' | 'normal' | 'high';
type LabelFilter = 'all' | 'unmarked' | RoiLabelStatus;

type PlaygroundFeature = {
  roiStrategy: string;
  referenceRoi?: RoiRect;
  diagnosticRoi?: RoiRect;
};

type PlaygroundPair = {
  id: string;
  caseId?: string;
  labelDataset?: string;
  kind: string;
  device: string;
  lightCct: string;
  pH: number;
  zone: Zone;
  sourceVersion: string;
  captureDeltaSec: number | null;
  warnings: string[];
  referenceUrl: string;
  diagnosticUrl: string;
  features: Record<string, PlaygroundFeature>;
  initialRois?: CaseRoiSet;
  createdAt?: string;
  operatorId?: string | null;
};

type PlaygroundPack = {
  defaultFeatureKey: string;
  pairs: PlaygroundPair[];
};

type V9RoiCasePack = {
  version: number;
  dataset: 'v9';
  generatedAt: string;
  pairs: PlaygroundPair[];
};

type EditableRoiLabel = SaveRoiLabelRequest & {
  updatedAt?: string;
};

const packUrl = '/playground/v5-v8/playground.json';
const AUTH_STORAGE_KEY = 'cats.roiLabel.auth';

const statusOptions: Array<{ value: RoiLabelStatus; label: string }> = [
  { value: 'draft', label: 'Черновик' },
  { value: 'reviewed', label: 'Проверено' },
  { value: 'needs_fix', label: 'Исправить' },
  { value: 'unusable', label: 'Непригодно' },
];

function zoneLabel(zone: Zone): string {
  if (zone === 'low') return 'Ниже нормы';
  if (zone === 'high') return 'Выше нормы';
  return 'Норма';
}

function statusLabel(status: LabelFilter): string {
  if (status === 'all') return 'Все';
  if (status === 'unmarked') return 'Без разметки';
  return statusOptions.find((item) => item.value === status)?.label ?? status;
}

function pairStatusLabel(pair: PlaygroundPair, labels: RoiLabelDataset): string {
  const label = labels.labels[pair.id];
  if (label) return statusLabel(label.status);
  if (pair.sourceVersion === 'V9') return 'Не проверено';
  return statusLabel('unmarked');
}

function kindLabel(kind: string): string {
  if (kind === 'base') return 'Обычная';
  if (kind === 'angle6500') return 'Угол 6500K';
  return kind;
}

function emptyLabels(): RoiLabelDataset {
  return {
    version: 1,
    dataset: 'v5-v8',
    updatedAt: null,
    labels: {},
  };
}

function defaultRois(pair: PlaygroundPair, featureKey: string): CaseRoiSet {
  const feature = pair.features[featureKey] ?? Object.values(pair.features)[0];
  const strategy = feature?.roiStrategy ?? 'fixed-wide';

  return {
    reference:
      pair.initialRois?.reference ??
      rectToRoiShape(feature?.referenceRoi ?? roiForStrategy(strategy)),
    diagnostic:
      pair.initialRois?.diagnostic ??
      rectToRoiShape(feature?.diagnosticRoi ?? roiForStrategy(strategy)),
  };
}

function buildDraft(
  pair: PlaygroundPair,
  labels: RoiLabelDataset,
  featureKey: string,
): EditableRoiLabel {
  const existing = labels.labels[pair.id];
  if (existing) {
    return {
      pairId: existing.pairId,
      dataset: existing.dataset,
      sourceVersion: existing.sourceVersion,
      status: existing.status,
      rois: existing.rois,
      note: existing.note,
      updatedBy: existing.updatedBy,
      updatedAt: existing.updatedAt,
    };
  }

  return {
    pairId: pair.id,
    dataset: pair.labelDataset ?? labels.dataset ?? 'v5-v8',
    sourceVersion: pair.sourceVersion,
    status: 'draft',
    rois: defaultRois(pair, featureKey),
    note: null,
    updatedBy: null,
  };
}

function roiCount(labels: RoiLabelDataset): number {
  return Object.keys(labels.labels).length;
}

function readStoredAuth(): RoiAuthCredentials | null {
  try {
    const raw = window.sessionStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RoiAuthCredentials>;
    if (!parsed.username || !parsed.password) return null;
    return {
      username: parsed.username,
      password: parsed.password,
    };
  } catch {
    return null;
  }
}

function writeStoredAuth(auth: RoiAuthCredentials | null) {
  try {
    if (auth) window.sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(auth));
    else window.sessionStorage.removeItem(AUTH_STORAGE_KEY);
  } catch {
    // Если sessionStorage недоступен, авторизация все равно работает до перезагрузки страницы.
  }
}

export function RoiLabelPage() {
  const [auth, setAuth] = useState<RoiAuthCredentials | null>(() => readStoredAuth());
  const [loginForm, setLoginForm] = useState<RoiAuthCredentials>(() => ({
    username: readStoredAuth()?.username ?? 'admin',
    password: '',
  }));
  const [pack, setPack] = useState<PlaygroundPack | null>(null);
  const [v9Pack, setV9Pack] = useState<V9RoiCasePack | null>(null);
  const [labels, setLabels] = useState<RoiLabelDataset>(() => emptyLabels());
  const [drafts, setDrafts] = useState<Record<string, EditableRoiLabel>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoneFilter, setZoneFilter] = useState<'all' | Zone>('all');
  const [versionFilter, setVersionFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<LabelFilter>('all');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!auth) return undefined;

    const currentAuth = auth;
    let cancelled = false;

    async function load() {
      try {
        setError(null);
        const [packResponse, loadedLabels, loadedV9Pack] = await Promise.all([
          fetch(packUrl),
          fetchRoiLabels(currentAuth),
          fetchV9RoiCases<V9RoiCasePack>(currentAuth),
        ]);
        if (!packResponse.ok) throw new Error(`Playground JSON HTTP ${packResponse.status}`);
        const loadedPack = (await packResponse.json()) as PlaygroundPack;
        if (cancelled) return;

        setPack(loadedPack);
        setV9Pack(loadedV9Pack);
        setLabels(loadedLabels);
        setSelectedId(loadedV9Pack.pairs[0]?.id ?? loadedPack.pairs[0]?.id ?? null);
      } catch (loadError) {
        if (cancelled) return;

        const message = loadError instanceof Error ? loadError.message : String(loadError);
        if (message.includes('401')) {
          writeStoredAuth(null);
          setAuth(null);
          setLoginForm((current) => ({ ...current, password: '' }));
          setError('Неверный логин или пароль для разметки ROI.');
          return;
        }

        setError(message);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [auth]);

  const allPairs = useMemo(() => {
    return [...(v9Pack?.pairs ?? []), ...(pack?.pairs ?? [])];
  }, [pack, v9Pack]);

  const versions = useMemo(() => {
    return Array.from(new Set(allPairs.map((pair) => pair.sourceVersion))).sort();
  }, [allPairs]);

  const filteredPairs = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return allPairs.filter((pair) => {
      const existing = labels.labels[pair.id];
      if (zoneFilter !== 'all' && pair.zone !== zoneFilter) return false;
      if (versionFilter !== 'all' && pair.sourceVersion !== versionFilter) return false;
      if (statusFilter === 'unmarked' && existing) return false;
      if (
        statusFilter !== 'all' &&
        statusFilter !== 'unmarked' &&
        existing?.status !== statusFilter
      )
        return false;
      if (!needle) return true;

      const haystack =
        `${pair.id} ${pair.pH} ${pair.device} ${pair.lightCct} ${pair.sourceVersion}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [allPairs, labels.labels, query, statusFilter, versionFilter, zoneFilter]);

  const pairById = useMemo(() => new Map(allPairs.map((pair) => [pair.id, pair])), [allPairs]);
  const selectedPair = selectedId ? (pairById.get(selectedId) ?? null) : null;
  const activeDraft = useMemo(() => {
    if (!selectedPair || !pack) return null;
    return drafts[selectedPair.id] ?? buildDraft(selectedPair, labels, pack.defaultFeatureKey);
  }, [drafts, labels, pack, selectedPair]);

  function updateDraft(
    pair: PlaygroundPair,
    updater: (draft: EditableRoiLabel) => EditableRoiLabel,
  ) {
    if (!pack) return;
    setDrafts((current) => {
      const base = current[pair.id] ?? buildDraft(pair, labels, pack.defaultFeatureKey);
      return {
        ...current,
        [pair.id]: updater(base),
      };
    });
  }

  function updateRoi(role: keyof CaseRoiSet, roi: RoiShape) {
    if (!selectedPair) return;
    updateDraft(selectedPair, (draft) => ({
      ...draft,
      rois: {
        ...draft.rois,
        [role]: roi,
      },
    }));
  }

  function copyRoi(from: keyof CaseRoiSet, to: keyof CaseRoiSet) {
    if (!selectedPair || !activeDraft) return;
    const source = activeDraft.rois[from];
    if (!source) return;
    updateDraft(selectedPair, (draft) => ({
      ...draft,
      rois: {
        ...draft.rois,
        [to]: source,
      },
    }));
  }

  function setStatus(status: RoiLabelStatus) {
    if (!selectedPair) return;
    updateDraft(selectedPair, (draft) => ({ ...draft, status }));
  }

  function setNote(note: string) {
    if (!selectedPair) return;
    updateDraft(selectedPair, (draft) => ({ ...draft, note: note.trim() ? note : null }));
  }

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextAuth = {
      username: loginForm.username.trim() || 'admin',
      password: loginForm.password,
    };

    try {
      setBusy(true);
      setError(null);
      setMessage(null);
      await checkRoiAuth(nextAuth);
      writeStoredAuth(nextAuth);
      setAuth(nextAuth);
      setMessage('Вход выполнен.');
    } catch (loginError) {
      writeStoredAuth(null);
      setAuth(null);
      setError(loginError instanceof Error ? loginError.message : String(loginError));
    } finally {
      setBusy(false);
    }
  }

  function logout() {
    writeStoredAuth(null);
    setAuth(null);
    setPack(null);
    setV9Pack(null);
    setLabels(emptyLabels());
    setDrafts({});
    setSelectedId(null);
    setLoginForm((current) => ({ username: current.username || 'admin', password: '' }));
    setMessage(null);
  }

  async function saveCurrent() {
    if (!selectedPair || !activeDraft || !auth) return;

    try {
      setBusy(true);
      setError(null);
      setMessage(null);
      const saved = await saveRoiLabel(activeDraft, auth);

      setLabels((current) => ({
        ...current,
        updatedAt: saved.updatedAt,
        labels: {
          ...current.labels,
          [saved.pairId]: saved,
        },
      }));
      setDrafts((current) => ({
        ...current,
        [saved.pairId]: saved,
      }));
      setMessage(`Сохранено: ${saved.pairId}`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setBusy(false);
    }
  }

  async function downloadLabels() {
    if (!auth) return;

    try {
      setBusy(true);
      setError(null);
      const blob = await exportRoiLabels(auth);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'roi-labels-v5-v8.json';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : String(downloadError));
    } finally {
      setBusy(false);
    }
  }

  function selectNext() {
    if (!selectedPair || filteredPairs.length === 0) return;
    const index = filteredPairs.findIndex((pair) => pair.id === selectedPair.id);
    const next = filteredPairs[(index + 1) % filteredPairs.length];
    if (next) setSelectedId(next.id);
  }

  return (
    <section className="roi-label-shell">
      <div className="capture-header">
        <div>
          <h1>Разметка ROI</h1>
          <p>
            V9 отображается сверху как очередь непроверенных съемок. V5-V8 остаются ниже как
            лабораторная база; сохраненные labels используются для пересчета признаков модели.
          </p>
        </div>
        <span className="band-pill band-normal">
          {pack || v9Pack ? `${roiCount(labels)} / ${allPairs.length}` : 'Загрузка'}
        </span>
      </div>

      {error ? <pre className="error-box">{error}</pre> : null}
      {message ? <p className="success">{message}</p> : null}

      {!auth ? (
        <form className="panel roi-login-panel" onSubmit={(event) => void submitLogin(event)}>
          <h2>Вход для разметки</h2>
          <p className="muted">
            Разметка ROI и API сохранения закрыты логином и паролем. Съёмка и песочница остаются
            публичными.
          </p>
          <div className="form-grid">
            <label>
              <FieldCaption hint="Логин оператора разметки. По умолчанию используется admin.">
                Логин
              </FieldCaption>
              <input
                autoComplete="username"
                value={loginForm.username}
                onChange={(event) =>
                  setLoginForm((current) => ({ ...current, username: event.target.value }))
                }
              />
            </label>
            <label>
              <FieldCaption hint="Пароль для доступа к ручной ROI-разметке.">Пароль</FieldCaption>
              <input
                autoComplete="current-password"
                type="password"
                value={loginForm.password}
                onChange={(event) =>
                  setLoginForm((current) => ({ ...current, password: event.target.value }))
                }
              />
            </label>
          </div>
          <div className="capture-actions">
            <button type="submit" className="primary" disabled={busy || !loginForm.password}>
              {busy ? 'Проверяю...' : 'Войти'}
            </button>
          </div>
        </form>
      ) : (
        <section className="roi-label-layout">
          <aside className="panel roi-label-sidebar">
            <h2>Пары</h2>
            <div className="auth-status-row">
              <span className="muted">Вход: {auth.username}</span>
              <button type="button" className="secondary" onClick={logout}>
                Выйти
              </button>
            </div>

            <label>
              <FieldCaption hint="Поиск по ID пары, pH, устройству, свету или версии датасета.">
                Поиск
              </FieldCaption>
              <input value={query} onChange={(event) => setQuery(event.target.value)} />
            </label>

            <div className="form-grid compact">
              <label>
                <FieldCaption hint="Фильтр по pH-зоне: ниже нормы, норма или выше нормы.">
                  Диапазон
                </FieldCaption>
                <select
                  value={zoneFilter}
                  onChange={(event) => setZoneFilter(event.target.value as 'all' | Zone)}
                >
                  <option value="all">Все</option>
                  <option value="low">Ниже нормы</option>
                  <option value="normal">Норма</option>
                  <option value="high">Выше нормы</option>
                </select>
              </label>

              <label>
                <FieldCaption hint="Фильтр по исходной серии: V9 для новой съемки или V5-V8 для лабораторной базы.">
                  Версия
                </FieldCaption>
                <select
                  value={versionFilter}
                  onChange={(event) => setVersionFilter(event.target.value)}
                >
                  <option value="all">Все</option>
                  {versions.map((version) => (
                    <option key={version} value={version}>
                      {version}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label>
              <FieldCaption hint="Статус ручной проверки ROI. `Без разметки` показывает пары, которые еще ни разу не сохранялись; для V9 такие пары отображаются как `Не проверено`.">
                Статус
              </FieldCaption>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as LabelFilter)}
              >
                <option value="all">Все</option>
                <option value="unmarked">Без разметки</option>
                {statusOptions.map((status) => (
                  <option key={status.value} value={status.value}>
                    {status.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="roi-pair-list">
              {filteredPairs.map((pair) => {
                const isActive = selectedId === pair.id;

                return (
                  <button
                    key={pair.id}
                    className={isActive ? 'active' : ''}
                    type="button"
                    onClick={() => setSelectedId(pair.id)}
                  >
                    <strong>pH {pair.pH.toFixed(1)}</strong>
                    <span>{zoneLabel(pair.zone)}</span>
                    <span>{pair.sourceVersion}</span>
                    <span>{pairStatusLabel(pair, labels)}</span>
                  </button>
                );
              })}
            </div>
          </aside>

          <section className="roi-label-main">
            {selectedPair && activeDraft ? (
              <>
                <section className="panel roi-label-current">
                  <div className="pair-card-head">
                    <div>
                      <strong>pH {selectedPair.pH.toFixed(1)}</strong>
                      <span className={`band-pill small band-${selectedPair.zone}`}>
                        {zoneLabel(selectedPair.zone)}
                      </span>
                      <span className="muted">{selectedPair.sourceVersion}</span>
                    </div>
                    <span className="muted mono">{selectedPair.id}</span>
                  </div>

                  <div className="pair-meta">
                    <span>{selectedPair.device}</span>
                    <span>{selectedPair.lightCct}</span>
                    <span>{kindLabel(selectedPair.kind)}</span>
                    <span>
                      {selectedPair.captureDeltaSec === null
                        ? '-'
                        : `${selectedPair.captureDeltaSec} сек.`}
                    </span>
                  </div>

                  {selectedPair.warnings.length > 0 ? (
                    <div className="warning-line">
                      Предупреждения: {selectedPair.warnings.join(', ')}
                    </div>
                  ) : null}

                  {selectedPair.sourceVersion === 'V9' && !labels.labels[selectedPair.id] ? (
                    <div className="warning-line">
                      V9: ROI поставил оператор при съемке, ручная проверка еще не сохранена.
                    </div>
                  ) : null}
                </section>

                <section className="roi-label-editors">
                  <div className="panel">
                    <h2>Чистый наполнитель</h2>
                    <RoiEditor
                      src={selectedPair.referenceUrl}
                      alt={`${selectedPair.id} reference`}
                      value={activeDraft.rois.reference ?? null}
                      onChange={(roi) => updateRoi('reference', roi)}
                    />
                  </div>

                  <div className="panel">
                    <h2>После реакции</h2>
                    <RoiEditor
                      src={selectedPair.diagnosticUrl}
                      alt={`${selectedPair.id} diagnostic`}
                      value={activeDraft.rois.diagnostic ?? null}
                      onChange={(roi) => updateRoi('diagnostic', roi)}
                    />
                  </div>
                </section>

                <section className="panel roi-label-actions">
                  <div className="segmented-row two">
                    <button type="button" onClick={() => copyRoi('reference', 'diagnostic')}>
                      Копировать слева направо
                    </button>
                    <button type="button" onClick={() => copyRoi('diagnostic', 'reference')}>
                      Копировать справа налево
                    </button>
                  </div>

                  <div className="segmented-block">
                    <FieldCaption hint="Статус этой пары после ручной проверки ROI. Для обучения обычно нужны пары со статусом `Проверено`.">
                      Статус пары
                    </FieldCaption>
                    <div className="segmented-row">
                      {statusOptions.map((status) => (
                        <button
                          key={status.value}
                          className={activeDraft.status === status.value ? 'active' : ''}
                          type="button"
                          onClick={() => setStatus(status.value)}
                        >
                          {status.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <label>
                    <FieldCaption hint="Комментарий к разметке: почему пара непригодна, что было исправлено или что проверить позже.">
                      Комментарий
                    </FieldCaption>
                    <textarea
                      value={activeDraft.note ?? ''}
                      rows={3}
                      onChange={(event) => setNote(event.target.value)}
                    />
                  </label>

                  <div className="capture-actions">
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy}
                      onClick={() => void downloadLabels()}
                    >
                      Скачать JSON
                    </button>
                    <button type="button" className="secondary" onClick={selectNext}>
                      Следующая
                    </button>
                    <button
                      type="button"
                      className="primary"
                      disabled={busy}
                      onClick={() => void saveCurrent()}
                    >
                      {busy ? 'Сохраняю...' : 'Сохранить ROI'}
                    </button>
                  </div>
                </section>
              </>
            ) : (
              <section className="panel">
                <h2>Пара не выбрана</h2>
                <p className="muted">Выберите пару в списке слева.</p>
              </section>
            )}
          </section>
        </section>
      )}
    </section>
  );
}
