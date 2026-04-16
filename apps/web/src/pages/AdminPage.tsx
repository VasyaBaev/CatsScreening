/**
 * Внутренняя админка (заглушка).
 *
 * Цели MVP (из документов):
 * - список кейсов,
 * - фильтры/поиск,
 * - выгрузка CSV,
 * - просмотр фото и метаданных.
 */

import { useEffect, useMemo, useState } from 'react';

type AdminCaseListItem = {
  id: string;
  createdAt: string;
  score: number | null;
  confidence: number | null;
  metadata: any;
  qc: any;
  images: Array<{ kind: string; uri: string }>;
};

type AdminCasesResponse = {
  page: { limit: number; offset: number; nextOffset: number };
  items: AdminCaseListItem[];
};

export function AdminPage() {
  const [items, setItems] = useState<AdminCaseListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const exportUrl = '/api/admin/export.csv';

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);

        const response = await fetch('/api/admin/cases?limit=50&offset=0');
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(`Ошибка API (${response.status}): ${JSON.stringify(body)}`);
        }

        const data = (await response.json()) as AdminCasesResponse;
        if (!cancelled) setItems(data.items ?? []);
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

  const rows = useMemo(() => {
    return items.map((item) => {
      const tray = item.metadata?.tray ?? '';
      const light = item.metadata?.light ?? '';
      const location = item.metadata?.location ?? '';
      const pH = item.metadata?.pH ?? '';
      const cls = item.metadata?.class ?? '';

      const qcBlur = item.qc?.blur ?? '';
      const qcGlare = item.qc?.glare ?? '';
      const qcDark = item.qc?.dark ?? '';

      const ref = item.images.find((i) => i.kind === 'reference')?.uri ?? '';
      const diag = item.images.find((i) => i.kind === 'diagnostic')?.uri ?? '';

      return {
        ...item,
        tray,
        light,
        location,
        pH,
        cls,
        qcBlur,
        qcGlare,
        qcDark,
        ref,
        diag
      };
    });
  }, [items]);

  return (
    <section>
      <h1>Админка</h1>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <a href={exportUrl} target="_blank" rel="noreferrer">
          Экспорт CSV
        </a>
        {loading ? <span>Загрузка…</span> : <span>Кейсов: {rows.length}</span>}
      </div>

      {error ? (
        <pre style={{ whiteSpace: 'pre-wrap', padding: 12, background: '#fff3f3', border: '1px solid #ffd0d0' }}>
          {error}
        </pre>
      ) : null}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', minWidth: 900 }}>
          <thead>
            <tr>
              {[
                'createdAt',
                'id',
                'score',
                'confidence',
                'tray',
                'light',
                'location',
                'pH',
                'class',
                'qc.blur',
                'qc.glare',
                'qc.dark',
                'reference.uri',
                'diagnostic.uri'
              ].map((h) => (
                <th key={h} style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={{ padding: 8, borderBottom: '1px solid #eee', whiteSpace: 'nowrap' }}>
                  {new Date(r.createdAt).toLocaleString('ru-RU')}
                </td>
                <td style={{ padding: 8, borderBottom: '1px solid #eee', fontFamily: 'monospace' }}>{r.id}</td>
                <td style={{ padding: 8, borderBottom: '1px solid #eee' }}>{r.score ?? ''}</td>
                <td style={{ padding: 8, borderBottom: '1px solid #eee' }}>{r.confidence ?? ''}</td>
                <td style={{ padding: 8, borderBottom: '1px solid #eee' }}>{r.tray}</td>
                <td style={{ padding: 8, borderBottom: '1px solid #eee' }}>{r.light}</td>
                <td style={{ padding: 8, borderBottom: '1px solid #eee' }}>{r.location}</td>
                <td style={{ padding: 8, borderBottom: '1px solid #eee' }}>{r.pH}</td>
                <td style={{ padding: 8, borderBottom: '1px solid #eee' }}>{r.cls}</td>
                <td style={{ padding: 8, borderBottom: '1px solid #eee' }}>{String(r.qcBlur)}</td>
                <td style={{ padding: 8, borderBottom: '1px solid #eee' }}>{String(r.qcGlare)}</td>
                <td style={{ padding: 8, borderBottom: '1px solid #eee' }}>{String(r.qcDark)}</td>
                <td style={{ padding: 8, borderBottom: '1px solid #eee', maxWidth: 220 }}>
                  <span title={r.ref} style={{ display: 'inline-block', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {r.ref}
                  </span>
                </td>
                <td style={{ padding: 8, borderBottom: '1px solid #eee', maxWidth: 220 }}>
                  <span title={r.diag} style={{ display: 'inline-block', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {r.diag}
                  </span>
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 ? (
              <tr>
                <td colSpan={14} style={{ padding: 12 }}>
                  Нет данных. Создай кейс через пользовательский флоу или `POST /api/cases`.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
