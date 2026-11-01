import { describe, expect, it } from 'vitest';
import type { Role } from '@secure-sections/shared';
import { ctxFor, makeWorld, type World } from '../testing/world.js';

const doc = (t: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }],
});

async function world(): Promise<World> {
  const w = makeWorld();
  for (const u of [
    'alice',
    'viewer',
    'editor',
    'admin2',
    'groupie',
    'outsider',
    'noPageAccess',
    'pageViewOnly',
  ]) {
    w.gateway.addUser(u);
  }
  w.gateway.addGroup('g-hr', 'HR', ['groupie']);
  w.gateway.addGroup('g-eng', 'Engineering', ['groupie', 'outsider']);
  const full = { canView: true, canEdit: true };
  for (const u of ['alice', 'viewer', 'editor', 'admin2', 'groupie', 'outsider'])
    w.gateway.setPage('1001', u, full);
  w.gateway.setPage('1001', 'pageViewOnly', { canView: true, canEdit: false });
  await w.service.createSection(ctxFor('alice'));
  await w.service.saveContent(ctxFor('alice'), doc('TOP-SECRET'), 1);
  return w;
}

async function grant(w: World, type: 'USER' | 'GROUP', id: string, role: Role) {
  const g = await w.service.listGrants(ctxFor('alice'));
  await w.service.upsertGrant(ctxFor('alice'), {
    principalType: type,
    principalId: id,
    role,
    expectedAclVersion: g.aclVersion,
  });
}

describe('authorization: effective role table', () => {
  type Row = {
    name: string;
    setup: (w: World) => Promise<void>;
    user: string;
    expectRole: Role | null;
    canWrite?: boolean;
  };
  const rows: Row[] = [
    { name: 'no grant', setup: async () => {}, user: 'outsider', expectRole: null },
    {
      name: 'direct VIEW',
      setup: (w) => grant(w, 'USER', 'viewer', 'VIEW'),
      user: 'viewer',
      expectRole: 'VIEW',
      canWrite: false,
    },
    {
      name: 'direct MODIFY',
      setup: (w) => grant(w, 'USER', 'editor', 'MODIFY'),
      user: 'editor',
      expectRole: 'MODIFY',
      canWrite: true,
    },
    {
      name: 'direct ADMINISTER',
      setup: (w) => grant(w, 'USER', 'admin2', 'ADMINISTER'),
      user: 'admin2',
      expectRole: 'ADMINISTER',
      canWrite: true,
    },
    {
      name: 'group VIEW',
      setup: (w) => grant(w, 'GROUP', 'g-hr', 'VIEW'),
      user: 'groupie',
      expectRole: 'VIEW',
      canWrite: false,
    },
    {
      name: 'highest of direct VIEW and group MODIFY',
      setup: async (w) => {
        await grant(w, 'USER', 'groupie', 'VIEW');
        await grant(w, 'GROUP', 'g-hr', 'MODIFY');
      },
      user: 'groupie',
      expectRole: 'MODIFY',
      canWrite: true,
    },
    {
      name: 'highest across two groups',
      setup: async (w) => {
        await grant(w, 'GROUP', 'g-hr', 'VIEW');
        await grant(w, 'GROUP', 'g-eng', 'ADMINISTER');
      },
      user: 'groupie',
      expectRole: 'ADMINISTER',
      canWrite: true,
    },
    {
      name: 'group grant does not apply to non-member',
      setup: (w) => grant(w, 'GROUP', 'g-hr', 'ADMINISTER'),
      user: 'outsider',
      expectRole: null,
    },
    {
      name: 'MODIFY without page edit cannot write',
      setup: (w) => grant(w, 'USER', 'pageViewOnly', 'MODIFY'),
      user: 'pageViewOnly',
      expectRole: 'MODIFY',
      canWrite: false,
    },
    {
      name: 'group membership revoked',
      setup: async (w) => {
        await grant(w, 'GROUP', 'g-hr', 'VIEW');
        w.gateway.removeFromGroup('g-hr', 'groupie');
      },
      user: 'groupie',
      expectRole: null,
    },
    {
      name: 'granted user lost page view access',
      setup: async (w) => {
        await grant(w, 'USER', 'viewer', 'ADMINISTER');
        w.gateway.setPage('1001', 'viewer', { canView: false, canEdit: false });
      },
      user: 'viewer',
      expectRole: null,
    },
    {
      name: 'user with no page access at all',
      setup: (w) => grant(w, 'USER', 'noPageAccess', 'VIEW'),
      user: 'noPageAccess',
      expectRole: null,
    },
  ];

  for (const row of rows) {
    it(row.name, async () => {
      const w = await world();
      await row.setup(w);
      const view = await w.service.getSection(ctxFor(row.user));
      if (row.expectRole === null) {
        expect(view.state === 'DENIED').toBe(true);
        expect(JSON.stringify(view)).not.toContain('TOP-SECRET');
      } else {
        expect(view.state).toBe('READY');
        if (view.state === 'READY') {
          expect(view.role).toBe(row.expectRole);
          expect(view.canWrite).toBe(row.canWrite);
          expect(JSON.stringify(view)).toContain('TOP-SECRET');
        }
      }
    });
  }
});

