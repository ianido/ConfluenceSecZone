import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { App } from './App';
import { emptyReady, readyView, renderWithI18n, scriptedApi } from './testing';

async function expectNoA11yViolations(container: HTMLElement) {
  const res = await axe.run(container, {
    rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
  });
  expect(res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(' | ')}`)).toEqual(
    [],
  );
}

describe('App states', () => {
  it('shows a loading state, then the protected content', async () => {
    const api = scriptedApi({ getSection: () => readyView() });
    const { container } = renderWithI18n(<App api={api} />);
    expect(screen.getByRole('status').textContent).toContain('Loading');
    expect(await screen.findByText('Quarterly numbers')).toBeTruthy();
    await expectNoA11yViolations(container);
  });

  it('denied: shows no content and offers actionable guidance', async () => {
    const api = scriptedApi({
      getSection: () => ({ state: 'DENIED' }),
      getAccessInfo: () => ({
        ok: true,
        data: {
          title: 'Q4 plan',
          classification: 'CONFIDENTIAL',
          administrators: [{ accountId: 'alice', displayName: 'Alice' }],
          myRequest: null,
        },
      }),
    });
    const { container } = renderWithI18n(<App api={api} />);
    expect(await screen.findByText('This section is protected')).toBeTruthy();
    expect(await screen.findByText('Q4 plan')).toBeTruthy();
    expect(screen.getByText(/Administrators: Alice/)).toBeTruthy();
    expect(container.textContent).not.toContain('Quarterly');
    await expectNoA11yViolations(container);
  });

  it('denied: sending a request shows the pending state without leaking content', async () => {
    let pending = false;
    const api = scriptedApi({
      getSection: () => ({ state: 'DENIED' }),
      getAccessInfo: () => ({
        ok: true,
        data: {
          title: null,
          classification: null,
          administrators: [],
          myRequest: pending
            ? { role: 'VIEW', reason: 'Need the table', requestedAt: '2026-01-01T00:00:00.000Z' }
            : null,
        },
      }),
      requestAccess: (p) => {
        pending = true;
        return {
          ok: true,
          data: {
            title: null,
            classification: null,
            administrators: [],
            myRequest: {
              role: (p as { role: 'VIEW' }).role,
              reason: (p as { reason?: string }).reason ?? '',
              requestedAt: '2026-01-01T00:00:00.000Z',
            },
          },
        };
      },
    });
    const { container } = renderWithI18n(<App api={api} />);
    await userEvent.type(await screen.findByLabelText('Reason (optional)'), 'Need the table');
    await userEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByText(/Your request for “Can view” is pending/)).toBeTruthy();
    expect(api.calls.find((c) => c.fn === 'requestAccess')?.payload).toEqual({
      role: 'VIEW',
      reason: 'Need the table',
    });
    expect(container.textContent).not.toContain('Quarterly');
  });

  it('unavailable: retry reloads', async () => {
    let n = 0;
    const api = scriptedApi({
      getSection: () => (n++ === 0 ? { state: 'UNAVAILABLE' } : readyView()),
    });
    renderWithI18n(<App api={api} />);
    await screen.findByText('Temporarily unavailable');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Quarterly numbers')).toBeTruthy();
  });

  it('unavailable when the bridge itself throws', async () => {
    const api = scriptedApi({
      getSection: () => {
        throw new Error('network');
      },
    });
    renderWithI18n(<App api={api} />);
    expect(await screen.findByText('Temporarily unavailable')).toBeTruthy();
  });

  it('corrupted content is announced and never rendered', async () => {
    const api = scriptedApi({ getSection: () => ({ state: 'CORRUPTED' }) });
    renderWithI18n(<App api={api} />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('cannot be displayed');
  });

  it('unconfigured: editors see the wizard and can create; non-editors get guidance only', async () => {
    let created = false;
    const api = scriptedApi({
      getSection: () => (created ? readyView() : { state: 'UNCONFIGURED', canCreate: true }),
      createSection: () => {
        created = true;
        return { ok: true, data: readyView() };
      },
    });
    const { container } = renderWithI18n(<App api={api} />);
    expect(await screen.findByText('Set up your secure section')).toBeTruthy();
    await expectNoA11yViolations(container);
    await userEvent.click(screen.getByRole('button', { name: 'Set up secure section' }));
    expect(await screen.findByText('Quarterly numbers')).toBeTruthy();
  });

  it('unconfigured without edit rights cannot create', async () => {
    const api = scriptedApi({ getSection: () => ({ state: 'UNCONFIGURED', canCreate: false }) });
    renderWithI18n(<App api={api} />);
    await screen.findByText('Secure section not set up');
    expect(screen.queryByRole('button', { name: 'Set up secure section' })).toBeNull();
  });

  it('shows the revoked state when access disappears after being granted', async () => {
    let n = 0;
    const api = scriptedApi({ getSection: () => (n++ === 0 ? readyView() : { state: 'DENIED' }) });
    renderWithI18n(<App api={api} />);
    await screen.findByText('Quarterly numbers');
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(await screen.findByText('Your access was removed')).toBeTruthy();
  });

  it('empty section shows an explicit empty state', async () => {
    const api = scriptedApi({ getSection: () => emptyReady });
    renderWithI18n(<App api={api} />);
    expect(await screen.findByText('This section is empty')).toBeTruthy();
  });

  it('role-based tabs: VIEW sees only content and help', async () => {
    const api = scriptedApi({ getSection: () => readyView({ role: 'VIEW', canWrite: false }) });
    renderWithI18n(<App api={api} />);
    await screen.findByText('Quarterly numbers');
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Content', 'Help']);
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  });

  it('MODIFY without page edit explains why editing is unavailable', async () => {
    const api = scriptedApi({
      getSection: () => readyView({ role: 'MODIFY', canWrite: false, canEditPage: false }),
    });
    renderWithI18n(<App api={api} />);
    await screen.findByText('Quarterly numbers');
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Content',
      'History',
      'Help',
    ]);
    expect(screen.getByText(/also requires permission to edit this page/)).toBeTruthy();
  });

  it('ADMINISTER sees all tabs; arrow keys move between tabs', async () => {
    const api = scriptedApi({
      getSection: () => readyView(),
      getEffectiveAccess: () => ({ ok: false, code: 'DENIED' }),
      listGrants: () => ({ ok: false, code: 'DENIED' }),
    });
    renderWithI18n(<App api={api} />);
    await screen.findByText('Quarterly numbers');
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual([
      'Content',
      'Permissions',
      'History',
      'Activity',
      'Help',
    ]);
    tabs[0]?.focus();
    fireEvent.keyDown(tabs[0] as HTMLElement, { key: 'ArrowRight' });
    await waitFor(() =>
      expect(screen.getAllByRole('tab')[1]?.getAttribute('aria-selected')).toBe('true'),
    );
  });

  it('renders in Spanish', async () => {
    const api = scriptedApi({ getSection: () => ({ state: 'DENIED' }) });
    renderWithI18n(<App api={api} />, 'es');
    expect(await screen.findByText('Esta sección está protegida')).toBeTruthy();
  });
});

describe('Section header', () => {
  it('shows title, classification, access summary and saved status', async () => {
    const api = scriptedApi({
      getSection: () =>
        readyView({
          meta: {
            title: 'Q4 plan',
            classification: 'CONFIDENTIAL',
            sharedWith: { users: 3, groups: 1 },
          },
        }),
    });
    const { container } = renderWithI18n(<App api={api} />);
    expect(await screen.findByRole('heading', { name: /Q4 plan/ })).toBeTruthy();
    expect(screen.getByText('Confidential')).toBeTruthy();
    expect(screen.getByText('Access: 3 people · 1 groups')).toBeTruthy();
    expect(screen.getByText(/Saved by Alice/)).toBeTruthy();
    await expectNoA11yViolations(container);
  });

  it('only administrators can edit details; saving sends only title and classification', async () => {
    const api = scriptedApi({
      getSection: () => readyView(),
      updateMetadata: (p) => ({
        ok: true,
        data: { ...(p as object), sharedWith: { users: 1, groups: 0 } },
      }),
    });
    renderWithI18n(<App api={api} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit details' }));
    await userEvent.type(screen.getByLabelText('Title'), 'Board notes');
    await userEvent.selectOptions(screen.getByLabelText('Classification'), 'RESTRICTED');
    expect(screen.getByText(/visible to everyone who can view this page/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('heading', { name: /Board notes/ })).toBeTruthy();
    expect(screen.getByText('Restricted')).toBeTruthy();
    const call = api.calls.find((c) => c.fn === 'updateMetadata');
    expect(call?.payload).toEqual({ title: 'Board notes', classification: 'RESTRICTED' });
  });

  it('non-administrators get no edit or manage controls', async () => {
    const api = scriptedApi({ getSection: () => readyView({ role: 'VIEW', canWrite: false }) });
    renderWithI18n(<App api={api} />);
    await screen.findByText('Quarterly numbers');
    expect(screen.queryByRole('button', { name: 'Edit details' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Manage access' })).toBeNull();
  });

  it('wizard sends the chosen title and classification', async () => {
    let created = false;
    const api = scriptedApi({
      getSection: () => (created ? readyView() : { state: 'UNCONFIGURED', canCreate: true }),
      createSection: () => {
        created = true;
        return { ok: true, data: readyView() };
      },
    });
    renderWithI18n(<App api={api} />);
    await userEvent.type(await screen.findByLabelText('Title'), 'HR memo');
    await userEvent.selectOptions(screen.getByLabelText('Classification'), 'INTERNAL');
    await userEvent.click(screen.getByRole('button', { name: 'Set up secure section' }));
    await screen.findByText('Quarterly numbers');
    expect(api.calls.find((c) => c.fn === 'createSection')?.payload).toEqual({
      title: 'HR memo',
      classification: 'INTERNAL',
    });
  });
});

describe('Permissions panel', () => {
  const grants = {
    ok: true,
    data: {
      aclVersion: 3,
      ownerAccountId: 'alice',
      grants: [
        {
          principalType: 'USER',
          principalId: 'alice',
          label: 'Alice',
          role: 'ADMINISTER',
          addedAt: '',
          addedBy: 'alice',
          active: true,
          expiresAt: null,
          lastAccessAt: '2026-01-01T00:00:00.000Z',
        },
        {
          principalType: 'GROUP',
          principalId: 'g1',
          label: 'Finance',
          role: 'VIEW',
          addedAt: '',
          addedBy: 'alice',
          active: false,
          expiresAt: null,
          lastAccessAt: null,
        },
      ],
    },
  };

  it('requires confirmation before granting administrator and reports last-admin refusal', async () => {
    const api = scriptedApi({
      getSection: () => readyView(),
      listGrants: () => grants,
      listAccessRequests: () => ({ ok: true, data: { requests: [], aclVersion: 3 } }),
      getEffectiveAccess: () => ({
        ok: true,
        data: {
          role: 'ADMINISTER',
          canEditPage: true,
          sources: [{ via: 'USER', principalId: 'alice', label: 'You', role: 'ADMINISTER' }],
          groupResolution: 'DEGRADED',
        },
      }),
      upsertGrant: () => ({ ok: false, code: 'LAST_ADMINISTRATOR' }),
    });
    const { container } = renderWithI18n(<App api={api} />);
    await screen.findByText('Quarterly numbers');
    await userEvent.click(screen.getByRole('tab', { name: 'Permissions' }));
    await screen.findByText('Who can access this section');
    expect(screen.getByText('Unavailable account or group')).toBeTruthy();
    expect(screen.getByText(/Group membership could not be checked/)).toBeTruthy();
    await expectNoA11yViolations(container);
    await userEvent.selectOptions(screen.getByLabelText('Finance: Permissions'), 'ADMINISTER');
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(api.calls.some((c) => c.fn === 'upsertGrant')).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await screen.findByText(/At least one person must stay an administrator/);
  });

  it('removing access needs confirmation and sends the expected ACL version', async () => {
    const api = scriptedApi({
      getSection: () => readyView(),
      listGrants: () => grants,
      listAccessRequests: () => ({ ok: true, data: { requests: [], aclVersion: 3 } }),
      getEffectiveAccess: () => ({ ok: false, code: 'DENIED' }),
      revokeGrant: () => ({ ok: true, data: { ...grants.data, grants: [grants.data.grants[0]] } }),
    });
    renderWithI18n(<App api={api} />);
    await screen.findByText('Quarterly numbers');
    await userEvent.click(screen.getByRole('tab', { name: 'Permissions' }));
    await screen.findByText('Who can access this section');
    await userEvent.click(screen.getAllByRole('button', { name: 'Remove' })[1] as HTMLElement);
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await screen.findByText('Permissions updated.');
    expect(api.calls.find((c) => c.fn === 'revokeGrant')?.payload).toEqual({
      principalType: 'GROUP',
      principalId: 'g1',
      expectedAclVersion: 3,
    });
  });

  it('shows a pending-request queue and approves with the expected ACL version', async () => {
    const api = scriptedApi({
      getSection: () => readyView(),
      listGrants: () => grants,
      listAccessRequests: () => ({
        ok: true,
        data: {
          aclVersion: 3,
          requests: [
            {
              accountId: 'bob',
              displayName: 'Bob',
              active: true,
              role: 'VIEW',
              reason: 'Need the table',
              requestedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        },
      }),
      getEffectiveAccess: () => ({
        ok: true,
        data: {
          role: 'ADMINISTER',
          canEditPage: true,
          sources: [],
          groupResolution: 'OK',
        },
      }),
      resolveAccessRequest: () => ({ ok: true, data: { requests: [], aclVersion: 4 } }),
    });
    renderWithI18n(<App api={api} />);
    await screen.findByText('Quarterly numbers');
    expect(await screen.findByLabelText(/1 pending requests/)).toBeTruthy();
    await userEvent.click(screen.getByRole('tab', { name: /Permissions/ }));
    expect(await screen.findByText(/Bob asks for: Can view/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /Approve/ }));
    expect(await screen.findByText('Access granted.')).toBeTruthy();
    expect(api.calls.find((c) => c.fn === 'resolveAccessRequest')?.payload).toEqual({
      accountId: 'bob',
      decision: 'APPROVE',
      role: 'VIEW',
      expectedAclVersion: 3,
    });
  });
});
