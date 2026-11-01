import { describe, expect, it } from 'vitest';
import { ctxFor, makeWorld, type World } from '../testing/world.js';
import { StoreConflictError } from '../ports/store.js';

async function world(): Promise<World> {
  const w = makeWorld();
  for (const u of ['alice', 'bob', 'carol', 'dave', 'ghost']) w.gateway.addUser(u);
  w.gateway.addGroup('g1', 'Group One', ['dave']);
  for (const u of ['alice', 'bob', 'carol', 'dave'])
    w.gateway.setPage('1001', u, { canView: true, canEdit: true });
  await w.service.createSection(ctxFor('alice'));
  return w;
}

const alice = ctxFor('alice');

describe('permission administration', () => {
  it('adds, updates and revokes grants with optimistic ACL versions and audit', async () => {
    const w = await world();
    let g = await w.service.listGrants(alice);
    expect(g.aclVersion).toBe(1);
    g = await w.service.upsertGrant(alice, {
      principalType: 'USER',
      principalId: 'bob',
      role: 'VIEW',
      expectedAclVersion: 1,
    });
    expect(g.aclVersion).toBe(2);
    g = await w.service.upsertGrant(alice, {
      principalType: 'USER',
      principalId: 'bob',
      role: 'MODIFY',
      expectedAclVersion: 2,
    });
    expect(g.grants.find((x) => x.principalId === 'bob')?.role).toBe('MODIFY');
    g = await w.service.revokeGrant(alice, {
      principalType: 'USER',
      principalId: 'bob',
      expectedAclVersion: 3,
    });
    expect(g.grants.map((x) => x.principalId)).toEqual(['alice']);
    const audit = await w.service.listAudit(alice, null);
    expect(audit.entries.map((e) => e.action)).toEqual([
      'GRANT_REVOKE',
      'GRANT_UPDATE',
      'GRANT_ADD',
      'SECTION_CREATE',
    ]);
    expect(audit.chain).toBe('OK');
  });

  it('rejects stale ACL versions with a CONFLICT carrying the current version', async () => {
    const w = await world();
    await w.service.upsertGrant(alice, {
      principalType: 'USER',
      principalId: 'bob',
      role: 'VIEW',
      expectedAclVersion: 1,
    });
    await expect(
      w.service.upsertGrant(alice, {
        principalType: 'USER',
        principalId: 'carol',
        role: 'VIEW',
        expectedAclVersion: 1,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT', detail: { currentAclVersion: 2 } });
  });

  it('is idempotent for identical grants (no version bump, no audit noise)', async () => {
    const w = await world();
    await w.service.upsertGrant(alice, {
      principalType: 'USER',
      principalId: 'bob',
      role: 'VIEW',
      expectedAclVersion: 1,
    });
    const g = await w.service.upsertGrant(alice, {
      principalType: 'USER',
      principalId: 'bob',
      role: 'VIEW',
      expectedAclVersion: 2,
    });
    expect(g.aclVersion).toBe(2);
  });

  it('validates principals: unknown, inactive or malformed ones are rejected', async () => {
    const w = await world();
    w.gateway.deactivate('ghost');
    for (const [type, id] of [
      ['USER', 'nobody'],
      ['USER', 'ghost'],
      ['GROUP', 'missing-group'],
      ['USER', "x'; DROP"],
      ['SERVICE', 'bob'],
    ] as const) {
      await expect(
        w.service.upsertGrant(alice, {
          principalType: type,
          principalId: id,
          role: 'VIEW',
          expectedAclVersion: 1,
        }),
      ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    }
    await expect(
      w.service.upsertGrant(alice, {
        principalType: 'USER',
        principalId: 'bob',
        role: 'OWNER',
        expectedAclVersion: 1,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('fails closed when the directory is unavailable during a grant', async () => {
    const w = await world();
    w.gateway.failing.add('users');
    await expect(
      w.service.upsertGrant(alice, {
        principalType: 'USER',
        principalId: 'bob',
        role: 'VIEW',
        expectedAclVersion: 1,
      }),
    ).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  });

  it('role escalation: a MODIFY user cannot grant themselves or others anything', async () => {
    const w = await world();
    await w.service.upsertGrant(alice, {
      principalType: 'USER',
      principalId: 'bob',
      role: 'MODIFY',
      expectedAclVersion: 1,
    });
    await expect(
      w.service.upsertGrant(ctxFor('bob'), {
        principalType: 'USER',
        principalId: 'bob',
        role: 'ADMINISTER',
        expectedAclVersion: 2,
      }),
    ).rejects.toMatchObject({ code: 'DENIED' });
    await expect(
      w.service.setOwner(ctxFor('bob'), { accountId: 'bob', expectedAclVersion: 2 }),
    ).rejects.toMatchObject({ code: 'DENIED' });
  });

  it('group inheritance through the group admin grant', async () => {
    const w = await world();
    await w.service.upsertGrant(alice, {
      principalType: 'GROUP',
      principalId: 'g1',
      role: 'ADMINISTER',
      expectedAclVersion: 1,
    });
    const g = await w.service.listGrants(ctxFor('dave'));
    expect(g.grants.some((x) => x.principalType === 'GROUP' && x.label === 'Group One')).toBe(true);
    const eff = await w.service.getEffectiveAccess(ctxFor('dave'));
    expect(eff.role).toBe('ADMINISTER');
    expect(eff.sources).toEqual([
      { via: 'GROUP', principalId: 'g1', label: 'Group One', role: 'ADMINISTER' },
    ]);
  });

  it('the final direct administrator cannot be removed or downgraded', async () => {
    const w = await world();
    await expect(
      w.service.revokeGrant(alice, {
        principalType: 'USER',
        principalId: 'alice',
        expectedAclVersion: 1,
      }),
    ).rejects.toMatchObject({ code: 'LAST_ADMINISTRATOR' });
    await expect(
      w.service.upsertGrant(alice, {
        principalType: 'USER',
        principalId: 'alice',
        role: 'VIEW',
        expectedAclVersion: 1,
      }),
    ).rejects.toMatchObject({ code: 'LAST_ADMINISTRATOR' });
  });

  it('a group admin grant does not count as a surviving administrator', async () => {
    const w = await world();
    await w.service.upsertGrant(alice, {
      principalType: 'GROUP',
      principalId: 'g1',
      role: 'ADMINISTER',
      expectedAclVersion: 1,
    });
    await expect(
      w.service.revokeGrant(alice, {
        principalType: 'USER',
        principalId: 'alice',
        expectedAclVersion: 2,
      }),
    ).rejects.toMatchObject({ code: 'LAST_ADMINISTRATOR' });
  });

  it('race: two admins removing each other concurrently never leaves zero administrators', async () => {
    for (let i = 0; i < 25; i += 1) {
      const w = await world();
      await w.service.upsertGrant(alice, {
        principalType: 'USER',
        principalId: 'bob',
        role: 'ADMINISTER',
        expectedAclVersion: 1,
      });
      const bob = ctxFor('bob');
      const results = await Promise.allSettled([
        w.service.revokeGrant(alice, {
          principalType: 'USER',
          principalId: 'bob',
          expectedAclVersion: 2,
        }),
        w.service.revokeGrant(bob, {
          principalType: 'USER',
          principalId: 'alice',
          expectedAclVersion: 2,
        }),
      ]);
      const ok = results.filter((r) => r.status === 'fulfilled').length;
      expect(ok).toBe(1);
      const sec = w.store.dump('section')[0]!.value as {
        grants: Array<{ principalType: string; role: string }>;
      };
      expect(
        sec.grants.filter((g) => g.principalType === 'USER' && g.role === 'ADMINISTER'),
      ).toHaveLength(1);
    }
  });

  it('race: concurrent grants to different principals both land or one conflicts; ACL never loses an update', async () => {
    const w = await world();
    const [r1, r2] = await Promise.allSettled([
      w.service.upsertGrant(alice, {
        principalType: 'USER',
        principalId: 'bob',
        role: 'VIEW',
        expectedAclVersion: 1,
      }),
      w.service.upsertGrant(alice, {
        principalType: 'USER',
        principalId: 'carol',
        role: 'VIEW',
        expectedAclVersion: 1,
      }),
    ]);
    const landed = [r1, r2].filter((r) => r.status === 'fulfilled').length;
    expect(landed).toBe(1);
    const g = await w.service.listGrants(alice);
    expect(g.grants).toHaveLength(2);
  });

  it('storage conflict beyond retry budget surfaces as CONFLICT and writes nothing', async () => {
    const w = await world();
    w.store.failNextTransact = new StoreConflictError();
    // first attempt fails, retry succeeds
    const g = await w.service.upsertGrant(alice, {
      principalType: 'USER',
      principalId: 'bob',
      role: 'VIEW',
      expectedAclVersion: 1,
    });
    expect(g.grants).toHaveLength(2);
  });

  it('owner change requires the target to be a direct administrator and is audited', async () => {
    const w = await world();
    await expect(
      w.service.setOwner(alice, { accountId: 'bob', expectedAclVersion: 1 }),
    ).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
    await w.service.upsertGrant(alice, {
      principalType: 'USER',
      principalId: 'bob',
      role: 'ADMINISTER',
      expectedAclVersion: 1,
    });
    const g = await w.service.setOwner(alice, { accountId: 'bob', expectedAclVersion: 2 });
    expect(g.ownerAccountId).toBe('bob');
    const audit = await w.service.listAudit(alice, null);
    expect(audit.entries[0]?.action).toBe('OWNER_CHANGE');
  });

  it('revoking the owner reassigns ownership to a remaining administrator', async () => {
    const w = await world();
    await w.service.upsertGrant(alice, {
      principalType: 'USER',
      principalId: 'bob',
      role: 'ADMINISTER',
      expectedAclVersion: 1,
    });
    const g = await w.service.revokeGrant(ctxFor('bob'), {
      principalType: 'USER',
      principalId: 'alice',
      expectedAclVersion: 2,
    });
    expect(g.ownerAccountId).toBe('bob');
  });

  it('caps the number of grants', async () => {
    const w = await world();
    w.gateway.addUser('u0');
    let version = 1;
    for (let i = 0; i < 499; i += 1) {
      const id = `u${i}`;
      w.gateway.addUser(id);
      const g = await w.service.upsertGrant(alice, {
        principalType: 'USER',
        principalId: id,
        role: 'VIEW',
        expectedAclVersion: version,
      });
      version = g.aclVersion;
    }
    w.gateway.addUser('overflow');
    await expect(
      w.service.upsertGrant(alice, {
        principalType: 'USER',
        principalId: 'overflow',
        role: 'VIEW',
        expectedAclVersion: version,
      }),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('principal search is ADMINISTER-only, bounded and validated', async () => {
    const w = await world();
    const hits = await w.service.searchPrincipals(alice, 'bo', 'USER');
    expect(hits.hits.map((h) => h.principalId)).toContain('bob');
    await expect(w.service.searchPrincipals(alice, 'b', 'USER')).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
    await expect(w.service.searchPrincipals(ctxFor('bob'), 'carol', 'USER')).rejects.toMatchObject({
      code: 'DENIED',
    });
    await expect(w.service.searchPrincipals(alice, 'x'.repeat(101), 'USER')).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
  });
});

describe('administrator recovery (break-glass)', () => {
  it('requires a Confluence site administrator, typed confirmation and no active administrator', async () => {
    const w = await world();
    w.gateway.addUser('siteadmin');
    w.gateway.setPage('1001', 'siteadmin', { canView: true, canEdit: false });
    const sa = ctxFor('siteadmin');
    // not a site admin
    await expect(
      w.service.recoverSection(sa, { newAdministratorAccountId: 'bob', confirm: 'RECOVER' }),
    ).rejects.toMatchObject({ code: 'DENIED' });
    w.gateway.siteAdmins.add('siteadmin');
    // wrong confirmation
    await expect(
      w.service.recoverSection(sa, { newAdministratorAccountId: 'bob', confirm: 'yes' }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    // administrator alice is still active
    await expect(
      w.service.recoverSection(sa, { newAdministratorAccountId: 'bob', confirm: 'RECOVER' }),
    ).rejects.toMatchObject({ code: 'NOT_RECOVERABLE' });
    w.gateway.deactivate('alice');
    await expect(
      w.service.recoverSection(sa, { newAdministratorAccountId: 'bob', confirm: 'RECOVER' }),
    ).resolves.toEqual({ recovered: true });
    const view = await w.service.getSection(ctxFor('bob'));
    expect(view.state === 'READY' && view.role === 'ADMINISTER').toBe(true);
    const audit = await w.service.listAudit(ctxFor('bob'), null);
    expect(audit.entries[0]).toMatchObject({ action: 'ADMIN_RECOVERY', actor: 'siteadmin' });
  });

  it('recovery fails closed when administrator status cannot be established', async () => {
    const w = await world();
    w.gateway.addUser('siteadmin');
    w.gateway.setPage('1001', 'siteadmin', { canView: true, canEdit: false });
    w.gateway.siteAdmins.add('siteadmin');
    w.gateway.deactivate('alice');
    w.gateway.failing.add('users');
    await expect(
      w.service.recoverSection(ctxFor('siteadmin'), {
        newAdministratorAccountId: 'bob',
        confirm: 'RECOVER',
      }),
    ).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  });

  it('an active admin group blocks recovery; an empty one does not', async () => {
    const w = await world();
    w.gateway.addUser('siteadmin');
    w.gateway.setPage('1001', 'siteadmin', { canView: true, canEdit: false });
    w.gateway.siteAdmins.add('siteadmin');
    await w.service.upsertGrant(alice, {
      principalType: 'GROUP',
      principalId: 'g1',
      role: 'ADMINISTER',
      expectedAclVersion: 1,
    });
    w.gateway.deactivate('alice');
    const input = { newAdministratorAccountId: 'bob', confirm: 'RECOVER' };
    await expect(w.service.recoverSection(ctxFor('siteadmin'), input)).rejects.toMatchObject({
      code: 'NOT_RECOVERABLE',
    });
    w.gateway.removeFromGroup('g1', 'dave');
    await expect(w.service.recoverSection(ctxFor('siteadmin'), input)).resolves.toEqual({
      recovered: true,
    });
  });

  it('a site admin cannot read content through recovery or diagnostics', async () => {
    const w = await world();
    await w.service.saveContent(
      alice,
      {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'TOP-SECRET' }] }],
      },
      1,
    );
    w.gateway.addUser('siteadmin');
    w.gateway.setPage('1001', 'siteadmin', { canView: true, canEdit: false });
    w.gateway.siteAdmins.add('siteadmin');
    const diag = await w.service.getDiagnostics(ctxFor('siteadmin'));
    expect(JSON.stringify(diag)).not.toContain('TOP-SECRET');
    expect((await w.service.getSection(ctxFor('siteadmin'))).state).toBe('DENIED');
  });

  it('diagnostics are restricted to site administrators', async () => {
    const w = await world();
    await expect(w.service.getDiagnostics(alice)).rejects.toMatchObject({ code: 'DENIED' });
  });
});
