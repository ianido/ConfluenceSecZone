import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import {
  CLASSIFICATIONS,
  TITLE_MAX_LENGTH,
  docIsEmpty,
  isClassification,
  roleAtLeast,
  type AccessInfo,
  type Classification,
  type ContentPayload,
  type SectionMeta,
  type SectionView,
} from '@secure-sections/shared';
import { ApiError, safeCall, unwrap, type Api } from './api';
import { AccessRequestBox } from './Access';
import { EditPanel } from './Editor';
import { SectionHeader } from './Header';
import { useT } from './i18n';
import { AuditPanel, HelpPanel, HistoryPanel, PermissionsPanel } from './Panels';
import { RichRenderer } from './Renderer';

type Tab = 'content' | 'permissions' | 'history' | 'audit' | 'help';

function StateCard({
  title,
  body,
  tone = 'info',
  children,
  role = 'status',
}: {
  title: string;
  body: string;
  tone?: 'info' | 'warn';
  children?: ReactNode;
  role?: 'status' | 'alert';
}) {
  return (
    <section
      className={`ss-card ss-${tone}`}
      role={role}
      aria-live={role === 'alert' ? 'assertive' : 'polite'}
    >
      <h2>
        <span aria-hidden="true">🔒 </span>
        {title}
      </h2>
      <p>{body}</p>
      {children}
    </section>
  );
}

