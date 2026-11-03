import { useEffect, useState } from 'react';
import type { PageSectionRow } from '@secure-sections/shared';
import { safeCall, type Api } from './api';
import { useT } from './i18n';

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
        <ul>
          {rows.map((r) => (
            <li key={r.localId}>
              <strong>{r.title ?? t('home.untitled')}</strong>
              {r.classification ? ` · ${t(`class.${r.classification}`)}` : ''} ·{' '}
              {r.role ? t(`role.${r.role}`) : t('byline.request')}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
