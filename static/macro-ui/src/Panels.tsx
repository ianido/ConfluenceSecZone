import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  GRANT_EXPIRY_PRESETS_DAYS,
  ROLES,
  diffDocs,
  type AuditList,
  type Diagnostics,
  type EffectiveAccess,
  type GrantList,
  type PrincipalHit,
  type PrincipalType,
  type RevisionList,
  type RichDoc,
  type Role,
} from '@secure-sections/shared';
import { RequestsQueue } from './Access';
import { ApiError, safeCall, unwrap, type Api } from './api';
import { useT } from './i18n';
import { RichRenderer } from './Renderer';
import { Avatar, Pill } from './visual';

function useLoad<T>(load: () => Promise<T>): {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  reload: () => void;
} {
  const [state, setState] = useState<{ data: T | null; error: ApiError | null; loading: boolean }>({
    data: null,
    error: null,
    loading: true,
  });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    load().then(
      (data) => live && setState({ data, error: null, loading: false }),
      (e) =>
        live &&
        setState({
          data: null,
          error: e instanceof ApiError ? e : new ApiError('UNAVAILABLE'),
          loading: false,
        }),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);
  return { ...state, reload: () => setTick((n) => n + 1) };
}

function errorText(e: ApiError, t: ReturnType<typeof useT>): string {
  switch (e.code) {
    case 'DENIED':
      return t('error.denied');
    case 'RATE_LIMITED':
      return t('error.rate');
    case 'LAST_ADMINISTRATOR':
      return t('perm.lastAdmin');
    case 'CONFLICT':
      return t('perm.conflict');
    default:
      return t('error.generic');
  }
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="ss-panel">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function Loading() {
  const t = useT();
  return (
    <p role="status" className="ss-muted">
      {t('state.loading')}
    </p>
  );
}

function ErrorBox({ error, onRetry }: { error: ApiError; onRetry: () => void }) {
  const t = useT();
  return (
    <div role="alert" className="ss-callout ss-warn">
      <p>{errorText(error, t)}</p>
      <button type="button" className="ss-btn" onClick={onRetry}>
        {t('action.retry')}
      </button>
    </div>
  );
}

export function RoleLabel({ role }: { role: Role | null }) {
  const t = useT();
  return <>{role ? t(`role.${role}`) : t('role.none')}</>;
}

function expiresAtFor(preset: 'never' | '7' | '30' | '90'): string | null {
  if (preset === 'never') return null;
  const days = Number(preset);
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

function samePrincipal(a: PrincipalHit, b: PrincipalHit): boolean {
  return a.principalType === b.principalType && a.principalId === b.principalId;
}

/** Search and multi-select live in a dialog so the permissions table stays a table. */
function AddAccessDialog({
  api,
  onClose,
  onAdd,
  onError,
}: {
  api: Api;
  onClose: () => void;
  onAdd: (hits: PrincipalHit[], role: Role, expiresAt: string | null) => void;
  onError: (text: string) => void;
}) {
  const t = useT();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const [kind, setKind] = useState<PrincipalType>('USER');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<PrincipalHit[]>([]);
  const [role, setRole] = useState<Role>('VIEW');
  const [ttl, setTtl] = useState<'never' | '7' | '30' | '90'>('never');
  const [picked, setPicked] = useState<PrincipalHit[]>([]);
  const [searched, setSearched] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el || el.open) return;
    try {
      if (!el.open) el.showModal();
    } catch {
      el.setAttribute('open', '');
    }
    el.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
  }, []);

  const runSearch = useCallback(
    async (q: string, type: PrincipalType) => {
      const trimmed = q.trim();
      if (trimmed.length < 2) {
        setHits([]);
        setSearched(false);
        return;
      }
      setBusy(true);
      const res = await safeCall(api, 'searchPrincipals', { query: trimmed, type });
      setBusy(false);
      if (res.ok) {
        setHits(res.data.hits);
        setSearched(true);
      } else onErrorRef.current(errorText(new ApiError(res.code), t));
    },
    [api, t],
  );

  useEffect(() => {
    const id = window.setTimeout(() => void runSearch(query, kind), 300);
    return () => window.clearTimeout(id);
  }, [query, kind, runSearch]);

  const toggle = (hit: PrincipalHit) => {
    setPicked((cur) => {
      const on = cur.some((p) => samePrincipal(p, hit));
      if (role === 'ADMINISTER') return on ? [] : [hit];
      return on ? cur.filter((p) => !samePrincipal(p, hit)) : [...cur, hit];
    });
  };

  const searchLabel = kind === 'USER' ? t('perm.search.users') : t('perm.search.groups');

  return (
    <dialog
      ref={dialogRef}
      className="ss-modal"
      aria-labelledby="ss-add-access-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <h2 id="ss-add-access-title">{t('perm.add')}</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void runSearch(query, kind);
        }}
      >
        <div className="ss-add-fields">
          <label>
            {t('perm.user')} / {t('perm.group')}
            <select
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as PrincipalType);
                setHits([]);
                setPicked([]);
                setSearched(false);
              }}
            >
              <option value="USER">{t('perm.user')}</option>
              <option value="GROUP">{t('perm.group')}</option>
            </select>
          </label>
          <label>
            {searchLabel}
            <input
              type="search"
              value={query}
              minLength={2}
              maxLength={100}
              placeholder={searchLabel}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <label>
            {t('nav.permissions')}
            <select
              value={role}
              onChange={(e) => {
                const next = e.target.value as Role;
                setRole(next);
                if (next === 'ADMINISTER') setPicked((cur) => cur.slice(0, 1));
              }}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {t(`role.${r}`)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('perm.expires')}
            <select value={ttl} onChange={(e) => setTtl(e.target.value as typeof ttl)}>
              <option value="never">{t('perm.expires.never')}</option>
              {GRANT_EXPIRY_PRESETS_DAYS.map((d) => (
                <option key={d} value={String(d)}>
                  {t(`perm.expires.in${d}` as 'perm.expires.in7')}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button type="submit" className="ss-btn" disabled={query.trim().length < 2 || busy}>
          {searchLabel}
        </button>
      </form>
      {busy && <p className="ss-muted">{t('perm.searching')}</p>}
      {!busy && !searched && query.trim().length < 2 && (
        <p className="ss-muted">{t('perm.search.hint')}</p>
      )}
      {!busy && searched && hits.length === 0 && (
        <p className="ss-muted">{t('perm.search.empty')}</p>
      )}
      {hits.length > 0 && (
        <ul className="ss-pick-list">
          {hits.map((h) => {
            const on = picked.some((p) => samePrincipal(p, h));
            return (
              <li key={`${h.principalType}:${h.principalId}`}>
                <label className={`ss-pick${on ? ' is-on' : ''}`}>
                  <input
                    type="checkbox"
                    aria-label={h.label}
                    checked={on}
                    onChange={() => toggle(h)}
                  />
                  <Avatar name={h.label} />
                  <span>{h.label}</span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
      <div className="ss-modal-actions">
        <button type="button" className="ss-btn" onClick={onClose}>
          {t('action.cancel')}
        </button>
        <button
          type="button"
          className="ss-btn ss-primary"
          disabled={picked.length === 0}
          onClick={() => onAdd(picked, role, expiresAtFor(ttl))}
        >
          {t('perm.multiAdd')}
          {picked.length > 0 ? ` (${picked.length})` : ''}
        </button>
      </div>
    </dialog>
  );
}

// ------------------------------------------------------------------ Permissions

export function PermissionsPanel({
  api,
  onPending,
}: {
  api: Api;
  onPending?: (n: number) => void;
}) {
  const t = useT();
  const grants = useLoad(async () => unwrap(await api.call('listGrants', {})));
  const access = useLoad(async () => unwrap(await api.call('getEffectiveAccess', {})));
  const [addOpen, setAddOpen] = useState(false);
  const [pendingAdmin, setPendingAdmin] = useState<{
    hit: PrincipalHit;
    expiresAt?: string | null;
  } | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<{ type: PrincipalType; id: string } | null>(
    null,
  );
  const [sourceRef, setSourceRef] = useState('');
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [current, setCurrent] = useState<GrantList | null>(null);
  const list = current ?? grants.data;

  const apply = useCallback(
    async (run: () => Promise<GrantList>) => {
      try {
        setCurrent(await run());
        setNotice({ kind: 'ok', text: t('perm.saved') });
        setSourceRef('');
      } catch (e) {
        const err = e instanceof ApiError ? e : new ApiError('UNAVAILABLE');
        setNotice({ kind: 'err', text: errorText(err, t) });
        if (err.code === 'CONFLICT') {
          setCurrent(null);
          grants.reload();
        }
      } finally {
        setPendingAdmin(null);
        setPendingRevoke(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t],
  );

  const upsert = (hit: PrincipalHit, r: Role, expiresAt?: string | null) =>
    apply(async () =>
      unwrap(
        await api.call('upsertGrant', {
          principalType: hit.principalType,
          principalId: hit.principalId,
          role: r,
          expectedAclVersion: (list as GrantList).aclVersion,
          ...(expiresAt !== undefined ? { expiresAt } : {}),
        }),
      ),
    );

  if (grants.loading) return <Loading />;
  if (grants.error || !list) {
    return <ErrorBox error={grants.error ?? new ApiError('UNAVAILABLE')} onRetry={grants.reload} />;
  }

  return (
    <Panel title={t('perm.title')}>
      <p className="ss-muted">{t('perm.explain')}</p>
      {access.data && <EffectiveBox access={access.data} />}
      <RequestsQueue
        api={api}
        aclVersion={list.aclVersion}
        {...(onPending ? { onCount: onPending } : {})}
        onResolved={() => {
          setCurrent(null);
          grants.reload();
        }}
      />
      <div role="status" aria-live="polite">
        {notice && <p className={notice.kind === 'ok' ? 'ss-ok' : 'ss-err'}>{notice.text}</p>}
      </div>
      <table className="ss-grid">
        <thead>
          <tr>
            <th scope="col">
              {t('perm.user')} / {t('perm.group')}
            </th>
            <th scope="col">{t('nav.permissions')}</th>
            <th scope="col">{t('perm.expires')}</th>
            <th scope="col">{t('perm.lastAccess')}</th>
            <th scope="col">
              <span className="ss-sr">{t('action.remove')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {list.grants.map((g) => (
            <tr key={`${g.principalType}:${g.principalId}`}>
              <td>
                <span className="ss-who">
                  <Avatar name={g.label} />
                  <span>
                    {g.label}{' '}
                    <Pill tone={g.principalType === 'GROUP' ? 'group' : 'muted'}>
                      {g.principalType === 'USER' ? t('perm.user') : t('perm.group')}
                    </Pill>
                    {g.principalType === 'USER' && g.principalId === list.ownerAccountId && (
                      <Pill tone="owner">{t('perm.owner')}</Pill>
                    )}
                    {!g.active && <Pill tone="danger">{t('perm.inactive')}</Pill>}
                  </span>
                </span>
              </td>
              <td>
                <select
                  aria-label={`${g.label}: ${t('nav.permissions')}`}
                  value={g.role}
                  onChange={(e) => {
                    const next = e.target.value as Role;
                    const hit = {
                      principalType: g.principalType,
                      principalId: g.principalId,
                      label: g.label,
                    };
                    if (next === 'ADMINISTER') setPendingAdmin({ hit });
                    else void upsert(hit, next);
                  }}
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {t(`role.${r}`)}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                {g.expiresAt ? (
                  Date.parse(g.expiresAt) > Date.now() ? (
                    <Pill tone="warn">{new Date(g.expiresAt).toLocaleDateString()}</Pill>
                  ) : (
                    <Pill tone="danger">
                      {t('perm.expires.expired', {
                        when: new Date(g.expiresAt).toLocaleDateString(),
                      })}
                    </Pill>
                  )
                ) : (
                  <span className="ss-muted">{t('perm.expires.never')}</span>
                )}
              </td>
              <td className="ss-muted">
                {g.lastAccessAt
                  ? new Date(g.lastAccessAt).toLocaleString()
                  : t('perm.lastAccess.never')}
              </td>
              <td>
                {g.expiresAt && Date.parse(g.expiresAt) <= Date.now() && (
                  <button
                    type="button"
                    className="ss-btn"
                    onClick={() =>
                      void upsert(
                        {
                          principalType: g.principalType,
                          principalId: g.principalId,
                          label: g.label,
                        },
                        g.role,
                        expiresAtFor('30'),
                      )
                    }
                  >
                    {t('perm.renew')}
                  </button>
                )}
                <button
                  type="button"
                  className="ss-btn ss-danger"
                  onClick={() => setPendingRevoke({ type: g.principalType, id: g.principalId })}
                >
                  {t('action.remove')}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {pendingRevoke && (
        <div
          role="alertdialog"
          aria-label={t('perm.confirm.revoke')}
          className="ss-callout ss-warn"
        >
          <p>{t('perm.confirm.revoke')}</p>
          <button
            type="button"
            className="ss-btn ss-danger"
            onClick={() =>
              apply(async () =>
                unwrap(
                  await api.call('revokeGrant', {
                    principalType: pendingRevoke.type,
                    principalId: pendingRevoke.id,
                    expectedAclVersion: list.aclVersion,
                  }),
                ),
              )
            }
          >
            {t('action.confirm')}
          </button>
          <button type="button" className="ss-btn" onClick={() => setPendingRevoke(null)}>
            {t('action.cancel')}
          </button>
        </div>
      )}
      {pendingAdmin && (
        <div role="alertdialog" aria-label={t('perm.confirm.admin')} className="ss-callout ss-warn">
          <p>
            <strong>{pendingAdmin.hit.label}</strong>: {t('perm.confirm.admin')}
          </p>
          <button
            type="button"
            className="ss-btn ss-danger"
            onClick={() => void upsert(pendingAdmin.hit, 'ADMINISTER', pendingAdmin.expiresAt)}
          >
            {t('action.confirm')}
          </button>
          <button type="button" className="ss-btn" onClick={() => setPendingAdmin(null)}>
            {t('action.cancel')}
          </button>
        </div>
      )}
      <p>
        <button type="button" className="ss-btn ss-primary" onClick={() => setAddOpen(true)}>
          {t('perm.add')}
        </button>
      </p>
      {addOpen && (
        <AddAccessDialog
          api={api}
          onClose={() => setAddOpen(false)}
          onError={(text) => setNotice({ kind: 'err', text })}
          onAdd={(hits, role, expiresAt) => {
            setAddOpen(false);
            if (role === 'ADMINISTER') {
              const hit = hits[0];
              if (hit) setPendingAdmin({ hit, expiresAt });
              return;
            }
            void apply(async () => {
              let version = list.aclVersion;
              let last = list;
              for (const h of hits) {
                last = unwrap(
                  await api.call('upsertGrant', {
                    principalType: h.principalType,
                    principalId: h.principalId,
                    role,
                    expectedAclVersion: version,
                    expiresAt,
                  }),
                );
                version = last.aclVersion;
              }
              return last;
            });
          }}
        />
      )}
      <h3>{t('perm.copy')}</h3>
      <form
        className="ss-row"
        onSubmit={(e) => {
          e.preventDefault();
          void apply(async () =>
            unwrap(
              await api.call('copyGrants', {
                sourceRef: sourceRef.trim(),
                expectedAclVersion: list.aclVersion,
              }),
            ),
          );
        }}
      >
        <label>
          {t('perm.copy.ref')}
          <input
            value={sourceRef}
            maxLength={64}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setSourceRef(e.target.value)}
          />
        </label>
        <button type="submit" className="ss-btn" disabled={sourceRef.trim() === ''}>
          {t('perm.copy.action')}
        </button>
      </form>
      <h3>{t('perm.seed')}</h3>
      <p className="ss-muted">{t('perm.seed.note')}</p>
      <button
        type="button"
        className="ss-btn"
        onClick={() =>
          void apply(async () =>
            unwrap(await api.call('seedPageRestrictions', { expectedAclVersion: list.aclVersion })),
          )
        }
      >
        {t('perm.seed')}
      </button>
    </Panel>
  );
}

export function EffectiveBox({ access }: { access: EffectiveAccess }) {
  const t = useT();
  return (
    <div className="ss-callout" aria-label={t('perm.effective')}>
      <strong>{t('perm.effective')}:</strong> <RoleLabel role={access.role} />
      <ul>
        {access.sources.map((s) => (
          <li key={`${s.via}:${s.principalId}`}>
            {s.via === 'GROUP' ? `${t('perm.group')}: ${s.label}` : t('perm.user')} →{' '}
            <RoleLabel role={s.role} />
          </li>
        ))}
        {!access.canEditPage && <li>{t('editor.pageEditRequired')}</li>}
      </ul>
      {access.groupResolution === 'DEGRADED' && <p role="alert">{t('perm.groupDegraded')}</p>}
    </div>
  );
}

// ------------------------------------------------------------------ History

export function HistoryPanel({
  api,
  baseVersion,
  canWrite,
  onRestored,
}: {
  api: Api;
  baseVersion: number;
  canWrite: boolean;
  onRestored: () => void;
}) {
  const t = useT();
  const hist = useLoad<RevisionList>(async () => unwrap(await api.call('listRevisions', {})));
  const [preview, setPreview] = useState<{ version: number; doc: RichDoc } | null>(null);
  const [compare, setCompare] = useState<{
    from: number;
    to: number;
    lines: ReturnType<typeof diffDocs>;
    left: RichDoc;
    right: RichDoc;
  } | null>(null);
  const [fromVersion, setFromVersion] = useState('');
  const [toVersion, setToVersion] = useState('');
  const [tagDraft, setTagDraft] = useState<Record<number, string>>({});
  const [confirm, setConfirm] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (hist.loading) return <Loading />;
  if (hist.error || !hist.data)
    return <ErrorBox error={hist.error ?? new ApiError('UNAVAILABLE')} onRetry={hist.reload} />;
  const fmt = (iso: string) => new Date(iso).toLocaleString();
  const current = hist.data.revisions.reduce((max, r) => Math.max(max, r.version), 0);
  const openCompare = async (from: number, to: number) => {
    const [a, b] = await Promise.all([
      safeCall(api, 'getRevision', { version: from }),
      safeCall(api, 'getRevision', { version: to }),
    ]);
    if (a.ok && b.ok) {
      setCompare({
        from,
        to,
        lines: diffDocs(a.data.doc, b.data.doc),
        left: a.data.doc,
        right: b.data.doc,
      });
    } else setError(t('error.generic'));
  };

  return (
    <Panel title={t('history.title')}>
      {hist.data.revisions.length <= 1 && <p className="ss-muted">{t('history.empty')}</p>}
      {hist.data.revisions.length > 1 && (
        <form
          className="ss-row"
          onSubmit={(e) => {
            e.preventDefault();
            void openCompare(Number(fromVersion), Number(toVersion));
          }}
        >
          <label>
            {t('history.compare.pick')}
            <select
              aria-label={t('history.compare.from')}
              value={fromVersion}
              onChange={(e) => setFromVersion(e.target.value)}
            >
              <option value="">{t('history.compare.from')}</option>
              {hist.data.revisions.map((r) => (
                <option key={`from-${r.version}`} value={r.version}>
                  v{r.version}
                  {r.tag ? ` · ${r.tag}` : ''}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="ss-sr">{t('history.compare.to')}</span>
            <select
              aria-label={t('history.compare.to')}
              value={toVersion}
              onChange={(e) => setToVersion(e.target.value)}
            >
              <option value="">{t('history.compare.to')}</option>
              {hist.data.revisions.map((r) => (
                <option key={`to-${r.version}`} value={r.version}>
                  v{r.version}
                  {r.tag ? ` · ${r.tag}` : ''}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="ss-btn"
            disabled={fromVersion === '' || toVersion === '' || fromVersion === toVersion}
          >
            {t('history.compare.any')}
          </button>
        </form>
      )}
      <ol className="ss-history">
        {hist.data.revisions.map((r) => (
          <li
            key={r.version}
            className={r.version === current ? 'ss-version is-current' : 'ss-version'}
          >
            <div className="ss-version-head">
              <strong>v{r.version}</strong>
              {r.version === current && <Pill tone="ok">{t('history.current')}</Pill>}
              {r.tag && <Pill tone="warn">{r.tag}</Pill>}
            </div>
            <span className="ss-muted">
              {r.author?.displayName ?? '—'} · {fmt(r.createdAt)}
              {r.restoredFrom ? ` · ↩ v${r.restoredFrom}` : ''}
              {r.changeNote ? ` · ${r.changeNote}` : ''}
            </span>
            {canWrite && (
              <form
                className="ss-row"
                onSubmit={(e) => {
                  e.preventDefault();
                  void (async () => {
                    const res = await safeCall(api, 'setRevisionTag', {
                      version: r.version,
                      tag: (tagDraft[r.version] ?? r.tag ?? '').trim() || null,
                    });
                    if (res.ok) hist.reload();
                    else setError(t('error.generic'));
                  })();
                }}
              >
                <label>
                  <span className="ss-sr">{t('history.tag')}</span>
                  <input
                    aria-label={`${t('history.tag')} v${r.version}`}
                    maxLength={40}
                    value={tagDraft[r.version] ?? r.tag ?? ''}
                    onChange={(e) =>
                      setTagDraft((cur) => ({ ...cur, [r.version]: e.target.value }))
                    }
                  />
                </label>
                <button type="submit" className="ss-btn">
                  {t('history.tag.save')}
                </button>
              </form>
            )}
            <button
              type="button"
              className="ss-btn"
              onClick={async () => {
                const res = await safeCall(api, 'getRevision', { version: r.version });
                if (res.ok) setPreview({ version: r.version, doc: res.data.doc });
                else setError(t('error.generic'));
              }}
            >
              {t('nav.content')}
            </button>
            {canWrite && r.version !== baseVersion && (
              <button type="button" className="ss-btn" onClick={() => setConfirm(r.version)}>
                {t('action.restore')}
              </button>
            )}
            {r.version > 1 && (
              <button
                type="button"
                className="ss-btn"
                onClick={() => void openCompare(r.version - 1, r.version)}
              >
                {t('history.compare')}
              </button>
            )}
          </li>
        ))}
      </ol>
      {error && <p role="alert">{error}</p>}
      {confirm !== null && (
        <div
          role="alertdialog"
          aria-label={t('history.restoreConfirm')}
          className="ss-callout ss-warn"
        >
          <p>{t('history.restoreConfirm')}</p>
          <button
            type="button"
            className="ss-btn ss-primary"
            onClick={async () => {
              const res = await safeCall(api, 'restoreRevision', { version: confirm, baseVersion });
              setConfirm(null);
              if (res.ok) onRestored();
              else
                setError(res.code === 'CONFLICT' ? t('editor.conflict.title') : t('error.generic'));
            }}
          >
            {t('action.confirm')}
          </button>
          <button type="button" className="ss-btn" onClick={() => setConfirm(null)}>
            {t('action.cancel')}
          </button>
        </div>
      )}
      {preview && (
        <div className="ss-preview" aria-label={`v${preview.version}`}>
          <h3>v{preview.version}</h3>
          <RichRenderer doc={preview.doc} />
          <button type="button" className="ss-btn" onClick={() => setPreview(null)}>
            {t('action.close')}
          </button>
        </div>
      )}
      {compare && (
        <div
          className="ss-preview"
          aria-label={t('history.compare.title', { from: compare.from, to: compare.to })}
        >
          <h3>{t('history.compare.title', { from: compare.from, to: compare.to })}</h3>
          <div className="ss-side">
            <div>
              <h4>v{compare.from}</h4>
              <RichRenderer doc={compare.left} />
            </div>
            <div>
              <h4>v{compare.to}</h4>
              <RichRenderer doc={compare.right} />
            </div>
          </div>
          {compare.lines.every((l) => l.kind === 'equal') ? (
            <p className="ss-muted">{t('history.compare.empty')}</p>
          ) : (
            <>
              <p className="ss-muted">
                {t('history.compare.stats', {
                  added: compare.lines.filter((l) => l.kind === 'add').length,
                  removed: compare.lines.filter((l) => l.kind === 'del').length,
                })}
              </p>
              <pre
                className="ss-diff"
                aria-label={t('history.compare.title', { from: compare.from, to: compare.to })}
              >
                {compare.lines.map((l, i) => (
                  <span key={i} className={`ss-diff-${l.kind}`}>
                    {l.kind === 'add' ? '+ ' : l.kind === 'del' ? '- ' : '  '}
                    {l.text || ' '}
                    {'\n'}
                  </span>
                ))}
              </pre>
            </>
          )}
          <button type="button" className="ss-btn" onClick={() => setCompare(null)}>
            {t('history.closeCompare')}
          </button>
        </div>
      )}
    </Panel>
  );
}

// ------------------------------------------------------------------ Audit

export function AuditPanel({ api }: { api: Api }) {
  const t = useT();
  const first = useLoad<AuditList>(async () => unwrap(await api.call('listAudit', {})));
  const [more, setMore] = useState<AuditList | null>(null);
  const data = more ?? first.data;
  if (first.loading) return <Loading />;
  if (first.error || !data)
    return <ErrorBox error={first.error ?? new ApiError('UNAVAILABLE')} onRetry={first.reload} />;
  return (
    <Panel title={t('audit.title')}>
      <p className="ss-muted">{t('audit.note')}</p>
      <p
        role={data.chain === 'BROKEN' ? 'alert' : 'status'}
        className={data.chain === 'BROKEN' ? 'ss-err' : 'ss-muted'}
      >
        {t(`audit.chain.${data.chain}`)}
      </p>
      <ul className="ss-audit">
        {data.entries.map((e) => (
          <li key={e.id}>
            <time dateTime={e.at}>{new Date(e.at).toLocaleString()}</time> · {e.action}
          </li>
        ))}
      </ul>
      {data.nextCursor && (
        <button
          type="button"
          className="ss-btn"
          onClick={async () => {
            const res = await safeCall(api, 'listAudit', { cursor: data.nextCursor });
            if (res.ok) setMore({ ...res.data, entries: [...data.entries, ...res.data.entries] });
          }}
        >
          {t('action.add')}
        </button>
      )}
    </Panel>
  );
}

// ------------------------------------------------------------------ Help, diagnostics, reference

export function HelpPanel({ api, userRole }: { api: Api; userRole: Role | null }) {
  const t = useT();
  const [ref, setRef] = useState<string | null>(null);
  const [showDiag, setShowDiag] = useState(false);
  return (
    <Panel title={t('help.title')}>
      <ul>
        <li>{t('help.cannotSee')}</li>
        <li>{t('help.noEdit')}</li>
        <li>{t('help.copyPage')}</li>
        <li>{t('wizard.copyWarning')}</li>
      </ul>
      {userRole === 'ADMINISTER' && (
        <div>
          <button
            type="button"
            className="ss-btn"
            onClick={async () => {
              const res = await safeCall(api, 'getShareReference', {});
              if (res.ok) setRef(res.data.sectionRef);
            }}
          >
            {t('action.copyRef')}
          </button>
          {ref && (
            <p>
              <code aria-label={t('bind.ref')}>{ref}</code>
              <br />
              <span className="ss-muted">{t('ref.warning')}</span>
            </p>
          )}
        </div>
      )}
      <button type="button" className="ss-btn" onClick={() => setShowDiag((v) => !v)}>
        {t('nav.admin')}
      </button>
      {showDiag && <DiagnosticsPanel api={api} />}
    </Panel>
  );
}

export function DiagnosticsPanel({ api }: { api: Api }) {
  const t = useT();
  const d = useLoad<Diagnostics>(async () => unwrap(await api.call('getDiagnostics', {})));
  const [newAdmin, setNewAdmin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  if (d.loading) return <Loading />;
  if (d.error || !d.data) return <p className="ss-muted">{t('error.denied')}</p>;
  return (
    <div className="ss-panel">
      <h3>{t('admin.title')}</h3>
      <p className="ss-muted">{t('admin.note')}</p>
      <ul>
        {d.data.checks.map((c) => (
          <li key={c.name}>
            {c.name}: {c.status}
          </li>
        ))}
      </ul>
      <h3>{t('recover.title')}</h3>
      <p>{t('recover.body')}</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const res = await safeCall(api, 'recoverSection', {
            newAdministratorAccountId: newAdmin.trim(),
            confirm,
          });
          setMsg(
            res.ok
              ? t('perm.saved')
              : res.code === 'NOT_RECOVERABLE'
                ? t('error.denied')
                : t('error.generic'),
          );
        }}
      >
        <label>
          Account ID
          <input value={newAdmin} onChange={(e) => setNewAdmin(e.target.value)} maxLength={128} />
        </label>
        <label>
          RECOVER
          <input value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
        </label>
        <button
          type="submit"
          className="ss-btn ss-danger"
          disabled={confirm !== 'RECOVER' || newAdmin.trim() === ''}
        >
          {t('action.confirm')}
        </button>
      </form>
      <p role="status">{msg}</p>
    </div>
  );
}
