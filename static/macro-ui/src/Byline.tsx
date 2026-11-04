import { useEffect, useState } from 'react';
import type { PageSectionRow } from '@secure-sections/shared';
import { safeCall, type Api } from './api';
import { ClassificationBadge } from './Header';
import { useT } from './i18n';
import { LockIcon, Pill } from './visual';

/** Page byline: titles and the caller's access only. Never the protected content. */
export function Byline({ api }: { api: Api }) {
  const t = useT();
  const [rows, setRows] = useState<PageSectionRow[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let live = true;
    void safeCall(api, 'listPageSections', {}).then((res) => {
      if (!live) return;
      if (res.ok) setRows(res.data.sections);
      else setError(true);
    });
    return () => {
      live = false;
    };
  }, [api]);
  if (error) return <p role="alert">{t('error.generic')}</p>;
  if (!rows) return <p role="status">{t('state.loading')}</p>;
  return (
    <section aria-label={t('byline.title')}>
      <h2>{t('byline.title')}</h2>
      {rows.length === 0 ? (
        <p className="ss-muted">{t('byline.empty')}</p>
      ) : (
        <ul className="ss-byline">
          {rows.map((r) => (
            <li key={r.localId}>
              <span className="ss-byline-title">
                <LockIcon />
                <strong>{r.title ?? t('home.untitled')}</strong>
                <ClassificationBadge value={r.classification} />
              </span>
              <Pill tone={r.role ? 'ok' : 'muted'}>
                {r.role ? t(`role.${r.role}`) : t('role.none')}
              </Pill>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
