import { describe, expect, it } from 'vitest';
import { exportPlaceholderAdf } from './export.js';

describe('adfExport', () => {
  it('returns a static placeholder with no dynamic input', () => {
    const a = exportPlaceholderAdf();
    expect(exportPlaceholderAdf()).toEqual(a);
    expect(a.type).toBe('doc');
    expect(JSON.stringify(a)).toContain('not included in exports');
  });

  it('takes no arguments and so cannot reference storage or the caller', () => {
    expect(exportPlaceholderAdf.length).toBe(0);
  });
});
