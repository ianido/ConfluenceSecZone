import { useCallback, useEffect, useState } from 'react';
import {
  REQUESTABLE_ROLES,
  REQUEST_REASON_MAX_LENGTH,
  isRequestableRole,
  type AccessInfo,
  type AccessRequestList,
  type RequestableRole,
} from '@secure-sections/shared';
import { ApiError, safeCall, unwrap, type Api } from './api';
import { ClassificationBadge } from './Header';
import { useT } from './i18n';

/** Shown to page viewers without a grant: public details, whom to ask, and the request form. */
export function AccessRequestBox({
  api,
  info,
  onInfo,
}: {
  api: Api;
  info: AccessInfo;
  onInfo: (i: AccessInfo) => void;
}) {
  const t = useT();
  const [role, setRole] = useState<RequestableRole>('VIEW');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const run = async (fn: () => Promise<AccessInfo>, okText: string) => {
    setBusy(true);
    try {
      onInfo(await fn());
      setNotice({ ok: true, text: okText });
    } catch (e) {
      setNotice({
        ok: false,
        text:
          e instanceof ApiError && e.code === 'RATE_LIMITED'
            ? t('error.rate')
            : t('access.request.error'),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ss-access">
      {(info.title || info.classification) && (
        <p className="ss-access-title">
          {info.title && <strong>{info.title}</strong>}{' '}
          <ClassificationBadge value={info.classification} />
        </p>
      )}
      {info.administrators.length > 0 && (
        <p className="ss-muted">
          {t('access.admins', { names: info.administrators.map((a) => a.displayName).join(', ') })}
        </p>
      )}
      {info.myRequest ? (
        <div className="ss-callout" role="status">
          <p>
            {t('access.pending', {
              role: t(`role.${info.myRequest.role}`),
              when: new Date(info.myRequest.requestedAt).toLocaleString(),
            })}
          </p>
          {info.myRequest.reason && <p className="ss-muted">“{info.myRequest.reason}”</p>}
          <p className="ss-muted">{t('access.pending.note')}</p>
          <button
            type="button"
            className="ss-btn"
            disabled={busy}
            onClick={() =>
              void run(
                async () => unwrap(await api.call('cancelAccessRequest', {})),
                t('access.request.cancelled'),
              )
            }
          >
            {t('access.cancel')}
          </button>
        </div>
      ) : (
        <form
          className="ss-callout ss-request"
          aria-label={t('access.request.title')}
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              async () =>
                unwrap(
                  await api.call('requestAccess', {
                    role,
                    ...(reason.trim() ? { reason: reason.trim() } : {}),
                  }),
                ),
              t('access.request.sent'),
            );
          }}
        >
          <h3>{t('access.request.title')}</h3>
          <label>
            {t('access.request.level')}
            <select
              value={role}
              onChange={(e) => {
                const v = e.target.value;
                if (isRequestableRole(v)) setRole(v);
              }}
            >
              {REQUESTABLE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {t(`role.${r}`)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('access.request.reason')}
            <input
              value={reason}
              maxLength={REQUEST_REASON_MAX_LENGTH}
              placeholder={t('access.request.reasonPlaceholder')}
              onChange={(e) => setReason(e.target.value)}
              autoComplete="off"
            />
          </label>
          <p className="ss-muted ss-meta-note">{t('access.request.note')}</p>
          <button type="submit" className="ss-btn ss-primary" disabled={busy}>
            {t('access.request.send')}
          </button>
        </form>
      )}
      <div role="status" aria-live="polite">
        {notice && <p className={notice.ok ? 'ss-ok' : 'ss-err'}>{notice.text}</p>}
      </div>
    </div>
  );
}

/** Pending access requests for administrators, with approve / reject. */
export function RequestsQueue({
  api,
  aclVersion,
  onResolved,
  onCount,
}: {
  api: Api;
  aclVersion: number;
  onResolved: () => void;
  onCount?: (n: number) => void;
}) {
  const t = useT();
  const [list, setList] = useState<AccessRequestList | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const res = await safeCall(api, 'listAccessRequests', {});
    if (res.ok) setList(res.data);
  }, [api]);

  useEffect(() => {
    void load();
    // Reload when the ACL changes elsewhere on this panel (a grant also clears its request).
  }, [load, aclVersion]);

  useEffect(() => {
    if (list) onCount?.(list.requests.length);
  }, [list, onCount]);

  const decide = async (
    accountId: string,
    decision: 'APPROVE' | 'REJECT',
    role: RequestableRole,
  ) => {
    try {
      const next = unwrap(
        await api.call('resolveAccessRequest', {
          accountId,
          decision,
          role,
          expectedAclVersion: list?.aclVersion ?? aclVersion,
        }),
      );
      setList(next);
      setNotice({
        ok: true,
        text: decision === 'APPROVE' ? t('requests.approved') : t('requests.rejected'),
      });
      if (decision === 'APPROVE') onResolved();
    } catch (e) {
      setNotice({
        ok: false,
        text: e instanceof ApiError && e.code === 'DENIED' ? t('error.denied') : t('perm.conflict'),
      });
      void load();
    }
  };

  if (!list || list.requests.length === 0) {
    return (
      <div role="status" aria-live="polite">
        {notice && <p className={notice.ok ? 'ss-ok' : 'ss-err'}>{notice.text}</p>}
      </div>
    );
  }

  return (
    <section className="ss-callout ss-warn" aria-label={t('requests.badge')}>
      <h3>{t('requests.title', { count: list.requests.length })}</h3>
      <ul className="ss-requests">
        {list.requests.map((r) => (
          <li key={r.accountId}>
            <span>
              <strong>
                {t('requests.wants', { name: r.displayName, role: t(`role.${r.role}`) })}
              </strong>
              <br />
              <span className="ss-muted">{r.reason || t('requests.noReason')}</span>
              {!r.active && <span className="ss-chip ss-chip-warn">{t('requests.inactive')}</span>}
            </span>
            <span className="ss-actions">
              <button
                type="button"
                className="ss-btn ss-primary"
                disabled={!r.active}
                onClick={() => void decide(r.accountId, 'APPROVE', r.role)}
              >
                {t('requests.approve')}
                <span className="ss-sr"> {r.displayName}</span>
              </button>
              <button
                type="button"
                className="ss-btn"
                onClick={() => void decide(r.accountId, 'REJECT', r.role)}
              >
                {t('requests.reject')}
                <span className="ss-sr"> {r.displayName}</span>
              </button>
            </span>
          </li>
        ))}
      </ul>
      <div role="status" aria-live="polite">
        {notice && <p className={notice.ok ? 'ss-ok' : 'ss-err'}>{notice.text}</p>}
      </div>
    </section>
  );
}
