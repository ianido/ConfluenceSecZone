import { useEffect, useState, type ReactNode } from 'react';
import {
  CLASSIFICATIONS,
  SECTION_TEMPLATES,
  type AdminOverview,
  type ClassPolicy,
  type Classification,
  type RetentionConfig,
  type SitePolicy,
} from '@secure-sections/shared';
import { safeCall, type Api } from './api';
import { useT } from './i18n';
import { GearIcon, TemplateMark } from './visual';

type AdminTab =
  'policy' | 'retention' | 'classes' | 'templates' | 'recovery' | 'diagnostics' | 'audit';

const TABS: AdminTab[] = [
  'policy',
  'retention',
  'classes',
  'templates',
  'recovery',
  'diagnostics',
  'audit',
];

const GRANT_DAY_CHOICES = [7, 30, 90, 180, 365];
const LOCK_CHOICES = [0, 5, 15, 30, 60];

function watermarkMode(classes: ClassPolicy[]): string {
  const on = classes
    .filter((c) => c.watermark)
    .map((c) => c.id)
    .sort()
    .join(',');
  if (on === '') return 'off';
  if (on === 'RESTRICTED') return 'restricted';
  if (on === 'CONFIDENTIAL,RESTRICTED') return 'confidential';
  if (on === 'CONFIDENTIAL,INTERNAL,RESTRICTED') return 'all';
  return 'custom';
}

function withWatermark(classes: ClassPolicy[], mode: string): ClassPolicy[] {
  const allow = new Set<Classification>(
    mode === 'all'
      ? ['INTERNAL', 'CONFIDENTIAL', 'RESTRICTED']
      : mode === 'confidential'
        ? ['CONFIDENTIAL', 'RESTRICTED']
        : mode === 'restricted'
          ? ['RESTRICTED']
          : [],
  );
  return classes.map((c) => ({ ...c, watermark: allow.has(c.id) }));
}

