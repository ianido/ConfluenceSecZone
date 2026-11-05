import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { view } from '@forge/bridge';
import { resolveLocale, type Locale } from '@secure-sections/shared';
import { forgeApi } from './api';
import { Admin } from './Admin';
import { App } from './App';
import { Byline } from './Byline';
import { Home } from './Home';
import { I18nProvider } from './i18n';
import './styles.css';

type Surface = 'macro' | 'home' | 'admin' | 'byline';

function surfaceOf(c: { moduleKey?: unknown; extension?: { type?: unknown } }): Surface {
  const key = typeof c.moduleKey === 'string' ? c.moduleKey : '';
  const type = typeof c.extension?.type === 'string' ? c.extension.type : '';
  if (key.includes('admin') || type.includes('globalSettings')) return 'admin';
  if (key.includes('byline') || type.includes('contentByline')) return 'byline';
  if (key.includes('home') || type.includes('globalPage')) return 'home';
  return 'macro';
}

function Root() {
  const [locale, setLocale] = useState<Locale>('en');
  const [surface, setSurface] = useState<Surface>('macro');
  const [siteUrl, setSiteUrl] = useState<string | null>(null);
  useEffect(() => {
    // Display-only: the locale, module and site URL pick which screen to render and where page
    // links go. Authorization stays server-side.
    void view.theme.enable().catch(() => undefined);
    void view
      .getContext()
      .then((c) => {
        const raw = c as { locale?: unknown; siteUrl?: unknown };
        setLocale(resolveLocale(typeof raw.locale === 'string' ? raw.locale : undefined));
        setSurface(surfaceOf(c));
        setSiteUrl(typeof raw.siteUrl === 'string' ? raw.siteUrl : null);
      })
      .catch(() => undefined);
  }, []);
  const screen =
    surface === 'home' ? (
      <Home api={forgeApi} siteUrl={siteUrl} />
    ) : surface === 'admin' ? (
      <Admin api={forgeApi} />
    ) : surface === 'byline' ? (
      <Byline api={forgeApi} />
    ) : (
      <App api={forgeApi} />
    );
  return <I18nProvider locale={locale}>{screen}</I18nProvider>;
}

const el = document.getElementById('root');
if (el) {
  createRoot(el).render(
    <StrictMode>
      <Root />
    </StrictMode>,
  );
}
