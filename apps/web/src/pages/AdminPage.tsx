/**
 * Внутренняя админка capture dataset.
 *
 * Экран показывает последние кейсы, быстрые счётчики по pH-band и ссылки на CSV/JSONL export.
 * Данные приходят из Postgres или локального JSONL fallback, в зависимости от конфигурации API.
 */

import { useEffect, useMemo, useState } from 'react';

type AdminCaseListItem = {
  id: string;
  createdAt: string;
  score: number | null;
  confidence: number | null;
  metadata: any;
  qc: any;
  images: Array<{ kind: string; uri: string; publicUrl?: string | null }>;
};

type AdminCasesResponse = {
  source: string;
  page: { limit: number; offset: number; nextOffset: number };
  items: AdminCaseListItem[];
};

type AdminRow = AdminCaseListItem & {
  series: string;
  pairId: string;
  diagnosticPh: string;
  diagnosticBand: string;
  device: string;
  condition: string;
  referenceUri: string;
  diagnosticUri: string;
  referenceUrl: string | null;
  diagnosticUrl: string | null;
};

function bandText(value: string): string {
  if (value === 'low') return 'Ниже нормы';
  if (value === 'normal') return 'Норма';
  if (value === 'high') return 'Выше нормы';
  return value;
}

function lightText(value: string | undefined): string {
  if (value === 'daylight') return 'дневной свет';
  if (value === 'warm_indoor') return 'тёплый комнатный';
  if (value === 'cool_indoor') return 'холодный комнатный';
  if (value === 'mixed_indoor') return 'смешанный';
  return value ?? '';
}

function angleText(value: string | undefined): string {
  if (value === 'straight') return 'ровно сверху';
  if (value === 'slight_left') return 'наклон слева';
  if (value === 'slight_right') return 'наклон справа';
  if (value === 'slight_top') return 'наклон сверху';
  return value ?? '';
}

function distanceText(value: string | undefined): string {
  if (value === 'normal') return 'обычная дистанция';
  if (value === 'slightly_near') return 'чуть ближе';
  if (value === 'slightly_far') return 'чуть дальше';
  return value ?? '';
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
          throw new Error(`Ошибка API (${response.status}): ${JSON.stringify(body)}`);
        }

        const data = (await response.json()) as AdminCasesResponse;
        if (!cancelled) {
          setItems(data.items ?? []);
          setSource(data.source ?? 'unknown');
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (!cancelled) setError(message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  const rows = useMemo<AdminRow[]>(() => {
    return items.map((item) => {
      const metadata = item.metadata ?? {};
      const ref = item.images.find((i) => i.kind === 'reference');
      const diag = item.images.find((i) => i.kind === 'diagnostic');
      const condition = [
        lightText(metadata.condition?.lightLabel),
        angleText(metadata.condition?.angleLabel),
        distanceText(metadata.condition?.distanceLabel),
      ]
        .filter(Boolean)
        .join(' / ');

      return {
        ...item,
        series: metadata.series ?? '',
        pairId: metadata.pairId ?? '',
        diagnosticPh: String(metadata.diagnosticPh ?? metadata.pH ?? ''),
        diagnosticBand: bandText(metadata.diagnosticBand ?? ''),
        device: metadata.device ?? '',
        condition,
        referenceUri: ref?.uri ?? '',
        diagnosticUri: diag?.uri ?? '',
        referenceUrl: ref?.publicUrl ?? null,
        diagnosticUrl: diag?.publicUrl ?? null,
      };
    });
  }, [items]);

  const counters = useMemo(() => {
    const result = { low: 0, normal: 0, high: 0, unknown: 0 };
    for (const row of rows) {
      if (row.diagnosticBand === 'low') result.low += 1;
      else if (row.diagnosticBand === 'normal') result.normal += 1;
      else if (row.diagnosticBand === 'high') result.high += 1;
      else result.unknown += 1;
    }
    return result;
  }, [rows]);

  return (
    <section className="admin-shell">
      <div className="capture-header">
        <div>
          <h1>Админка съёмки</h1>
          <p className="muted">
            Источник данных: <span className="mono">{source}</span>
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
        <Counter label="Ниже нормы" value={counters.low} />
        <Counter label="Норма" value={counters.normal} />
        <Counter label="Выше нормы" value={counters.high} />
        <Counter label="Неизвестно" value={counters.unknown} />
      </div>

      {loading ? (
        <p className="muted">Загрузка...</p>
      ) : (
        <p className="muted">Кейсов: {rows.length}</p>
      )}
      {error ? <pre className="error-box">{error}</pre> : null}

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              {[
                'создано',
                'серия',
                'ID пары',
                'pH',
                'диапазон',
                'устройство',
                'условия',
                'чистый снимок',
                'снимок после реакции',
              ].map((header) => (
                <th key={header}>{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{new Date(row.createdAt).toLocaleString('ru-RU')}</td>
                <td>{row.series}</td>
                <td className="mono compact-cell" title={row.pairId}>
                  {row.pairId}
                </td>
                <td>{row.diagnosticPh}</td>
                <td>{row.diagnosticBand}</td>
                <td>{row.device}</td>
                <td>{row.condition}</td>
                <td className="compact-cell">
                  {row.referenceUrl ? (
                    <a href={row.referenceUrl} target="_blank" rel="noreferrer">
                      открыть
                    </a>
                  ) : (
                    <span title={row.referenceUri}>{row.referenceUri}</span>
                  )}
                </td>
                <td className="compact-cell">
                  {row.diagnosticUrl ? (
                    <a href={row.diagnosticUrl} target="_blank" rel="noreferrer">
                      открыть
                    </a>
                  ) : (
                    <span title={row.diagnosticUri}>{row.diagnosticUri}</span>
                  )}
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 ? (
              <tr>
                <td colSpan={9}>Данных пока нет</td>
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
