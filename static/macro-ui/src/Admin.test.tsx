import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AdminOverview } from '@secure-sections/shared';
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
});
