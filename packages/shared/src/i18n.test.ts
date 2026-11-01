import { describe, expect, it } from 'vitest';
import { LOCALES, catalogKeys, resolveLocale, t } from './i18n.js';

describe('i18n', () => {
  it('has identical key sets in every locale', () => {
    const base = new Set(catalogKeys('en'));
    for (const l of LOCALES) {
      const keys = new Set(catalogKeys(l));
      expect([...base].filter((k) => !keys.has(k))).toEqual([]);
      expect([...keys].filter((k) => !base.has(k))).toEqual([]);
    }
  });

  it('has no empty strings and Spanish differs from English for the user-facing basics', () => {
    for (const l of LOCALES)
      for (const k of catalogKeys(l)) expect(t(l, k).trim().length).toBeGreaterThan(0);
    expect(t('es', 'action.save')).not.toBe(t('en', 'action.save'));
    expect(t('es', 'state.denied.title')).not.toBe(t('en', 'state.denied.title'));
  });

  it('resolves locales safely', () => {
    expect(resolveLocale('es-ES')).toBe('es');
    expect(resolveLocale('es')).toBe('es');
    expect(resolveLocale('en-GB')).toBe('en');
    expect(resolveLocale('xx')).toBe('en');
    expect(resolveLocale(undefined)).toBe('en');
    expect(resolveLocale('__proto__')).toBe('en');
  });

  it('error copy never embeds protected content placeholders', () => {
    for (const l of LOCALES)
      for (const k of catalogKeys(l)) expect(t(l, k)).not.toMatch(/\{\{|undefined|\[object/);
  });
});
