/**
 * Desktop-админка новой capture-серии.
 * Counters и exports намеренно не смешиваются с legacy manifest.
 */

import { useEffect, useState } from 'react';

type AdminImage = {
  slotKey: string;
  kind: string;
  fileName: string;
  contentType: string;
  bytes: number;
  sha256: string;
  uri: string;
  publicUrl: string | null;
  savedAt: string;
  roi: unknown;
  cameraMetadata?: unknown;
};

type AdminCaseListItem = {
  id: string;
  attemptId: string;
  createdAt: string;
  attemptStatus: 'active' | 'finalized' | 'abandoned' | 'superseded';
  included: boolean;
  exclusionReason: string | null;
  policySnapshot: {
    policyId: string;
    version: string;
    seriesId: string;
    status: 'draft' | 'active';
  } | null;
  pairId: string | null;
  displayLabel: string | null;
  taskCode: string;
  taskType: 'reacted_specimen' | 'blank_qc';
  specimenId: string;
  sourcePh: number;
  referencePh: number | null;
  finalMixturePh: number | null;
  operatorId: string;
  device: string;
  deviceRole: string | null;
  specimenMode: 'independent' | 'shared' | null;
  series: string;
  condition: {
    lightLabel: string;
    angleLabel: string;
    distanceLabel: string;
  };
  reactionStartedAt: string | null;
  diagnosticSavedAt: string | null;
  reactionElapsedSec: number | null;
  replacesAttemptId: string | null;
  replacedByAttemptId: string | null;
  images: AdminImage[];
};

type AdminSummary = {
  policy: { policyId: string; version: string; seriesId: string; status: 'draft' | 'active' };
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
    cells: Array<{
      sourcePh: number;
      deviceRole: string;
      specimenMode: 'independent' | 'shared';
      target: number;
      actual: number;
      reserved: number;
      missing: number;
    }>;
  };
};

type AdminAttemptHistoryItem = {
  id: string;
  pairId: string | null;
  displayLabel: string | null;
  status: AdminCaseListItem['attemptStatus'];
  createdAt: string;
  updatedAt: string;
  sourcePh: number;
  referencePh: number | null;
  deviceRole: string | null;
  specimenMode: AdminCaseListItem['specimenMode'];
  included: boolean | null;
  exclusionReason: string | null;
  replacesAttemptId: string | null;
  replacedByAttemptId: string | null;
  policyVersion: string | null;
};

type AdminCasesResponse = {
  source: string;
  summary: AdminSummary;
  page: { limit: number; offset: number; nextOffset: number };
  attemptHistory: AdminAttemptHistoryItem[];
  items: AdminCaseListItem[];
};

function taskTypeText(value: AdminCaseListItem['taskType']): string {
  return value === 'blank_qc' ? 'Blank QC' : 'После реакции';
}

function conditionText(item: AdminCaseListItem): string {
  return [item.condition.lightLabel, item.condition.angleLabel, item.condition.distanceLabel]
    .filter(Boolean)
    .join(' / ');
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' Б';
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' КБ';
  return (bytes / (1024 * 1024)).toFixed(1) + ' МБ';
}

function formatPh(value: number | null): string {
  return value === null ? '—' : String(value);
}

function attemptStatusText(status: AdminAttemptHistoryItem['status']): string {
  if (status === 'active') return 'active / reserved';
  if (status === 'finalized') return 'finalized';
  if (status === 'abandoned') return 'abandoned';
  return 'superseded';
}

