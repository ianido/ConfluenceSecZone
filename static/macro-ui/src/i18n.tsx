import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { t, type Locale, type MessageKey } from '@secure-sections/shared';

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

const I18nContext = createContext<Translate>((key) => key);

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const fn = useMemo<Translate>(() => (key, params) => t(locale, key, params), [locale]);
  return <I18nContext.Provider value={fn}>{children}</I18nContext.Provider>;
}

export function useT(): Translate {
  return useContext(I18nContext);
}
