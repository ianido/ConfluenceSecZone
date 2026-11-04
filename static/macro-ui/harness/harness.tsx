/**
 * UI test harness. NOT shipped (the production build only includes ../index.html).
 * It mounts the real UI against the real resolver handlers + domain service running in the Vite
 * dev-server process on an in-memory store and a fake Confluence. This verifies UI <-> domain
 * integration; it is NOT evidence of Forge bridge, KVS or Confluence behaviour.
 */
import { createRoot } from 'react-dom/client';
import { resolveLocale } from '@secure-sections/shared';
import type { Api } from '../src/api';
import { App } from '../src/App';
import { Home } from '../src/Home';
import { I18nProvider } from '../src/i18n';
import '../src/styles.css';

const q = new URLSearchParams(location.search);
const actor = q.get('actor') ?? 'alice';
const pageId = q.get('page') ?? '1001';
const localId = q.get('local') ?? 'aaaaaaaa-0000-4000-8000-000000000001';
const locale = resolveLocale(q.get('locale') ?? 'en');
const surface = q.get('surface') ?? 'macro';
const siteUrl = q.get('site') ?? 'https://example.atlassian.net';
if (q.get('dark') === '1') document.documentElement.dataset.theme = 'dark';

const api: Api = {
  async call(fn, payload) {
    const res = await fetch(`/__invoke/${fn}?${new URLSearchParams({ actor, pageId, localId })}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload ?? {}),
    });
    if (!res.ok) throw new Error(`harness ${res.status}`);
    return (await res.json()) as never;
  },
};

createRoot(document.getElementById('root')!).render(
  <I18nProvider locale={locale}>
    {surface === 'home' ? <Home api={api} siteUrl={siteUrl} /> : <App api={api} />}
  </I18nProvider>,
);
