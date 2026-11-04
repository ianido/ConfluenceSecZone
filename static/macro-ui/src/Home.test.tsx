import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import type { MySections } from '@secure-sections/shared';
import { Home } from './Home';
import { renderWithI18n, scriptedApi } from './testing';

const longTitle = 'Quarterly planning notes for the engineering space that should stay on one line';

const data: MySections = {
  truncated: false,
  kpis: { administered: 1, pendingRequests: 0, expiringGrants: 0, inactive: 0 },
  activity: [],
  rows: [
    {
      sectionId: 's1',
      title: 'Secrets',
      classification: 'RESTRICTED',
      pageId: '2134310913',
      pageTitle: longTitle,
      spaceKey: 'ENG',
      pageStatus: 'OK',
      role: 'ADMINISTER',
      sharedUsers: 1,
      updatedAt: '2026-11-03T11:46:23.000Z',
    },
  ],
};

describe('My secure sections page column', () => {
  it('shows the page title, and the id plus the full title on hover', async () => {
    const api = scriptedApi({ listMySections: () => ({ ok: true, data }) });
    renderWithI18n(<Home api={api} />);
    const tip = `[2134310913] : ${longTitle}`;
    const label = await screen.findByTitle(tip);
    expect(label.textContent).toContain(longTitle);
    expect(label.textContent).not.toContain('2134310913');
    expect(label.className).toContain('ss-clip');
    expect(screen.getByRole('tooltip').textContent).toBe(tip);
  });

  it('falls back to the page id when the title is unavailable', async () => {
    const api = scriptedApi({
      listMySections: () => ({
        ok: true,
        data: {
          ...data,
          rows: [{ ...data.rows[0]!, pageTitle: null, pageStatus: 'MISSING' as const }],
        },
      }),
    });
    renderWithI18n(<Home api={api} />);
    const label = await screen.findByTitle('[2134310913]');
    expect(label.textContent).toBe('2134310913');
  });
});
