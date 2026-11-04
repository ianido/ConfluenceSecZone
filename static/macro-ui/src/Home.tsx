import { useEffect, useMemo, useState } from 'react';
import type { Classification, MySections } from '@secure-sections/shared';
import { CLASSIFICATIONS } from '@secure-sections/shared';
import { safeCall, unwrap, type Api } from './api';
import { ClassificationBadge } from './Header';
import { useT } from './i18n';
import { CountFaces, LockIcon, Pill } from './visual';

export function Home({ api }: { api: Api }) {
  const t = useT();
  const [data, setData] = useState<MySections | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [klass, setKlass] = useState<Classification | ''>('');
  const [orphansOnly, setOrphansOnly] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState('');

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
      <header className="ss-page-head">
        <h1>
          <LockIcon /> {t('home.title')}
        </h1>
        <button type="button" className="ss-btn" onClick={() => void download()}>
          {t('home.export')}
        </button>
      </header>
      <div className="ss-kpis">
        <Kpi label={t('home.kpi.admin')} value={data.kpis.administered} />
        <Kpi label={t('home.kpi.pending')} value={data.kpis.pendingRequests} tone="warn" />
        <Kpi label={t('home.kpi.expiring')} value={data.kpis.expiringGrants} tone="info" />
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
              <td>
                <strong>{r.title ?? t('home.untitled')}</strong>
              </td>
              <td>{r.pageId}</td>
              <td>{r.spaceKey ?? '—'}</td>
              <td>{r.classification ? <ClassificationBadge value={r.classification} /> : '—'}</td>
              <td>
                <span className="ss-shared">
                  <CountFaces users={r.sharedUsers} groups={0} />
                  {t(`role.${r.role}`)}
                </span>
              </td>
              <td>{new Date(r.updatedAt).toLocaleString()}</td>
              <td>
                <Pill
                  tone={
                    r.pageStatus === 'MISSING'
                      ? 'muted'
                      : r.pageStatus === 'UNKNOWN'
                        ? 'warn'
                        : 'ok'
                  }
                >
                  {r.pageStatus === 'MISSING'
                    ? t('home.orphan')
                    : r.pageStatus === 'UNKNOWN'
                      ? t('state.unavailable.title')
                      : t('home.ok')}
                </Pill>
                {r.pageStatus === 'MISSING' && r.role === 'ADMINISTER' && (
                  <button
                    type="button"
                    className="ss-btn ss-danger"
                    onClick={() => {
                      setConfirmText('');
                      setConfirmId(r.sectionId);
                    }}
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
          <label>
            {t('home.delete.confirm')}
            <input
              value={confirmText}
              aria-label={t('home.delete.confirm')}
              onChange={(e) => setConfirmText(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="ss-btn ss-danger"
            disabled={confirmText !== 'DELETE'}
            onClick={() => {
              if (confirmText !== 'DELETE') return;
              void safeCall(api, 'deleteOrphan', {
                sectionId: confirmId,
                confirm: confirmText,
              }).then((res) => {
                setConfirmId(null);
                setConfirmText('');
                if (res.ok) load();
                else setError(t('error.generic'));
              });
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
      <ul className="ss-activity">
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

function Kpi({ label, value, tone }: { label: string; value: number; tone?: 'warn' | 'info' }) {
  return (
    <section className={tone ? `ss-kpi ss-kpi-${tone}` : 'ss-kpi'}>
      <span>{label}</span>
      <strong>{value}</strong>
    </section>
  );
}
