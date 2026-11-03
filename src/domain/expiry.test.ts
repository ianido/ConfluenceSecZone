import { describe, expect, it } from 'vitest';
import { ctxFor, makeWorld, type World } from '../testing/world';

async function world(): Promise<World> {
  const w = makeWorld();
  for (const u of ['alice', 'bob', 'carol']) w.gateway.addUser(u);
  for (const u of ['alice', 'bob', 'carol'])
    w.gateway.setPage('1001', u, { canView: true, canEdit: true });
  await w.service.createSection(ctxFor('alice'));
  return w;
}

const alice = ctxFor('alice');
const bob = ctxFor('bob');

describe('temporary grants', () => {
  it('expires a VIEW grant after the timestamp and restores access when renewed', async () => {
    const w = await world();
    const inADay = new Date(w.clock.now().getTime() + 86_400_000).toISOString();
    const listed = await w.service.listGrants(alice);
    await w.service.upsertGrant(alice, {
      principalType: 'USER',
      principalId: 'bob',
      role: 'VIEW',
      expectedAclVersion: listed.aclVersion,
      expiresAt: inADay,
    });
    expect((await w.service.getSection(bob)).state).toBe('READY');
    expect(
      (await w.service.listGrants(alice)).grants.find((g) => g.principalId === 'bob'),
    ).toMatchObject({
      expiresAt: inADay,
    });

    w.clock.advanceDays(2);
    expect((await w.service.getSection(bob)).state).toBe('DENIED');

    const after = await w.service.listGrants(alice);
    const later = new Date(w.clock.now().getTime() + 7 * 86_400_000).toISOString();
    await w.service.upsertGrant(alice, {
      principalType: 'USER',
      principalId: 'bob',
      role: 'VIEW',
      expectedAclVersion: after.aclVersion,
      expiresAt: later,
    });
    expect((await w.service.getSection(bob)).state).toBe('READY');
  });

  it('refuses an expiry that is already past, too far, or not ISO', async () => {
    const w = await world();
    const acl = (await w.service.listGrants(alice)).aclVersion;
    await expect(
      w.service.upsertGrant(alice, {
        principalType: 'USER',
        principalId: 'bob',
        role: 'VIEW',
        expectedAclVersion: acl,
        expiresAt: new Date(w.clock.now().getTime() - 1000).toISOString(),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(
      w.service.upsertGrant(alice, {
        principalType: 'USER',
        principalId: 'bob',
        role: 'VIEW',
        expectedAclVersion: acl,
        expiresAt: 'tomorrow',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(
      w.service.upsertGrant(alice, {
        principalType: 'USER',
        principalId: 'bob',
        role: 'VIEW',
        expectedAclVersion: acl,
        expiresAt: new Date(w.clock.now().getTime() + 400 * 86_400_000).toISOString(),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('does not count an expired administrator toward the last-administrator rule', async () => {
    const w = await world();
    const soon = new Date(w.clock.now().getTime() + 86_400_000).toISOString();
    let acl = (await w.service.listGrants(alice)).aclVersion;
    await w.service.upsertGrant(alice, {
      principalType: 'USER',
      principalId: 'bob',
      role: 'ADMINISTER',
      expectedAclVersion: acl,
      expiresAt: soon,
    });
    acl += 1;
    w.clock.advanceDays(2);
    await expect(
      w.service.revokeGrant(alice, {
        principalType: 'USER',
        principalId: 'alice',
        expectedAclVersion: acl,
      }),
    ).rejects.toMatchObject({ code: 'LAST_ADMINISTRATOR' });
  });

  it('records lastAccessAt at most once per day on a bound operation', async () => {
    const w = await world();
    const listed = await w.service.listGrants(alice);
    await w.service.upsertGrant(alice, {
      principalType: 'USER',
      principalId: 'bob',
      role: 'MODIFY',
      expectedAclVersion: listed.aclVersion,
    });
    await w.service.listRevisions(bob, null);
    const first = (await w.service.listGrants(alice)).grants.find((g) => g.principalId === 'bob');
    expect(first?.lastAccessAt).toBeTruthy();
    await w.service.listRevisions(bob, null);
    const second = (await w.service.listGrants(alice)).grants.find((g) => g.principalId === 'bob');
    expect(second?.lastAccessAt).toBe(first?.lastAccessAt);
    w.clock.advanceDays(1);
    await w.service.listRevisions(bob, null);
    const third = (await w.service.listGrants(alice)).grants.find((g) => g.principalId === 'bob');
    expect(third?.lastAccessAt).not.toBe(first?.lastAccessAt);
  });
});
