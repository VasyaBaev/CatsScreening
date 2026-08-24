/**
 * Desktop-админка новой capture-серии.
 * Counters и exports намеренно не смешиваются с legacy manifest.
 */

import { useEffect, useMemo, useState } from 'react';

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
};

type AdminCaseListItem = {
  id: string;
  attemptId: string;
  createdAt: string;
  included: boolean;
  exclusionReason: string | null;
  taskCode: string;
  taskType: 'reacted_specimen' | 'blank_qc';
  specimenId: string;
  sourcePh: number;
  finalMixturePh: number | null;
  operatorId: string;
  device: string;
  series: string;
  condition: {
    lightLabel: string;
    angleLabel: string;
    distanceLabel: string;
  };
  reactionStartedAt: string;
  images: AdminImage[];
};

type AdminCasesResponse = {
  source: string;
  page: { limit: number; offset: number; nextOffset: number };
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

export function AdminPage() {
  const [items, setItems] = useState<AdminCaseListItem[]>([]);
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

  const counters = useMemo(
    () => ({
      total: items.length,
      included: items.filter((item) => item.included).length,
      excluded: items.filter((item) => !item.included).length,
      blank: items.filter((item) => item.taskType === 'blank_qc').length,
    }),
    [items],
  );

  return (
    <section className="admin-shell">
      <div className="capture-header">
        <div>
          <h1>Админка съёмки</h1>
          <p className="muted">
            Новая серия: <span className="mono">{source}</span>. Legacy-архив не входит в counters и
            exports.
          </p>
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
        </div>
      </div>

      <div className="counter-row">
        <Counter label="Всего" value={counters.total} />
        <Counter label="Включено" value={counters.included} />
        <Counter label="Исключено" value={counters.excluded} />
        <Counter label="Blank QC" value={counters.blank} />
      </div>

      {loading ? (
        <p className="muted">Загрузка...</p>
      ) : (
        <p className="muted">Кейсов: {items.length}</p>
      )}
      {error ? <pre className="error-box">{error}</pre> : null}

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