export function App({ api }: { api: Api }) {
  const t = useT();
  const [view, setView] = useState<SectionView | 'LOADING' | 'REVOKED'>('LOADING');
  const wasReady = useRef(false);

  const load = useCallback(async () => {
    const res = await safeCall(api, 'getSection', {});
    const next: SectionView = 'state' in res ? res : { state: 'UNAVAILABLE' };
    if (next.state === 'READY') wasReady.current = true;
    setView(next.state === 'DENIED' && wasReady.current ? 'REVOKED' : next);
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  if (view === 'LOADING') {
    return (
      <p role="status" className="ss-muted">
        {t('state.loading')}
      </p>
    );
  }
  switch (view) {
    case 'REVOKED':
      return (
        <StateCard title={t('state.revoked.title')} body={t('state.revoked.body')} tone="warn">
          <button type="button" className="ss-btn" onClick={() => void load()}>
            {t('action.reload')}
          </button>
        </StateCard>
      );
    default:
  }
  switch (view.state) {
    case 'DENIED':
      return <Denied api={api} />;
    case 'UNAVAILABLE':
      return (
        <StateCard
          title={t('state.unavailable.title')}
          body={t('state.unavailable.body')}
          tone="warn"
          role="alert"
        >
          <button type="button" className="ss-btn" onClick={() => void load()}>
            {t('action.retry')}
          </button>
        </StateCard>
      );
    case 'CORRUPTED':
      return (
        <StateCard
          title={t('state.corrupted.title')}
          body={t('state.corrupted.body')}
          tone="warn"
          role="alert"
        />
      );
    case 'UNCONFIGURED':
      return <Unconfigured api={api} canCreate={view.canCreate} onDone={() => void load()} />;
    case 'READY':
      return <Ready api={api} view={view} reload={() => void load()} />;
  }
}

function Denied({ api }: { api: Api }) {
  const t = useT();
  const [info, setInfo] = useState<AccessInfo | null>(null);
  useEffect(() => {
    let live = true;
    void safeCall(api, 'getAccessInfo', {}).then((res) => {
      if (live && res.ok) setInfo(res.data);
    });
    return () => {
      live = false;
    };
  }, [api]);
  return (
    <StateCard title={t('state.denied.title')} body={t('state.denied.body')}>
      {info && <AccessRequestBox api={api} info={info} onInfo={setInfo} />}
      <details>
        <summary>{t('nav.help')}</summary>
        <p>{t('perm.requestAccess')}</p>
        <HelpPanel api={api} userRole={null} />
      </details>
    </StateCard>
  );
}

function Unconfigured({
  api,
  canCreate,
  onDone,
}: {
  api: Api;
  canCreate: boolean;
  onDone: () => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'none' | 'bind' | 'copy'>('none');
  const [ref, setRef] = useState('');
  const [title, setTitle] = useState('');
  const [classification, setClassification] = useState<Classification | ''>('');
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onDone();
    } catch (e) {
      setError(
        e instanceof ApiError && e.code === 'PAGE_EDIT_REQUIRED'
          ? t('state.unconfigured.cannotCreate')
          : e instanceof ApiError && e.code === 'DENIED'
            ? t('bind.invalid')
            : t('error.generic'),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <StateCard title={t('state.unconfigured.title')} body={t('state.unconfigured.body')}>
      {!canCreate ? (
        <p>{t('state.unconfigured.cannotCreate')}</p>
      ) : (
        <>
          <h3>{t('wizard.title')}</h3>
          <ol>
            <li>{t('wizard.step1')}</li>
            <li>{t('wizard.step2')}</li>
            <li>{t('wizard.step3')}</li>
          </ol>
          <p className="ss-muted">{t('wizard.copyWarning')}</p>
          <div className="ss-meta-form">
            <label>
              {t('meta.title.label')}
              <input
                value={title}
                maxLength={TITLE_MAX_LENGTH}
                placeholder={t('meta.title.placeholder')}
                onChange={(e) => setTitle(e.target.value)}
                autoComplete="off"
              />
            </label>
            <label>
              {t('meta.class.label')}
              <select
                value={classification}
                onChange={(e) => {
                  const v = e.target.value;
                  setClassification(isClassification(v) ? v : '');
                }}
              >
                <option value="">{t('meta.class.none')}</option>
                {CLASSIFICATIONS.map((c) => (
                  <option key={c} value={c}>
                    {t(`class.${c}`)}
                  </option>
                ))}
              </select>
            </label>
            <p className="ss-muted ss-meta-note">{t('meta.public.note')}</p>
          </div>
          <div className="ss-actions">
            <button
              type="button"
              className="ss-btn ss-primary"
              disabled={busy}
              onClick={() =>
                run(async () =>
                  unwrap(
                    await api.call('createSection', {
                      title: title.trim() === '' ? null : title.trim(),
                      classification: classification === '' ? null : classification,
                    }),
                  ),
                )
              }
            >
              {t('action.create')}
            </button>
            <button
              type="button"
              className="ss-btn"
              onClick={() => setMode(mode === 'bind' ? 'none' : 'bind')}
            >
              {t('bind.title')}
            </button>
            <button
              type="button"
              className="ss-btn"
              onClick={() => setMode(mode === 'copy' ? 'none' : 'copy')}
            >
              {t('bind.copy.title')}
            </button>
          </div>
          {mode !== 'none' && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () =>
                  mode === 'bind'
                    ? unwrap(await api.call('bindHere', { sectionRef: ref.trim() }))
                    : unwrap(await api.call('copyHere', { sourceRef: ref.trim() })),
                );
              }}
            >
              <p>{mode === 'bind' ? t('bind.body') : t('bind.copy.body')}</p>
              <label>
                {t('bind.ref')}
                <input
                  value={ref}
                  onChange={(e) => setRef(e.target.value)}
                  maxLength={64}
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <button type="submit" className="ss-btn" disabled={busy || ref.trim() === ''}>
                {t('action.confirm')}
              </button>
            </form>
          )}
        </>
      )}
      <div role="alert">{error}</div>
    </StateCard>
  );
}

