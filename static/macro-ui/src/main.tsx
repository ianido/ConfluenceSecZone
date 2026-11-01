import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { view } from '@forge/bridge';
import { resolveLocale, type Locale } from '@secure-sections/shared';
import { forgeApi } from './api';
import { App } from './App';
import { I18nProvider } from './i18n';
import './styles.css';

function Root() {
  const [locale, setLocale] = useState<Locale>('en');
  useEffect(() => {
    // Display-only: the locale picks UI strings. Nothing here is used for authorization.
    void view.theme.enable().catch(() => undefined);
    void view
      .getContext()
      .then((c) => setLocale(resolveLocale(typeof c.locale === 'string' ? c.locale : undefined)))
      .catch(() => undefined);
  }, []);
  return (
    <I18nProvider locale={locale}>
      <App api={forgeApi} />
    </I18nProvider>
  );
}

const el = document.getElementById('root');
if (el) {
  createRoot(el).render(
    <StrictMode>
      <Root />
    </StrictMode>,
  );
}
