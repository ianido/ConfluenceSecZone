import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import {
  DEFAULT_VIEWER_CHROME,
  EMPTY_DOC,
  type RequestOf,
  type ResolverFunction,
  type ResponseOf,
  type SectionView,
} from '@secure-sections/shared';
import type { Api } from './api';
import { I18nProvider } from './i18n';

type Handler = (payload: unknown) => unknown;

/** Scripted UI-level API double. Used for component tests only; it is not backend evidence. */
export function scriptedApi(handlers: Partial<Record<ResolverFunction, Handler>>): Api & {
  calls: Array<{ fn: string; payload: unknown }>;
} {
  const calls: Array<{ fn: string; payload: unknown }> = [];
  return {
    calls,
    async call<K extends ResolverFunction>(fn: K, payload?: RequestOf<K>): Promise<ResponseOf<K>> {
      calls.push({ fn, payload });
      const h = handlers[fn];
      if (!h) throw new Error(`unscripted ${fn}`);
      return (await h(payload)) as ResponseOf<K>;
    },
  };
}

export function readyView(
  partial: Partial<Extract<SectionView, { state: 'READY' }>> = {},
): SectionView {
  return {
    state: 'READY',
    role: 'ADMINISTER',
    canWrite: true,
    canEditPage: true,
    aclVersion: 1,
    meta: { title: null, classification: null, sharedWith: { users: 1, groups: 0 } },
    notice: null,
    protection: {
      watermark: false,
      autoLockMinutes: null,
      protectCopy: false,
      viewerName: 'Alice',
      lockByDefault: true,
    },
    viewer: { ...DEFAULT_VIEWER_CHROME },
    content: {
      doc: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Quarterly numbers' }] }],
      },
      version: 1,
      updatedAt: '2026-01-01T00:00:00.000Z',
      updatedBy: { accountId: 'a', displayName: 'Alice' },
    },
    ...partial,
  };
}

export const emptyReady = readyView({
  content: { doc: EMPTY_DOC, version: 1, updatedAt: '2026-01-01T00:00:00.000Z', updatedBy: null },
});

export function renderWithI18n(ui: ReactElement, locale: 'en' | 'es' = 'en') {
  return render(<I18nProvider locale={locale}>{ui}</I18nProvider>);
}