describe('authorization: failure handling is fail-closed', () => {
  it('page permission API failure -> unavailable, never content', async () => {
    const w = await world();
    w.gateway.failing.add('pagePermissions');
    const v = await w.service.getSection(ctxFor('alice')).catch((e) => ({ state: e.code }));
    expect(JSON.stringify(v)).not.toContain('TOP-SECRET');
    const r = await w.handlers.getSection({
      context: (await import('../testing/world.js')).rawContext(ctxFor('alice')),
    });
    expect(r).toEqual({ state: 'UNAVAILABLE' });
  });

  it('group lookup failure: group-only grantee is UNAVAILABLE (not a false DENIED), direct grantee unaffected', async () => {
    const w = await world();
    await grant(w, 'GROUP', 'g-hr', 'VIEW');
    w.gateway.failing.add('groupMembership');
    const r = await w.handlers.getSection({
      context: (await import('../testing/world.js')).rawContext(ctxFor('groupie')),
    });
    expect(r).toEqual({ state: 'UNAVAILABLE' });
    const direct = await w.service.getSection(ctxFor('alice'));
    expect(direct.state).toBe('READY');
  });

  it('truncated group membership never grants access it did not see', async () => {
    const w = await world();
    await grant(w, 'GROUP', 'g-hr', 'VIEW');
    w.gateway.incompleteGroupFor.add('outsider');
    const r = await w.handlers.getSection({
      context: (await import('../testing/world.js')).rawContext(ctxFor('outsider')),
    });
    expect(r).toEqual({ state: 'UNAVAILABLE' });
  });

  it('deleted group: its members lose access', async () => {
    const w = await world();
    await grant(w, 'GROUP', 'g-hr', 'VIEW');
    w.gateway.removeGroup('g-hr');
    expect((await w.service.getSection(ctxFor('groupie'))).state).toBe('DENIED');
  });

  it('storage outage never grants access', async () => {
    const w = await world();
    w.store.failReads = true;
    const r = await w.handlers.getSection({
      context: (await import('../testing/world.js')).rawContext(ctxFor('alice')),
    });
    expect(r).toEqual({ state: 'UNAVAILABLE' });
  });

  it('anonymous / missing identity in context is rejected before any lookup', async () => {
    const w = await world();
    const raw = (await import('../testing/world.js')).rawContext(ctxFor('alice'));
    delete (raw as Record<string, unknown>).accountId;
    w.gateway.calls.length = 0;
    expect(await w.handlers.getSection({ context: raw })).toEqual({ state: 'UNAVAILABLE' });
    expect(w.gateway.calls).toHaveLength(0);
  });
});

describe('authorization: write and admin operations', () => {
  it('VIEW cannot write, read history, list grants or audit; denial is generic and audited at most once per day', async () => {
    const w = await world();
    await grant(w, 'USER', 'viewer', 'VIEW');
    const v = ctxFor('viewer');
    await expect(w.service.saveContent(v, doc('x'), 2)).rejects.toMatchObject({ code: 'DENIED' });
    await expect(w.service.saveContent(v, doc('x'), 2)).rejects.toMatchObject({ code: 'DENIED' });
    await expect(w.service.listRevisions(v, null)).rejects.toMatchObject({ code: 'DENIED' });
    await expect(w.service.listGrants(v)).rejects.toMatchObject({ code: 'DENIED' });
    await expect(w.service.listAudit(v, null)).rejects.toMatchObject({ code: 'DENIED' });
    await expect(w.service.getShareReference(v)).rejects.toMatchObject({ code: 'DENIED' });
    await expect(
      w.service.upsertGrant(v, {
        principalType: 'USER',
        principalId: 'viewer',
        role: 'ADMINISTER',
        expectedAclVersion: 2,
      }),
    ).rejects.toMatchObject({ code: 'DENIED' });
    const audit = await w.service.listAudit(ctxFor('alice'), null);
    const denied = audit.entries.filter((e) => e.action === 'ACCESS_DENIED');
    // one per op category per day at most per (account, day): bounded growth
    expect(denied).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain('TOP-SECRET');
  });

  it('MODIFY cannot administer; ADMINISTER without page edit can still administer ACL but not edit content', async () => {
    const w = await world();
    await grant(w, 'USER', 'editor', 'MODIFY');
    await grant(w, 'USER', 'pageViewOnly', 'ADMINISTER');
    await expect(w.service.listGrants(ctxFor('editor'))).rejects.toMatchObject({ code: 'DENIED' });
    await expect(w.service.listGrants(ctxFor('pageViewOnly'))).resolves.toBeTruthy();
    await expect(w.service.saveContent(ctxFor('pageViewOnly'), doc('y'), 1)).rejects.toMatchObject({
      code: 'PAGE_EDIT_REQUIRED',
    });
  });

  it('a user who cannot view the page cannot administer even with ADMINISTER', async () => {
    const w = await world();
    await grant(w, 'USER', 'viewer', 'ADMINISTER');
    w.gateway.setPage('1001', 'viewer', { canView: false, canEdit: false });
    await expect(w.service.listGrants(ctxFor('viewer'))).rejects.toMatchObject({ code: 'DENIED' });
  });

  it('revocation takes effect on the very next request', async () => {
    const w = await world();
    await grant(w, 'USER', 'editor', 'MODIFY');
    expect((await w.service.getSection(ctxFor('editor'))).state).toBe('READY');
    const g = await w.service.listGrants(ctxFor('alice'));
    await w.service.revokeGrant(ctxFor('alice'), {
      principalType: 'USER',
      principalId: 'editor',
      expectedAclVersion: g.aclVersion,
    });
    expect((await w.service.getSection(ctxFor('editor'))).state).toBe('DENIED');
    await expect(w.service.saveContent(ctxFor('editor'), doc('z'), 1)).rejects.toMatchObject({
      code: 'DENIED',
    });
  });
});