function Ready({
  api,
  view,
  reload,
}: {
  api: Api;
  view: Extract<SectionView, { state: 'READY' }>;
  reload: () => void;
}) {
  const t = useT();
  const [tab, setTab] = useState<Tab>('content');
  const [content, setContent] = useState<ContentPayload>(view.content);
  const [meta, setMeta] = useState<SectionMeta>(view.meta);
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(0);
  const isAdmin = roleAtLeast(view.role, 'ADMINISTER');
  const tabs: Tab[] = ['content'];
  if (roleAtLeast(view.role, 'ADMINISTER')) tabs.push('permissions');
  if (roleAtLeast(view.role, 'MODIFY')) tabs.push('history');
  if (roleAtLeast(view.role, 'ADMINISTER')) tabs.push('audit');
  tabs.push('help');

  useEffect(() => setContent(view.content), [view.content]);
  useEffect(() => setMeta(view.meta), [view.meta]);
  useEffect(() => {
    if (!isAdmin) return undefined;
    let live = true;
    void safeCall(api, 'listAccessRequests', {}).then((res) => {
      if (live && res.ok) setPending(res.data.requests.length);
    });
    return () => {
      live = false;
    };
  }, [api, isAdmin]);

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, idx: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const n = tabs[(idx + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
    if (n && !editing) setTab(n);
  };

  return (
    <div className="ss-shell">
      {view.notice && (
        <div className="ss-callout" role="status">
          <p>
            {t('notice.added', {
              name: view.notice.addedByName,
              role: t(`role.${view.notice.role}`),
            })}
          </p>
          <button
            type="button"
            className="ss-btn"
            onClick={() => {
              void safeCall(api, 'dismissNotice', {}).then(() => reload());
            }}
          >
            {t('notice.dismiss')}
          </button>
        </div>
      )}
      <SectionHeader
        api={api}
        meta={meta}
        canAdminister={roleAtLeast(view.role, 'ADMINISTER')}
        editingLocked={editing}
        onMeta={setMeta}
        onManage={() => setTab('permissions')}
      />
      <div role="tablist" aria-label={t('app.title')} className="ss-tabs">
        {tabs.map((id, i) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`ss-tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`ss-pane-${id}`}
            tabIndex={tab === id ? 0 : -1}
            className="ss-tab"
            disabled={editing && tab !== id}
            onClick={() => setTab(id)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {t(`nav.${id === 'audit' ? 'audit' : id}`)}
            {id === 'permissions' && pending > 0 && (
              <span
                className="ss-count"
                role="img"
                aria-label={`${pending} ${t('requests.badge')}`}
              >
                {pending}
              </span>
            )}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`ss-pane-${tab}`} aria-labelledby={`ss-tab-${tab}`}>
        {tab === 'content' &&
          (editing ? (
            <EditPanel
              api={api}
              initial={content}
              onSaved={(c) => {
                setContent(c);
                setEditing(false);
                reload();
              }}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <section>
              {docIsEmpty(content.doc) ? (
                <p className="ss-muted">
                  <strong>{t('state.empty.title')}</strong> {t('state.empty.body')}
                </p>
              ) : (
                <RichRenderer doc={content.doc} />
              )}
              <p className="ss-muted ss-saved">
                {t('content.savedBy', {
                  name: content.updatedBy?.displayName ?? '—',
                  when: new Date(content.updatedAt).toLocaleString(),
                  version: content.version,
                })}
              </p>
              <div className="ss-actions">
                {view.canWrite && (
                  <button
                    type="button"
                    className="ss-btn ss-primary"
                    onClick={() => setEditing(true)}
                  >
                    {t('action.edit')}
                  </button>
                )}
                {roleAtLeast(view.role, 'MODIFY') && !view.canEditPage && (
                  <span className="ss-muted">{t('editor.pageEditRequired')}</span>
                )}
                <button type="button" className="ss-btn" onClick={reload}>
                  {t('action.reload')}
                </button>
              </div>
            </section>
          ))}
        {tab === 'permissions' && <PermissionsPanel api={api} onPending={setPending} />}
        {tab === 'history' && (
          <HistoryPanel
            api={api}
            baseVersion={content.version}
            canWrite={view.canWrite}
            onRestored={reload}
          />
        )}
        {tab === 'audit' && <AuditPanel api={api} />}
        {tab === 'help' && <HelpPanel api={api} userRole={view.role} />}
      </div>
    </div>
  );
}
