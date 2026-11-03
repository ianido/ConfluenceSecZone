import { useEffect, useMemo, useState } from 'react';
import type { Classification, MySections } from '@secure-sections/shared';
import { CLASSIFICATIONS } from '@secure-sections/shared';
import { safeCall, unwrap, type Api } from './api';
import { useT } from './i18n';

export function Home({ api }: { api: Api }) {
  const t = useT();
  const [data, setData] = useState<MySections | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [klass, setKlass] = useState<Classification | ''>('');
  const [orphansOnly, setOrphansOnly] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const load = () => {
    setError(null);
    void safeCall(api, 'listMySections', {}).then((res) => {
      if (res.ok) setData(res.data);
      else setError(t('error.generic'));
    });
  };
  useEffect(() => {
    let live = true;
    void safeCall(api, 'listMySections', {}).then((res) => {
      if (!live) return;
      if (res.ok) setData(res.data);
      else setError(t('error.generic'));
    });
    return () => {
      live = false;
    };
  }, [api, t]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.rows ?? []).filter((r) => {
      if (klass && r.classification !== klass) return false;
      if (orphansOnly && r.pageStatus !== 'MISSING') return false;
      if (!q) return true;
      return [r.title, r.pageId, r.spaceKey, r.sectionId].some((v) =>
        (v ?? '').toLowerCase().includes(q),
      );
    });
  }, [data, query, klass, orphansOnly]);

  if (!data && !error) return <p role="status">{t('state.loading')}</p>;
  if (error || !data) {
    return (
      <p role="alert">
        {error}{' '}
        <button type="button" className="ss-btn" onClick={load}>
          {t('action.retry')}
        </button>
      </p>
    );
  }

  const download = async () => {
    const res = unwrap(await api.call('exportMyAudit', {}));
    const blob = new Blob([res.csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'secure-sections-audit.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="ss-shell">
      <h1>{t('home.title')}</h1>
      <div className="ss-kpis">
        <Kpi label={t('home.kpi.admin')} value={data.kpis.administered} />
        <Kpi label={t('home.kpi.pending')} value={data.kpis.pendingRequests} />
        <Kpi label={t('home.kpi.expiring')} value={data.kpis.expiringGrants} />
        <Kpi label={t('home.kpi.inactive')} value={data.kpis.inactive} />
      </div>
      <form className="ss-row" onSubmit={(e) => e.preventDefault()}>
        <label>
          {t('home.filter')}
          <input value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <label>
          {t('meta.class.label')}
          <select value={klass} onChange={(e) => setKlass(e.target.value as Classification | '')}>
            <option value="">{t('home.filter.any')}</option>
            {CLASSIFICATIONS.map((c) => (
              <option key={c} value={c}>
                {t(`class.${c}`)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={orphansOnly}
            onChange={(e) => setOrphansOnly(e.target.checked)}
          />{' '}
          {t('home.orphansOnly')}
        </label>
        <button type="button" className="ss-btn" onClick={() => void download()}>
          {t('home.export')}
        </button>
      </form>
      <table className="ss-grid">
        <thead>
          <tr>
            <th>{t('meta.title.label')}</th>
            <th>{t('home.page')}</th>
            <th>{t('home.space')}</th>
            <th>{t('meta.class.label')}</th>
            <th>{t('perm.effective')}</th>
            <th>{t('home.updated')}</th>
            <th>{t('home.status')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.sectionId}>
              <td>{r.title ?? t('home.untitled')}</td>
              <td>{r.pageId}</td>
              <td>{r.spaceKey ?? '—'}</td>
              <td>{r.classification ? t(`class.${r.classification}`) : '—'}</td>
              <td>
                {t(`role.${r.role}`)} · {r.sharedUsers}
              </td>
              <td>{new Date(r.updatedAt).toLocaleString()}</td>
              <td>
                {r.pageStatus === 'MISSING' ? t('home.orphan') : t('home.ok')}
                {r.pageStatus === 'MISSING' && r.role === 'ADMINISTER' && (
                  <button
                    type="button"
                    className="ss-btn ss-danger"
                    onClick={() => setConfirmId(r.sectionId)}
                  >
                    {t('action.remove')}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p className="ss-muted">{t('home.empty')}</p>}
      {confirmId && (
        <div role="alertdialog" aria-label={t('home.delete')} className="ss-callout ss-warn">
          <p>{t('home.delete')}</p>
          <button
            type="button"
            className="ss-btn ss-danger"
            onClick={() => {
              void safeCall(api, 'deleteOrphan', { sectionId: confirmId, confirm: 'DELETE' }).then(
                (res) => {
                  setConfirmId(null);
                  if (res.ok) load();
                  else setError(t('error.generic'));
                },
              );
            }}
          >
            {t('action.confirm')}
          </button>
          <button type="button" className="ss-btn" onClick={() => setConfirmId(null)}>
            {t('action.cancel')}
          </button>
        </div>
      )}
      <h2>{t('home.activity')}</h2>
      <ul>
        {data.activity.map((a, i) => (
          <li key={`${a.at}-${i}`}>
            {new Date(a.at).toLocaleString()} · {a.action} · {a.actor}
            {a.title ? ` · ${a.title}` : ''}
          </li>
        ))}
      </ul>
      <p className="ss-muted">{t('home.activity.note')}</p>
    </main>
  );
}

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <section className="ss-card">
      <h2>{value}</h2>
      <p>{label}</p>
    </section>
  );
}
