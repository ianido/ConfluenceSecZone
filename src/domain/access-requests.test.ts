import { describe, expect, it } from 'vitest';
import { ctxFor, makeWorld, type World } from '../testing/world';
import { LIMITS, REQUEST_TTL_DAYS } from './model';

async function world(): Promise<World> {
  const w = makeWorld();
  for (const u of ['alice', 'bob', 'carol', 'dave']) w.gateway.addUser(u);
  w.gateway.addGroup('g1', 'Group One', ['carol']);
  for (const u of ['alice', 'bob', 'carol', 'dave'])
    w.gateway.setPage('1001', u, { canView: true, canEdit: true });
  await w.service.createSection(alice, 'Q4 plan', 'CONFIDENTIAL');
  return w;
}

const alice = ctxFor('alice');
const bob = ctxFor('bob');
const carol = ctxFor('carol');
describe('access requests', () => {
  it('tells a page viewer without a grant the public title, classification and administrator names', async () => {
    const w = await world();
    const info = await w.service.getAccessInfo(bob);
    expect(info).toEqual({
      title: 'Q4 plan',
      classification: 'CONFIDENTIAL',
      administrators: [{ accountId: 'alice', displayName: 'alice' }],
      myRequest: null,
    });
    expect(await w.service.getSection(bob)).toEqual({ state: 'DENIED' });
  });

  it('does not disclose access info to someone who already has a grant or no page access', async () => {
    const w = await world();
    await expect(w.service.getAccessInfo(alice)).rejects.toMatchObject({ code: 'DENIED' });
    w.gateway.setPage('1001', 'mallory', { canView: false, canEdit: false });
    await expect(w.service.getAccessInfo(ctxFor('mallory'))).rejects.toMatchObject({
      code: 'DENIED',
    });
  });

  it('records, updates and cancels a request; never stores content and never grants on its own', async () => {
    const w = await world();
    const sent = await w.service.requestAccess(bob, { role: 'VIEW', reason: 'Need the table' });
    expect(sent.myRequest).toMatchObject({ role: 'VIEW', reason: 'Need the table' });
    const again = await w.service.requestAccess(bob, { role: 'VIEW', reason: 'Need the table' });
    expect(again.myRequest?.requestedAt).toBe(sent.myRequest?.requestedAt);

    const updated = await w.service.requestAccess(bob, { role: 'MODIFY', reason: '' });
    expect(updated.myRequest).toMatchObject({ role: 'MODIFY', reason: '' });
    expect((await w.service.getSection(bob)).state).toBe('DENIED');

    const cancelled = await w.service.cancelAccessRequest(bob);
    expect(cancelled.myRequest).toBeNull();
    const audit = await w.service.listAudit(alice, null);
    expect(audit.entries.map((e) => e.action).slice(0, 4)).toEqual([
      'ACCESS_REQUEST_CANCEL',
      'ACCESS_REQUEST',
      'ACCESS_REQUEST',
      'SECTION_CREATE',
    ]);
    expect(JSON.stringify(audit)).not.toContain('Need the table');
    expect(audit.chain).toBe('OK');
  });

  it.each([
    ['admin role', 'ADMINISTER', 'ok'],
    ['unknown role', 'OWNER', 'ok'],
    ['too long reason', 'VIEW', 'x'.repeat(281)],
    ['control reason', 'VIEW', 'a\nb'],
  ])('rejects invalid request input: %s', async (_n, role, reason) => {
    const w = await world();
    await expect(w.service.requestAccess(bob, { role, reason })).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
  });

  it('caps pending requests and expires them after the TTL', async () => {
    const w = await world();
    for (let i = 0; i < LIMITS.maxPendingRequests; i += 1) {
      const id = `u${i}`;
      w.gateway.addUser(id);
      w.gateway.setPage('1001', id, { canView: true, canEdit: true });
      await w.service.requestAccess(ctxFor(id), { role: 'VIEW', reason: '' });
    }
    await expect(w.service.requestAccess(bob, { role: 'VIEW', reason: '' })).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
    w.clock.advanceDays(REQUEST_TTL_DAYS + 1);
    const after = await w.service.requestAccess(bob, { role: 'VIEW', reason: '' });
    expect(after.myRequest?.role).toBe('VIEW');
    const listed = await w.service.listAccessRequests(alice);
    expect(listed.requests).toHaveLength(1);
    expect(listed.requests[0]?.accountId).toBe('bob');
  });

  it('lets an administrator approve (granting the requested role) or reject', async () => {
    const w = await world();
    await w.service.requestAccess(bob, { role: 'MODIFY', reason: 'edit the numbers' });
    await w.service.requestAccess(carol, { role: 'VIEW', reason: '' });
    let listed = await w.service.listAccessRequests(alice);
    expect(listed.requests.map((r) => r.accountId)).toEqual(['bob', 'carol']);

    listed = await w.service.resolveAccessRequest(alice, {
      accountId: 'bob',
      decision: 'APPROVE',
      expectedAclVersion: listed.aclVersion,
    });
    expect(listed.requests.map((r) => r.accountId)).toEqual(['carol']);
    expect((await w.service.getSection(bob)).state).toBe('READY');
    expect(((await w.service.getSection(bob)) as { role: string }).role).toBe('MODIFY');

    listed = await w.service.resolveAccessRequest(alice, {
      accountId: 'carol',
      decision: 'REJECT',
      expectedAclVersion: listed.aclVersion,
    });
    expect(listed.requests).toEqual([]);
    expect((await w.service.getSection(carol)).state).toBe('DENIED');
  });

  it('approval uses the ACL version and refuses when it is stale', async () => {
    const w = await world();
    await w.service.requestAccess(bob, { role: 'VIEW', reason: '' });
    const listed = await w.service.listAccessRequests(alice);
    await w.service.upsertGrant(alice, {
      principalType: 'USER',
      principalId: 'dave',
      role: 'VIEW',
      expectedAclVersion: listed.aclVersion,
    });
    await expect(
      w.service.resolveAccessRequest(alice, {
        accountId: 'bob',
        decision: 'APPROVE',
        expectedAclVersion: listed.aclVersion,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await w.service.getSection(bob)).state).toBe('DENIED');
  });

  it('adding a grant yourself clears that person pending request', async () => {
    const w = await world();
    await w.service.requestAccess(bob, { role: 'VIEW', reason: '' });
    const listed = await w.service.listAccessRequests(alice);
    await w.service.upsertGrant(alice, {
      principalType: 'USER',
      principalId: 'bob',
      role: 'VIEW',
      expectedAclVersion: listed.aclVersion,
    });
    expect((await w.service.listAccessRequests(alice)).requests).toEqual([]);
  });

  it('is administrator-only to list or resolve; VIEW cannot', async () => {
    const w = await world();
    await w.service.requestAccess(carol, { role: 'VIEW', reason: '' });
    const listed = await w.service.listAccessRequests(alice);
    await w.service.upsertGrant(alice, {
      principalType: 'USER',
      principalId: 'bob',
      role: 'VIEW',
      expectedAclVersion: listed.aclVersion,
    });
    await expect(w.service.listAccessRequests(bob)).rejects.toMatchObject({ code: 'DENIED' });
    await expect(
      w.service.resolveAccessRequest(bob, {
        accountId: 'carol',
        decision: 'APPROVE',
        expectedAclVersion: listed.aclVersion,
      }),
    ).rejects.toMatchObject({ code: 'DENIED' });
  });

  it('resolving an unknown request is NOT_FOUND and does not reveal other users', async () => {
    const w = await world();
    await expect(
      w.service.resolveAccessRequest(alice, {
        accountId: 'bob',
        decision: 'REJECT',
        expectedAclVersion: 1,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
