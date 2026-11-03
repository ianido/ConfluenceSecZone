import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { view } from '@forge/bridge';
import { resolveLocale, type Locale } from '@secure-sections/shared';
import { forgeApi } from './api';
import { Admin } from './Admin';
import { App } from './App';
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
  useEffect(() => {
    // Display-only: the locale and module pick which screen to render. Authorization stays server-side.
    void view.theme.enable().catch(() => undefined);
    void view
      .getContext()
      .then((c) => {
        setLocale(resolveLocale(typeof c.locale === 'string' ? c.locale : undefined));
        setSurface(surfaceOf(c));
      })
      .catch(() => undefined);
  }, []);
  const screen =
    surface === 'home' ? (
      <Home api={forgeApi} />
    ) : surface === 'admin' ? (
      <Admin api={forgeApi} />
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
