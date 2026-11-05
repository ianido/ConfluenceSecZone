import { describe, expect, it } from 'vitest';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EffectiveAccess, GrantList, PrincipalHit } from '@secure-sections/shared';
import { PermissionsPanel } from './Panels';
import { renderWithI18n, scriptedApi } from './testing';

const access: EffectiveAccess = {
  role: 'ADMINISTER',
  canEditPage: true,
  sources: [],
  groupResolution: 'OK',
};

const grants: GrantList = {
  aclVersion: 1,
  ownerAccountId: 'alice',
  grants: [
    {
      principalType: 'USER',
      principalId: 'alice',
      label: 'Alice',
      role: 'ADMINISTER',
      addedAt: '2026-01-01T00:00:00.000Z',
      addedBy: 'alice',
      active: true,
      expiresAt: null,
      lastAccessAt: null,
    },
  ],
};

const bob: PrincipalHit = { principalType: 'USER', principalId: 'bob', label: 'Bob' };
const cara: PrincipalHit = { principalType: 'USER', principalId: 'cara', label: 'Cara' };

function apiWith(hits: PrincipalHit[]) {
  let version = grants.aclVersion;
  return scriptedApi({
    listGrants: () => ({ ok: true, data: { ...grants, aclVersion: version } }),
    getEffectiveAccess: () => ({ ok: true, data: access }),
    listAccessRequests: () => ({ ok: true, data: { requests: [], aclVersion: version } }),
    searchPrincipals: () => ({ ok: true, data: { hits } }),
    upsertGrant: () => {
      version += 1;
      return { ok: true, data: { ...grants, aclVersion: version } };
    },
  });
}

describe('Add access dialog', () => {
  it('searches and adds the selected people from the dialog', async () => {
    const user = userEvent.setup();
    const api = apiWith([bob, cara]);
    renderWithI18n(<PermissionsPanel api={api} />);
    expect(screen.queryByRole('searchbox')).toBeNull();

    await user.click(await screen.findByRole('button', { name: 'Add access' }));
    await user.type(screen.getByRole('searchbox'), 'Bo');
    await user.click(screen.getByRole('button', { name: 'Search people' }));
    await user.click(screen.getByRole('checkbox', { name: 'Bob' }));
    await user.click(screen.getByRole('checkbox', { name: 'Cara' }));
    await user.click(screen.getByRole('button', { name: 'Add selected (2)' }));

    expect(screen.queryByRole('dialog', { name: 'Add access' })).toBeNull();
    const adds = api.calls.filter((c) => c.fn === 'upsertGrant');
    expect(adds.map((c) => c.payload)).toEqual([
      {
        principalType: 'USER',
        principalId: 'bob',
        role: 'VIEW',
        expectedAclVersion: 1,
        expiresAt: null,
      },
      {
        principalType: 'USER',
        principalId: 'cara',
        role: 'VIEW',
        expectedAclVersion: 2,
        expiresAt: null,
      },
    ]);
  });

  it('asks for confirmation before adding an administrator', async () => {
    const user = userEvent.setup();
    const api = apiWith([bob]);
    renderWithI18n(<PermissionsPanel api={api} />);
    await user.click(await screen.findByRole('button', { name: 'Add access' }));
    await user.type(screen.getByRole('searchbox'), 'Bob');
    await user.click(screen.getByRole('button', { name: 'Search people' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Permissions' }), 'ADMINISTER');
    await user.click(screen.getByRole('checkbox', { name: 'Bob' }));
    await user.click(screen.getByRole('button', { name: 'Add selected (1)' }));

    expect(screen.queryByRole('dialog', { name: 'Add access' })).toBeNull();
    const confirm = screen.getByRole('alertdialog', {
      name: 'Give administrator access? Administrators can change who can read this content.',
    });
    expect(confirm.textContent).toContain('Bob');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(api.calls.filter((c) => c.fn === 'upsertGrant').map((c) => c.payload)).toEqual([
      {
        principalType: 'USER',
        principalId: 'bob',
        role: 'ADMINISTER',
        expectedAclVersion: 1,
        expiresAt: null,
      },
    ]);
  });

  it('shows a search failure inside the dialog and ignores a stale result', async () => {
    const user = userEvent.setup();
    let releaseStale: (value: { ok: true; data: { hits: PrincipalHit[] } }) => void = () => {};
    let heldUser = false;
    const api = scriptedApi({
      listGrants: () => ({ ok: true, data: grants }),
      getEffectiveAccess: () => ({ ok: true, data: access }),
      listAccessRequests: () => ({ ok: true, data: { requests: [], aclVersion: 1 } }),
      searchPrincipals: (payload) => {
        const type = (payload as { type?: string }).type;
        if (type === 'USER' && !heldUser) {
          heldUser = true;
          return new Promise((resolve) => {
            releaseStale = resolve;
          });
        }
        if (type === 'GROUP') {
          return {
            ok: true,
            data: { hits: [{ principalType: 'GROUP', principalId: 'g', label: 'HR' }] },
          };
        }
        return { ok: false, code: 'UNAVAILABLE' };
      },
    });
    renderWithI18n(<PermissionsPanel api={api} />);
    await user.click(await screen.findByRole('button', { name: 'Add access' }));
    await user.type(screen.getByRole('searchbox'), 'Bo');
    await user.click(screen.getByRole('button', { name: 'Search people' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Person / Group' }), 'GROUP');
    await user.click(screen.getByRole('button', { name: 'Search groups' }));
    expect(await screen.findByRole('checkbox', { name: 'HR' })).toBeTruthy();
    await act(async () => {
      releaseStale({ ok: true, data: { hits: [bob] } });
    });
    expect(screen.queryByRole('checkbox', { name: 'Bob' })).toBeNull();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Person / Group' }), 'USER');
    await user.click(screen.getByRole('button', { name: 'Search people' }));
    expect(screen.getByRole('dialog', { name: 'Add access' }).textContent).toContain(
      'Something went wrong',
    );
  });
});
