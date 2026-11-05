import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_VIEWER_CHROME, type AdminOverview } from '@secure-sections/shared';
import { Admin } from './Admin';
import { renderWithI18n, scriptedApi } from './testing';

const overview: AdminOverview = {
  sectionCount: 0,
  truncated: false,
  noAdmin: [],
  orphans: [],
  lastSweep: null,
  retention: {
    revisionsKeep: 50,
    revisionsMaxAgeDays: 365,
    auditMaxAgeDays: 730,
    deletedSectionGraceDays: 30,
  },
  policy: {
    allowRequests: true,
    maxGrantDays: 365,
    requireChangeNote: false,
    lockByDefault: true,
    whoMayCreate: 'PAGE_EDITORS',
    viewer: { ...DEFAULT_VIEWER_CHROME },
    classes: [
      { id: 'INTERNAL', watermark: false, autoLockMinutes: null, protectCopy: false },
      { id: 'CONFIDENTIAL', watermark: false, autoLockMinutes: null, protectCopy: false },
      { id: 'RESTRICTED', watermark: true, autoLockMinutes: 5, protectCopy: true },
    ],
  },
};

describe('Site policy', () => {
  it('saves open-locked from the Policies switch, which starts on', async () => {
    const api = scriptedApi({
      getAdminOverview: () => ({ ok: true, data: overview }),
      updateSitePolicy: (payload) => ({
        ok: true,
        data: { ...overview, policy: (payload as { policy: AdminOverview['policy'] }).policy },
      }),
    });
    renderWithI18n(<Admin api={api} />);
    const sw = await screen.findByRole('checkbox', { name: 'Open sections locked' });
    expect((sw as HTMLInputElement).checked).toBe(true);
    await userEvent.click(sw);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(api.calls.find((c) => c.fn === 'updateSitePolicy')?.payload).toMatchObject({
      policy: { lockByDefault: false },
    });
  });

  it('disables the access count when the title is hidden, and saves a quiet reader view', async () => {
    const api = scriptedApi({
      getAdminOverview: () => ({ ok: true, data: overview }),
      updateSitePolicy: (payload) => ({
        ok: true,
        data: { ...overview, policy: (payload as { policy: AdminOverview['policy'] }).policy },
      }),
    });
    renderWithI18n(<Admin api={api} />);
    const title = await screen.findByRole('checkbox', { name: 'Show the title' });
    const access = screen.getByRole('checkbox', {
      name: 'Show how many people and groups have access',
    });
    expect((title as HTMLInputElement).checked).toBe(true);
    expect((access as HTMLInputElement).checked).toBe(true);
    await userEvent.click(title);
    expect((access as HTMLInputElement).disabled).toBe(true);
    expect((access as HTMLInputElement).checked).toBe(false);
    await userEvent.click(title);
    expect((access as HTMLInputElement).disabled).toBe(false);
    expect((access as HTMLInputElement).checked).toBe(true);
    await userEvent.click(access);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Show the Reload button' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Show the Help tab' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(api.calls.find((c) => c.fn === 'updateSitePolicy')?.payload).toMatchObject({
      policy: {
        viewer: {
          showTitle: true,
          showAccessCount: false,
          showReload: false,
          showHelp: false,
        },
      },
    });
  });
});
