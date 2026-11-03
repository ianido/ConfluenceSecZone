import { describe, expect, it } from 'vitest';
import { ctxFor, makeWorld, type World } from '../testing/world';

async function world(): Promise<World> {
  const w = makeWorld();
  for (const u of ['alice', 'bob', 'carol']) w.gateway.addUser(u);
  w.gateway.addGroup('g1', 'Group One', ['carol']);
  for (const u of ['alice', 'bob', 'carol'])
    w.gateway.setPage('1001', u, { canView: true, canEdit: true });
  return w;
}

const alice = ctxFor('alice');
const bob = ctxFor('bob');

describe('section metadata (title and classification)', () => {
  it('is empty by default and counts shared principals', async () => {
    const w = await world();
    const v = await w.service.createSection(alice);
    expect(v).toMatchObject({
      state: 'READY',
      meta: { title: null, classification: null, sharedWith: { users: 1, groups: 0 } },
    });
  });

  it('is set at creation, trimmed and validated', async () => {
    const w = await world();
    const v = await w.service.createSection(alice, '  Q4 plan  ', 'CONFIDENTIAL');
    expect(v).toMatchObject({ meta: { title: 'Q4 plan', classification: 'CONFIDENTIAL' } });
    const audit = await w.service.listAudit(alice, null);
    expect(audit.entries[0]?.meta).toMatchObject({ classification: 'CONFIDENTIAL' });
    expect(JSON.stringify(audit)).not.toContain('Q4 plan');
  });

  it.each([
    ['too long', 'x'.repeat(81), 'INTERNAL'],
    ['control character', 'a\u0000b', 'INTERNAL'],
    ['newline', 'a\nb', 'INTERNAL'],
    ['non-string title', 42, 'INTERNAL'],
    ['unknown classification', 'ok', 'TOP_SECRET'],
    ['prototype classification', 'ok', '__proto__'],
  ])('rejects invalid input at creation: %s', async (_n, title, classification) => {
    const w = await world();
    await expect(w.service.createSection(alice, title, classification)).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
    expect((await w.service.getSection(alice)).state).toBe('UNCONFIGURED');
  });

  it('administrators update it with an audit entry; readers see it; unchanged is a no-op', async () => {
    const w = await world();
    await w.service.createSection(alice);
    const meta = await w.service.updateMetadata(alice, {
      title: 'Compensation',
      classification: 'RESTRICTED',
    });
    expect(meta).toMatchObject({ title: 'Compensation', classification: 'RESTRICTED' });
    await w.service.updateMetadata(alice, { title: 'Compensation', classification: 'RESTRICTED' });
    const audit = await w.service.listAudit(alice, null);
    expect(audit.entries.filter((e) => e.action === 'METADATA_UPDATE')).toHaveLength(1);
    expect(audit.chain).toBe('OK');

    await w.service.updateMetadata(alice, { title: '', classification: null });
    expect(await w.service.getSection(alice)).toMatchObject({
      meta: { title: null, classification: null },
    });
  });

  it('is limited to administrators and never changes content, access or versions', async () => {
    const w = await world();
    await w.service.createSection(alice);
    const grants = await w.service.listGrants(alice);
    await w.service.upsertGrant(alice, {
      principalType: 'USER',
      principalId: 'bob',
      role: 'MODIFY',
      expectedAclVersion: grants.aclVersion,
    });
    await expect(
      w.service.updateMetadata(bob, { title: 'hijack', classification: null }),
    ).rejects.toMatchObject({ code: 'DENIED' });
    await expect(
      w.service.updateMetadata(ctxFor('carol'), { title: 'x', classification: null }),
    ).rejects.toMatchObject({ code: 'DENIED' });
    const before = await w.service.getSection(alice);
    await w.service.updateMetadata(alice, { title: 'T', classification: 'INTERNAL' });
    const after = await w.service.getSection(alice);
    expect(after).toMatchObject({
      aclVersion: (before as { aclVersion: number }).aclVersion,
      content: { version: 1 },
    });
  });

  it('counts people and groups with access', async () => {
    const w = await world();
    await w.service.createSection(alice);
    let acl = (await w.service.listGrants(alice)).aclVersion;
    await w.service.upsertGrant(alice, {
      principalType: 'USER',
      principalId: 'bob',
      role: 'VIEW',
      expectedAclVersion: acl,
    });
    acl += 1;
    await w.service.upsertGrant(alice, {
      principalType: 'GROUP',
      principalId: 'g1',
      role: 'VIEW',
      expectedAclVersion: acl,
    });
    expect(await w.service.getSection(alice)).toMatchObject({
      meta: { sharedWith: { users: 2, groups: 1 } },
    });
  });

  it('is not exposed through getSection to users without a grant', async () => {
    const w = await world();
    await w.service.createSection(alice, 'Secret-ish title', 'RESTRICTED');
    expect(await w.service.getSection(bob)).toEqual({ state: 'DENIED' });
  });
});
