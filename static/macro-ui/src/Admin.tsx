import { useEffect, useState } from 'react';
import {
  CLASSIFICATIONS,
  type AdminOverview,
  type ClassPolicy,
  type RetentionConfig,
  type SitePolicy,
} from '@secure-sections/shared';
import { safeCall, type Api } from './api';
import { useT } from './i18n';

export function Admin({ api }: { api: Api }) {
  const t = useT();
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [recoverFor, setRecoverFor] = useState<string | null>(null);
  const [accountId, setAccountId] = useState('');

  const load = () => {
    setSaved(false);
    void safeCall(api, 'getAdminOverview', {}).then((res) => {
      if (res.ok) setData(res.data);
      else setError(res.code === 'DENIED' ? t('admin.denied') : t('error.generic'));
    });
  };
  useEffect(() => {
    let live = true;
    void safeCall(api, 'getAdminOverview', {}).then((res) => {
      if (!live) return;
      if (res.ok) setData(res.data);
      else setError(res.code === 'DENIED' ? t('admin.denied') : t('error.generic'));
    });
    return () => {
      live = false;
    };
  }, [api, t]);

  if (error && !data) return <p role="alert">{error}</p>;
  if (!data) return <p role="status">{t('state.loading')}</p>;

  const setPolicy = (patch: Partial<SitePolicy>) =>
    setData({ ...data, policy: { ...data.policy, ...patch } });
  const setClass = (id: ClassPolicy['id'], patch: Partial<ClassPolicy>) =>
    setPolicy({
      classes: data.policy.classes.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    });
  const setRetention = (patch: Partial<RetentionConfig>) =>
    setData({ ...data, retention: { ...data.retention, ...patch } });

  return (
    <main className="ss-shell">
      <h1>{t('admin.settings')}</h1>
      <section className="ss-card">
        <h2>{t('admin.diagnostics')}</h2>
        <p>
          {t('admin.sections')}: {data.sectionCount}
          {data.truncated ? '+' : ''}
        </p>
        <p>
          {t('admin.lastSweep')}: {data.lastSweep ? new Date(data.lastSweep).toLocaleString() : '—'}
        </p>
        <h3>{t('admin.noAdmin')}</h3>
        <ul>
          {data.noAdmin.map((s) => (
            <li key={s.sectionId}>
              {s.title ?? s.sectionId} · {s.pageId}{' '}
              <button type="button" className="ss-btn" onClick={() => setRecoverFor(s.sectionId)}>
                {t('admin.recover')}
              </button>
            </li>
          ))}
        </ul>
        <h3>{t('admin.orphans')}</h3>
        <ul>
          {data.orphans.map((s) => (
            <li key={s.sectionId}>
              {s.title ?? s.sectionId} · {s.pageId}
            </li>
          ))}
        </ul>
      </section>
      {recoverFor && (
        <form
          className="ss-callout"
          onSubmit={(e) => {
            e.preventDefault();
            void safeCall(api, 'recoverUnowned', {
              sectionId: recoverFor,
              newAdministratorAccountId: accountId.trim(),
              confirm: 'RECOVER',
            }).then((res) => {
              if (res.ok) {
                setRecoverFor(null);
                load();
              } else setError(t('error.generic'));
            });
          }}
        >
          <label>
            {t('admin.recoverAccount')}
            <input value={accountId} onChange={(e) => setAccountId(e.target.value)} />
          </label>
          <button type="submit" className="ss-btn ss-primary">
            {t('admin.recover')}
          </button>
        </form>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void safeCall(api, 'updateSitePolicy', {
            policy: data.policy,
            retention: data.retention,
          }).then((res) => {
            if (res.ok) {
              setData(res.data);
              setSaved(true);
            } else setError(t('error.generic'));
          });
        }}
      >
        <h2>{t('admin.policy')}</h2>
        <label>
          <input
            type="checkbox"
            checked={data.policy.allowRequests}
            onChange={(e) => setPolicy({ allowRequests: e.target.checked })}
          />{' '}
          {t('admin.allowRequests')}
        </label>
        <label>
          {t('admin.maxGrantDays')}
          <input
            type="number"
            min={1}
            max={365}
            value={data.policy.maxGrantDays}
            onChange={(e) => setPolicy({ maxGrantDays: Number(e.target.value) })}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={data.policy.requireChangeNote}
            onChange={(e) => setPolicy({ requireChangeNote: e.target.checked })}
          />{' '}
          {t('admin.requireNote')}
        </label>
        <label>
          {t('admin.whoMayCreate')}
          <select
            value={data.policy.whoMayCreate}
            onChange={(e) =>
              setPolicy({
                whoMayCreate: e.target.value === 'SITE_ADMINS' ? 'SITE_ADMINS' : 'PAGE_EDITORS',
              })
            }
          >
            <option value="PAGE_EDITORS">{t('admin.pageEditors')}</option>
            <option value="SITE_ADMINS">{t('admin.siteAdmins')}</option>
          </select>
        </label>
        <h2>{t('admin.classes')}</h2>
        <table className="ss-grid">
          <thead>
            <tr>
              <th>{t('meta.class.label')}</th>
              <th>{t('admin.watermark')}</th>
              <th>{t('admin.autolock')}</th>
              <th>{t('admin.protectCopy')}</th>
            </tr>
          </thead>
          <tbody>
            {CLASSIFICATIONS.map((id) => {
              const row = data.policy.classes.find((c) => c.id === id);
              if (!row) return null;
              return (
                <tr key={id}>
                  <td>{t(`class.${id}`)}</td>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`${id} ${t('admin.watermark')}`}
                      checked={row.watermark}
                      onChange={(e) => setClass(id, { watermark: e.target.checked })}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      aria-label={`${id} ${t('admin.autolock')}`}
                      min={0}
                      max={120}
                      value={row.autoLockMinutes ?? 0}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        setClass(id, { autoLockMinutes: n >= 1 ? n : null });
                      }}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`${id} ${t('admin.protectCopy')}`}
                      checked={row.protectCopy}
                      onChange={(e) => setClass(id, { protectCopy: e.target.checked })}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <h2>{t('admin.retention')}</h2>
        {(
          [
            ['revisionsKeep', 1, 500],
            ['revisionsMaxAgeDays', 1, 3650],
            ['auditMaxAgeDays', 1, 3650],
            ['deletedSectionGraceDays', 1, 365],
          ] as const
        ).map(([key, min, max]) => (
          <label key={key}>
            {t(`admin.retention.${key}`)}
            <input
              type="number"
              min={min}
              max={max}
              value={data.retention[key]}
              onChange={(e) => setRetention({ [key]: Number(e.target.value) })}
            />
          </label>
        ))}
        <p className="ss-muted">{t('admin.retention.note')}</p>
        <button type="submit" className="ss-btn ss-primary">
          {t('admin.save')}
        </button>
        {saved && <p role="status">{t('editor.saved')}</p>}
        {error && <p role="alert">{error}</p>}
      </form>
    </main>
  );
}
