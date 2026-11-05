import { useEffect, useMemo, useState, type FocusEvent } from 'react';
import type { Classification, MySections } from '@secure-sections/shared';
import { CLASSIFICATIONS } from '@secure-sections/shared';
import { safeCall, unwrap, type Api } from './api';
import { ClassificationBadge } from './Header';
import { useT } from './i18n';
import { CountFaces, LockIcon, Pill } from './visual';

export function Home({
  api,
  siteUrl = null,
  openPage = openConfluencePage,
}: {
  api: Api;
  siteUrl?: string | null;
  openPage?: (pageId: string, href: string) => void | Promise<void>;
}) {
  const t = useT();
  const [data, setData] = useState<MySections | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [klass, setKlass] = useState<Classification | ''>('');
  const [orphansOnly, setOrphansOnly] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [navError, setNavError] = useState<string | null>(null);
  const open = async (pageId: string, href: string) => {
    try {
      await openPage(pageId, href);
      setNavError(null);
    } catch {
      setNavError(t('error.generic'));
    }
  };

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
      return [r.title, r.pageTitle, r.pageId, r.spaceKey, r.sectionId].some((v) =>
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
      {navError && (
        <p className="ss-err" role="alert">
          {navError}
        </p>
      )}
      <table className="ss-grid ss-home-table">
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
              <td className="ss-page-cell">
                <PageLabel
                  pageId={r.pageId}
                  pageTitle={r.pageTitle}
                  href={r.pageStatus === 'MISSING' ? null : pageHref(siteUrl, r.pageId)}
                  openPage={open}
                />
              </td>
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

function pageTip(pageId: string, pageTitle: string | null): string {
  return pageTitle ? `[${pageId}] : ${pageTitle}` : `[${pageId}]`;
}

/**
 * Same-window navigation. A plain anchor cannot leave the Forge iframe, and a new tab is blocked
 * there, so the click asks Confluence to open the page in the current tab.
 */
export async function openConfluencePage(pageId: string, _href: string): Promise<void> {
  const { router } = await import('@forge/bridge');
  await router.navigate({ target: 'contentView', contentId: pageId });
}

/** Absolute Confluence URL. The macro iframe cannot use a relative /wiki path. */
function pageHref(siteUrl: string | null, pageId: string): string | null {
  if (!siteUrl || !/^\d{1,20}$/.test(pageId)) return null;
  let url: URL;
  try {
    url = new URL(siteUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  return `${url.origin}/wiki/pages/viewpage.action?pageId=${pageId}`;
}

function PageLabel({
  pageId,
  pageTitle,
  href,
  openPage,
}: {
  pageId: string;
  pageTitle: string | null;
  href: string | null;
  openPage: (pageId: string, href: string) => void | Promise<void>;
}) {
  const tip = pageTip(pageId, pageTitle);
  const text = pageTitle ?? pageId;
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const open = (hovered || focused) && !dismissed;

  useEffect(() => {
    if (!hovered && !focused) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setDismissed(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hovered, focused]);

  useEffect(() => {
    if (!hovered && !focused) setDismissed(false);
  }, [hovered, focused]);

  const leaveFocus = (event: FocusEvent<HTMLSpanElement>) => {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    setFocused(false);
  };

  return (
    <span
      className={open ? 'ss-page-label ss-tip-open' : 'ss-page-label'}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={leaveFocus}
    >
      {href ? (
        <a
          className="ss-clip"
          href={href}
          title={tip}
          onClick={(event) => {
            if (
              event.defaultPrevented ||
              event.button !== 0 ||
              event.metaKey ||
              event.ctrlKey ||
              event.shiftKey ||
              event.altKey
            ) {
              return;
            }
            event.preventDefault();
            void openPage(pageId, href);
          }}
        >
          {text}
        </a>
      ) : (
        <button type="button" className="ss-clip" title={tip}>
          {text}
        </button>
      )}
      <span className="ss-tip" role="tooltip">
        {tip}
      </span>
    </span>
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