export function AdminPage() {
  const [items, setItems] = useState<AdminCaseListItem[]>([]);
  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [attemptHistory, setAttemptHistory] = useState<AdminAttemptHistoryItem[]>([]);
  const [source, setSource] = useState('unknown');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);

        const response = await fetch('/api/admin/cases?limit=100&offset=0');
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error('Ошибка API (' + response.status + '): ' + JSON.stringify(body));
        }

        const data = (await response.json()) as AdminCasesResponse;
        if (!cancelled) {
          setItems(data.items ?? []);
          setSummary(data.summary ?? null);
          setAttemptHistory(data.attemptHistory ?? []);
          setSource(data.source ?? 'unknown');
        }
      } catch (reason) {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="admin-shell">
      <div className="capture-header">
        <div>
          <h1>Админка съёмки</h1>
          <p className="muted">
            Новая серия: <span className="mono">{source}</span>. Legacy-архив не входит в counters и
            exports.
          </p>
          {summary ? (
            <p className="muted">
              Policy <span className="mono">{summary.policy.policyId}</span> · версия{' '}
              <span className="mono">{summary.policy.version}</span> · статус{' '}
              <strong>{summary.policy.status}</strong>
            </p>
          ) : null}
        </div>
        <div className="admin-actions">
          <a className="button-link" href="/api/admin/export.csv" target="_blank" rel="noreferrer">
            CSV
          </a>
          <a
            className="button-link"
            href="/api/admin/export.jsonl"
            target="_blank"
            rel="noreferrer"
          >
            JSONL
          </a>
          <a
            className="button-link"
            href="/api/admin/export.attempts.jsonl"
            target="_blank"
            rel="noreferrer"
          >
            Attempts JSONL
          </a>
        </div>
      </div>

      <div className="counter-row">
        <Counter label="Valid quota" value={summary?.counts.finalizedIncluded ?? 0} />
        <Counter label="Active" value={summary?.counts.active ?? 0} />
        <Counter label="Reserved" value={summary?.counts.reserved ?? 0} />
        <Counter label="Excluded" value={summary?.counts.excluded ?? 0} />
        <Counter label="Abandoned" value={summary?.counts.abandoned ?? 0} />
        <Counter label="Superseded" value={summary?.counts.superseded ?? 0} />
        <Counter label="Reshoots" value={summary?.counts.reshoots ?? 0} />
      </div>

      {loading ? (
        <p className="muted">Загрузка...</p>
      ) : (
        <p className="muted">
          Всего attempts: {summary?.counts.attempts ?? 0}; кейсов: {summary?.counts.cases ?? 0}; на
          странице: {items.length}
        </p>
      )}
      {error ? <pre className="error-box">{error}</pre> : null}

      <section className="panel admin-summary-panel">
        <h2>Quota matrix</h2>
        <p className="muted">
          Actual {summary?.quota.actual ?? 0} / target {summary?.quota.target ?? 0}; missing{' '}
          {summary?.quota.missing ?? 0}
        </p>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>source pH</th>
                <th>device role</th>
                <th>specimen mode</th>
                <th>actual</th>
                <th>target</th>
                <th>missing</th>
                <th>reserved</th>
              </tr>
            </thead>
            <tbody>
              {summary?.quota.cells.map((cell) => (
                <tr key={`${cell.sourcePh}:${cell.deviceRole}:${cell.specimenMode}`}>
                  <td>{formatPh(cell.sourcePh)}</td>
                  <td>{cell.deviceRole}</td>
                  <td>{cell.specimenMode}</td>
                  <td>{cell.actual}</td>
                  <td>{cell.target}</td>
                  <td>{cell.missing}</td>
                  <td>{cell.reserved}</td>
                </tr>
              ))}
              {summary && summary.quota.cells.length === 0 ? (
                <tr>
                  <td colSpan={7}>Quota не утверждена: policy закрыта</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel admin-summary-panel">
        <h2>Attempt history</h2>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>обновлено</th>
                <th>статус</th>
                <th>pair</th>
                <th>source / reference pH</th>
                <th>role / mode</th>
                <th>replacement links</th>
                <th>результат</th>
              </tr>
            </thead>
            <tbody>
              {attemptHistory.map((attempt) => (
                <tr key={attempt.id}>
                  <td>{new Date(attempt.updatedAt).toLocaleString('ru-RU')}</td>
                  <td>{attemptStatusText(attempt.status)}</td>
                  <td className="mono compact-cell" title={attempt.id}>
                    {attempt.displayLabel ?? attempt.pairId ?? attempt.id}
                  </td>
                  <td>
                    {formatPh(attempt.sourcePh)} / {formatPh(attempt.referencePh)}
                  </td>
                  <td>
                    {attempt.deviceRole ?? '—'} / {attempt.specimenMode ?? '—'}
                  </td>
                  <td className="mono compact-cell">
                    {attempt.replacesAttemptId ? `← ${attempt.replacesAttemptId}` : ''}
                    {attempt.replacedByAttemptId ? ` → ${attempt.replacedByAttemptId}` : ''}
                    {!attempt.replacesAttemptId && !attempt.replacedByAttemptId ? '—' : null}
                  </td>
                  <td>
                    {attempt.included === null
                      ? '—'
                      : attempt.included
                        ? 'included'
                        : `excluded: ${attempt.exclusionReason ?? 'без причины'}`}
                  </td>
                </tr>
              ))}
              {!loading && attemptHistory.length === 0 ? (
                <tr>
                  <td colSpan={7}>Attempt history пока пуста</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              {[
                'создано',
                'серия',
                'статус',
                'task code',
                'тип',
                'source pH',
                'final pH',
                'specimen',
                'устройство',
                'оператор',
                'условия',
                'причина исключения',
                'фото',
              ].map((header) => (
                <th key={header}>{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{new Date(item.createdAt).toLocaleString('ru-RU')}</td>
                <td>{item.series}</td>
                <td>{item.included ? 'включён' : 'исключён'}</td>
                <td className="mono">{item.taskCode}</td>
                <td>{taskTypeText(item.taskType)}</td>
                <td>{formatPh(item.sourcePh)}</td>
                <td>{formatPh(item.finalMixturePh)}</td>
                <td className="mono compact-cell" title={item.specimenId}>
                  {item.specimenId}
                </td>
                <td>{item.device}</td>
                <td>{item.operatorId}</td>
                <td>{conditionText(item)}</td>
                <td>{item.exclusionReason ?? '—'}</td>
                <td className="compact-cell">
                  {item.images.map((image) => (
                    <div key={image.slotKey + image.uri}>
                      {image.publicUrl ? (
                        <a
                          href={image.publicUrl}
                          target="_blank"
                          rel="noreferrer"
                          title={'SHA-256: ' + image.sha256}
                        >
                          {image.slotKey} · {formatBytes(image.bytes)}
                        </a>
                      ) : (
                        <span title={image.uri}>
                          {image.slotKey} · {formatBytes(image.bytes)}
                        </span>
                      )}
                    </div>
                  ))}
                </td>
              </tr>
            ))}
            {!loading && items.length === 0 ? (
              <tr>
                <td colSpan={13}>Новая серия пока пуста</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Counter({ label, value }: { label: string; value: number }) {
  return (
    <div className="counter">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