export function Admin({ api }: { api: Api }) {
  const t = useT();
  const [tab, setTab] = useState<AdminTab>('policy');
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
  const restricted = data.policy.classes.find((c) => c.id === 'RESTRICTED');
  const lockMinutes = restricted?.autoLockMinutes ?? 0;
  const lockChoices = LOCK_CHOICES.includes(lockMinutes)
    ? LOCK_CHOICES
    : [...LOCK_CHOICES, lockMinutes].sort((a, b) => a - b);
  const dayChoices = GRANT_DAY_CHOICES.includes(data.policy.maxGrantDays)
    ? GRANT_DAY_CHOICES
    : [...GRANT_DAY_CHOICES, data.policy.maxGrantDays].sort((a, b) => a - b);
  const mode = watermarkMode(data.policy.classes);

  const save = () => {
    setSaved(false);
    void safeCall(api, 'updateSitePolicy', {
      policy: data.policy,
      retention: data.retention,
    }).then((res) => {
      if (res.ok) {
        setData(res.data);
        setSaved(true);
      } else setError(t('error.generic'));
    });
  };

  return (
    <main className="ss-admin-page">
      <header className="ss-admin-head">
        <h1>
          <GearIcon /> {t('admin.heading')}
        </h1>
        <span className="ss-health">{t('admin.health')}</span>
      </header>
      <div className="ss-admin">
        <nav className="ss-admin-nav" aria-label={t('admin.heading')}>
          {TABS.map((id) => (
            <button
              key={id}
              type="button"
              aria-current={tab === id ? 'page' : undefined}
              onClick={() => setTab(id)}
            >
              {t(`admin.nav.${id}`)}
            </button>
          ))}
        </nav>
        <div className="ss-admin-main">
          {tab === 'policy' && (
            <>
              <h2>{t('admin.policy')}</h2>
              <Setting
                title={t('admin.allowRequests')}
                help={t('admin.allowRequests.help')}
                control={
                  <Switch
                    label={t('admin.allowRequests')}
                    checked={data.policy.allowRequests}
                    onChange={(checked) => setPolicy({ allowRequests: checked })}
                  />
                }
              />
              <Setting
                title={t('admin.maxGrantDays')}
                help={t('admin.maxGrantDays.help')}
                control={
                  <select
                    aria-label={t('admin.maxGrantDays')}
                    value={data.policy.maxGrantDays}
                    onChange={(e) => setPolicy({ maxGrantDays: Number(e.target.value) })}
                  >
                    {dayChoices.map((n) => (
                      <option key={n} value={n}>
                        {t('admin.days', { n })}
                      </option>
                    ))}
                  </select>
                }
              />
              <Setting
                title={t('admin.autolock.site')}
                help={t('admin.autolock.help')}
                control={
                  <select
                    aria-label={t('admin.autolock.site')}
                    value={lockMinutes}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      setClass('RESTRICTED', { autoLockMinutes: n >= 1 ? n : null });
                    }}
                  >
                    {lockChoices.map((n) => (
                      <option key={n} value={n}>
                        {n === 0 ? t('admin.autolock.off') : t('admin.minutes', { n })}
                      </option>
                    ))}
                  </select>
                }
              />
              <Setting
                title={t('admin.watermark.site')}
                control={
                  <select
                    aria-label={t('admin.watermark.site')}
                    value={mode}
                    onChange={(e) => {
                      if (e.target.value === 'custom') return;
                      setPolicy({ classes: withWatermark(data.policy.classes, e.target.value) });
                    }}
                  >
                    {mode === 'custom' && (
                      <option value="custom">{t('admin.watermark.custom')}</option>
                    )}
                    <option value="off">{t('admin.watermark.off')}</option>
                    <option value="restricted">{t('admin.watermark.restricted')}</option>
                    <option value="confidential">{t('admin.watermark.confidential')}</option>
                    <option value="all">{t('admin.watermark.all')}</option>
                  </select>
                }
              />
              <Setting
                title={t('admin.requireNote')}
                control={
                  <Switch
                    label={t('admin.requireNote')}
                    checked={data.policy.requireChangeNote}
                    onChange={(checked) => setPolicy({ requireChangeNote: checked })}
                  />
                }
              />
              <Setting
                title={t('admin.whoMayCreate')}
                help={t('admin.whoMayCreate.help')}
                control={
                  <select
                    aria-label={t('admin.whoMayCreate')}
                    value={data.policy.whoMayCreate}
                    onChange={(e) =>
                      setPolicy({
                        whoMayCreate:
                          e.target.value === 'SITE_ADMINS' ? 'SITE_ADMINS' : 'PAGE_EDITORS',
                      })
                    }
                  >
                    <option value="PAGE_EDITORS">{t('admin.pageEditors')}</option>
                    <option value="SITE_ADMINS">{t('admin.siteAdmins')}</option>
                  </select>
                }
              />
              <h3 className="ss-kicker">{t('admin.retention.kicker')}</h3>
              <RetentionRow retention={data.retention} onChange={setRetention} onSave={save} />
              <h3 className="ss-kicker">{t('admin.classes')}</h3>
              <p className="ss-muted">{t('admin.classes.help')}</p>
              <div className="ss-class-pills">
                {CLASSIFICATIONS.map((id) => (
                  <span key={id} className={`ss-badge ss-class-${id.toLowerCase()}`}>
                    {t(`class.${id}`)}
                  </span>
                ))}
              </div>
              <h3 className="ss-kicker">{t('admin.diagnostics')}</h3>
              <Diagnostics
                data={data}
                onRecover={(id) => {
                  setRecoverFor(id);
                  setTab('recovery');
                }}
              />
            </>
          )}
          {tab === 'retention' && (
            <>
              <h2>{t('admin.retention')}</h2>
              <p className="ss-muted">{t('admin.retention.note')}</p>
              {(
                [
                  ['revisionsKeep', 1, 500],
                  ['revisionsMaxAgeDays', 1, 3650],
                  ['auditMaxAgeDays', 1, 3650],
                  ['deletedSectionGraceDays', 1, 365],
                ] as const
              ).map(([key, min, max]) => (
                <label key={key} className="ss-setting">
                  <span>{t(`admin.retention.${key}`)}</span>
                  <input
                    type="number"
                    min={min}
                    max={max}
                    value={data.retention[key]}
                    onChange={(e) => setRetention({ [key]: Number(e.target.value) })}
                  />
                </label>
              ))}
              <SaveButton onSave={save} saved={saved} />
            </>
          )}
          {tab === 'classes' && (
            <>
              <h2>{t('admin.classes')}</h2>
              <p className="ss-muted">{t('admin.classes.help')}</p>
              {CLASSIFICATIONS.map((id) => {
                const row = data.policy.classes.find((c) => c.id === id);
                if (!row) return null;
                return (
                  <section key={id} className="ss-class-card">
                    <span className={`ss-badge ss-class-${id.toLowerCase()}`}>
                      {t(`class.${id}`)}
                    </span>
                    <label>
                      <input
                        type="checkbox"
                        checked={row.watermark}
                        onChange={(e) => setClass(id, { watermark: e.target.checked })}
                      />{' '}
                      {t('admin.watermark')}
                    </label>
                    <label>
                      {t('admin.autolock.site')}
                      <input
                        type="number"
                        aria-label={`${id} ${t('admin.autolock.site')}`}
                        min={0}
                        max={120}
                        value={row.autoLockMinutes ?? 0}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          setClass(id, { autoLockMinutes: n >= 1 ? n : null });
                        }}
                      />
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={row.protectCopy}
                        onChange={(e) => setClass(id, { protectCopy: e.target.checked })}
                      />{' '}
                      {t('admin.protectCopy')}
                    </label>
                  </section>
                );
              })}
              <SaveButton onSave={save} saved={saved} />
            </>
          )}
          {tab === 'templates' && (
            <>
              <h2>{t('admin.nav.templates')}</h2>
              <p className="ss-muted">{t('admin.templates.note')}</p>
              <div className="ss-templates">
                {SECTION_TEMPLATES.map((id) => (
                  <div key={id} className="ss-template">
                    <TemplateMark id={id} />
                    <strong>{t(`wizard.template.${id}`)}</strong>
                    <span className="ss-template-hint">{t(`wizard.template.${id}.hint`)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
          {tab === 'recovery' && (
            <>
              <h2>{t('admin.nav.recovery')}</h2>
              <Recovery
                data={data}
                recoverFor={recoverFor}
                accountId={accountId}
                onPick={setRecoverFor}
                onAccount={setAccountId}
                onDone={load}
                api={api}
                onError={() => setError(t('error.generic'))}
              />
            </>
          )}
          {tab === 'diagnostics' && (
            <>
              <h2>{t('admin.diagnostics')}</h2>
              <Diagnostics
                data={data}
                onRecover={(id) => {
                  setRecoverFor(id);
                  setTab('recovery');
                }}
              />
            </>
          )}
          {tab === 'audit' && (
            <>
              <h2>{t('admin.nav.audit')}</h2>
              <p>{t('admin.audit.note')}</p>
              <p className="ss-muted">
                {t('admin.lastSweep')}:{' '}
                {data.lastSweep ? new Date(data.lastSweep).toLocaleString() : '—'}
              </p>
            </>
          )}
          {error && <p role="alert">{error}</p>}
          {tab === 'policy' && saved && <p role="status">{t('editor.saved')}</p>}
        </div>
      </div>
    </main>
  );
}

function Setting({ title, help, control }: { title: string; help?: string; control: ReactNode }) {
  return (
    <div className="ss-setting">
      <div>
        <h3>{title}</h3>
        {help && <p>{help}</p>}
      </div>
      {control}
    </div>
  );
}

function Switch({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="ss-switch">
      <input
        type="checkbox"
        aria-label={label}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span />
    </label>
  );
}

function RetentionRow({
  retention,
  onChange,
  onSave,
}: {
  retention: RetentionConfig;
  onChange: (patch: Partial<RetentionConfig>) => void;
  onSave: () => void;
}) {
  const t = useT();
  return (
    <div className="ss-retention-row">
      <label>
        {t('admin.retention.revisionsKeep')}
        <input
          type="number"
          min={1}
          max={500}
          value={retention.revisionsKeep}
          onChange={(e) => onChange({ revisionsKeep: Number(e.target.value) })}
        />
      </label>
      <label>
        {t('admin.retention.revisionsMaxAgeDays')}
        <input
          type="number"
          min={1}
          max={3650}
          value={retention.revisionsMaxAgeDays}
          onChange={(e) => onChange({ revisionsMaxAgeDays: Number(e.target.value) })}
        />
      </label>
      <label>
        {t('admin.retention.auditMaxAgeDays')}
        <input
          type="number"
          min={1}
          max={3650}
          value={retention.auditMaxAgeDays}
          onChange={(e) => onChange({ auditMaxAgeDays: Number(e.target.value) })}
        />
      </label>
      <button type="button" className="ss-btn ss-primary" onClick={onSave}>
        {t('admin.save')}
      </button>
    </div>
  );
}

function Diagnostics({
  data,
  onRecover,
}: {
  data: AdminOverview;
  onRecover: (sectionId: string) => void;
}) {
  const t = useT();
  const first = data.noAdmin[0];
  return (
    <div className="ss-kpi-row">
      <article className="ss-kpi">
        <span>{t('admin.sections')}</span>
        <strong>
          {data.sectionCount}
          {data.truncated ? '+' : ''}
        </strong>
      </article>
      <article className="ss-kpi">
        <span>{t('admin.noAdmin')}</span>
        <strong className={data.noAdmin.length > 0 ? 'ss-danger' : undefined}>
          {data.noAdmin.length}
        </strong>
        {first && (
          <button type="button" className="ss-link" onClick={() => onRecover(first.sectionId)}>
            {t('admin.recover.go')}
          </button>
        )}
      </article>
      <article className="ss-kpi">
        <span>{t('admin.orphans')}</span>
        <strong>{data.orphans.length}</strong>
      </article>
      <article className="ss-kpi">
        <span>{t('admin.lastSweep')}</span>
        <strong className="ss-kpi-when">
          {data.lastSweep ? new Date(data.lastSweep).toLocaleString() : '—'}
        </strong>
      </article>
    </div>
  );
}

function Recovery({
  data,
  recoverFor,
  accountId,
  onPick,
  onAccount,
  onDone,
  api,
  onError,
}: {
  data: AdminOverview;
  recoverFor: string | null;
  accountId: string;
  onPick: (id: string | null) => void;
  onAccount: (id: string) => void;
  onDone: () => void;
  api: Api;
  onError: () => void;
}) {
  const t = useT();
  return (
    <>
      <ul>
        {data.noAdmin.map((s) => (
          <li key={s.sectionId}>
            {s.title ?? s.sectionId} · {s.pageId}{' '}
            <button type="button" className="ss-btn" onClick={() => onPick(s.sectionId)}>
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
                onPick(null);
                onDone();
              } else onError();
            });
          }}
        >
          <label>
            {t('admin.recoverAccount')}
            <input value={accountId} onChange={(e) => onAccount(e.target.value)} />
          </label>
          <button type="submit" className="ss-btn ss-primary">
            {t('admin.recover')}
          </button>
        </form>
      )}
    </>
  );
}

function SaveButton({ onSave, saved }: { onSave: () => void; saved: boolean }) {
  const t = useT();
  return (
    <div className="ss-actions">
      <button type="button" className="ss-btn ss-primary" onClick={onSave}>
        {t('admin.save')}
      </button>
      {saved && <p role="status">{t('editor.saved')}</p>}
    </div>
  );
}
