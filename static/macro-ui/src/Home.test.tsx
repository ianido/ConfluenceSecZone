import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MySections } from '@secure-sections/shared';
import { Home } from './Home';
import { renderWithI18n, scriptedApi } from './testing';

const data: MySections = {
  truncated: false,
  kpis: { administered: 1, pendingRequests: 0, expiringGrants: 0, inactive: 0 },
  activity: [],
  rows: [
    {
      sectionId: '00000000-0000-4000-8000-000000000099',
      title: 'Gone',
      classification: 'INTERNAL',
      pageId: '1001',
      spaceKey: 'SEC',
      pageStatus: 'MISSING',
      role: 'ADMINISTER',
      sharedUsers: 1,
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
};

describe('Orphan deletion', () => {
  it('sends DELETE only after that word is typed', async () => {
    const api = scriptedApi({
      listMySections: () => ({ ok: true, data }),
      deleteOrphan: () => ({ ok: true, data: { deleted: true } }),
    });
    renderWithI18n(<Home api={api} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    const confirm = screen.getByRole('button', { name: 'Confirm' });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    await userEvent.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE');
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
    await userEvent.click(confirm);
    expect(api.calls.find((c) => c.fn === 'deleteOrphan')?.payload).toEqual({
      sectionId: data.rows[0]!.sectionId,
      confirm: 'DELETE',
    });
  });
});
