import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
    const opened: Array<{ pageId: string; href: string }> = [];
    renderWithI18n(
      <Home
        api={api}
        siteUrl="https://example.atlassian.net/wiki"
        openPage={(pageId, href) => {
          opened.push({ pageId, href });
        }}
      />,
    );
    const tip = `[2134310913] : ${longTitle}`;
    const href = 'https://example.atlassian.net/wiki/pages/viewpage.action?pageId=2134310913';
    const label = await screen.findByRole('link', { name: longTitle });
    expect(label.getAttribute('href')).toBe(href);
    expect(label.getAttribute('target')).toBeNull();
    expect(label.getAttribute('title')).toBe(tip);
    expect(label.textContent).not.toContain('2134310913');
    expect(screen.getByRole('tooltip').textContent).toBe(tip);
    await userEvent.click(label);
    expect(opened).toEqual([{ pageId: '2134310913', href }]);
  });

  it('does not link a page that no longer exists', async () => {
    const api = scriptedApi({
      listMySections: () => ({
        ok: true,
        data: {
          ...data,
          rows: [{ ...data.rows[0]!, pageTitle: null, pageStatus: 'MISSING' as const }],
        },
      }),
    });
    renderWithI18n(<Home api={api} siteUrl="https://example.atlassian.net" />);
    const label = await screen.findByTitle('[2134310913]');
    expect(label.textContent).toBe('2134310913');
    expect(label.tagName).toBe('BUTTON');
    expect(label.getAttribute('type')).toBe('button');
    expect(screen.queryByRole('link')).toBeNull();
    await userEvent.click(label);
    expect(label.parentElement?.className).toContain('ss-tip-open');
    await userEvent.keyboard('{Escape}');
    expect(label.parentElement?.className).not.toContain('ss-tip-open');
    expect(document.activeElement).toBe(label);
  });

  it('hides the page tooltip on Escape until the pointer leaves and returns', async () => {
    const api = scriptedApi({ listMySections: () => ({ ok: true, data }) });
    renderWithI18n(<Home api={api} siteUrl="https://example.atlassian.net" />);
    const label = await screen.findByRole('link', { name: longTitle });
    await userEvent.hover(label);
    expect(label.parentElement?.className).toContain('ss-tip-open');
    await userEvent.keyboard('{Escape}');
    expect(label.parentElement?.className).not.toContain('ss-tip-open');
    await userEvent.unhover(label);
    await userEvent.hover(label);
    expect(label.parentElement?.className).toContain('ss-tip-open');
  });

  it('keeps the list on screen when opening the page fails', async () => {
    const api = scriptedApi({ listMySections: () => ({ ok: true, data }) });
    renderWithI18n(
      <Home
        api={api}
        siteUrl="https://example.atlassian.net"
        openPage={() => {
          throw new Error('bridge');
        }}
      />,
    );
    await userEvent.click(await screen.findByRole('link', { name: longTitle }));
    expect(screen.getByRole('alert').textContent).toContain('Something went wrong');
    expect(screen.getByRole('link', { name: longTitle })).toBeTruthy();
  });
});
