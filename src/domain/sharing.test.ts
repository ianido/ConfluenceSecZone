import { describe, expect, it } from 'vitest';
import { ctxFor, makeWorld, type World } from '../testing/world';

async function world(): Promise<World> {
  const w = makeWorld();
  for (const u of ['alice', 'bob', 'carol', 'mallory']) w.gateway.addUser(u, u);
  w.gateway.addGroup('g1', 'Group One', ['carol']);
  for (const u of ['alice', 'bob', 'carol', 'mallory']) {
    w.gateway.setPage('1001', u, { canView: true, canEdit: true });
  }
  return w;
}

const alice = ctxFor('alice');
const other = ctxFor('alice', { localId: 'bbbbbbbb-0000-4000-8000-000000000002' });

describe('copy grants, page restrictions and in-app notices', () => {
  it('copies missing grants, keeps existing ones, and notices the people who were added', async () => {
    const w = await world();
    await w.service.createSection(alice);
    await w.service.createSection(other);
    await w.service.upsertGrant(alice, {
      principalType: 'USER',
      principalId: 'bob',
      role: 'VIEW',
      expectedAclVersion: 1,
    });
    await w.service.upsertGrant(other, {
      principalType: 'USER',
      principalId: 'carol',
      role: 'MODIFY',
      expectedAclVersion: 1,
    });
    const ref = (await w.service.getShareReference(alice)).sectionRef;
    const copied = await w.service.copyGrants(other, ref, 2);
    const ids = copied.grants.map((g) => g.principalId).sort();
    expect(ids).toEqual(['alice', 'bob', 'carol']);
    const carol = copied.grants.find((g) => g.principalId === 'carol');
    expect(carol?.role).toBe('MODIFY');

    const bob = ctxFor('bob');
    const view = await w.service.getSection(bob);
    expect(view).toMatchObject({
      state: 'READY',
      notice: { role: 'VIEW', addedByName: 'alice' },
    });
    await w.service.dismissNotice(bob);
    const after = await w.service.getSection(bob);
    expect(after).toMatchObject({ state: 'READY', notice: null });
  });

  it('does not tell the caller whether a source reference exists', async () => {
    const w = await world();
    await w.service.createSection(alice);
    const missing = '00000000-0000-4000-8000-000000000099';
    await expect(w.service.copyGrants(alice, missing, 1)).rejects.toMatchObject({ code: 'DENIED' });
    await w.service.createSection(other);
    const ref = (await w.service.getShareReference(other)).sectionRef;
    const mallory = ctxFor('mallory', { localId: other.localId });
    await expect(w.service.copyGrants(mallory, ref, 1)).rejects.toMatchObject({ code: 'DENIED' });
  });

  it('seeds view and edit restrictions without removing the creator', async () => {
    const w = await world();
    await w.service.createSection(alice);
    w.gateway.setRestrictions('1001', [
      { principalType: 'USER', principalId: 'bob', operation: 'read' },
      { principalType: 'USER', principalId: 'bob', operation: 'update' },
      { principalType: 'USER', principalId: 'carol', operation: 'read' },
      { principalType: 'GROUP', principalId: 'g1', operation: 'read' },
      { principalType: 'USER', principalId: 'ghost', operation: 'read' },
    ]);
    const list = await w.service.seedPageRestrictions(alice, 1);
    const bob = list.grants.find((g) => g.principalId === 'bob');
    const carol = list.grants.find((g) => g.principalId === 'carol');
    expect(bob?.role).toBe('MODIFY');
    expect(carol?.role).toBe('VIEW');
    expect(list.grants.some((g) => g.principalId === 'g1')).toBe(true);
    expect(list.grants.some((g) => g.principalId === 'ghost')).toBe(false);
    expect(list.grants.some((g) => g.principalId === 'alice' && g.role === 'ADMINISTER')).toBe(
      true,
    );
    const again = await w.service.seedPageRestrictions(alice, list.aclVersion);
    expect(again.aclVersion).toBe(list.aclVersion);
  });
});
