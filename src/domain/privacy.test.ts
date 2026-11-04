import { describe, expect, it } from 'vitest';
import { ctxFor, makeWorld } from '../testing/world';

const alice = ctxFor('alice');

async function world() {
  const w = makeWorld();
  for (const u of ['alice', 'bob'])
    w.gateway.addUser(u).setPage('1001', u, { canView: true, canEdit: true });
  await w.service.createSection(alice);
  await w.service.upsertGrant(alice, {
    principalType: 'USER',
    principalId: 'bob',
    role: 'ADMINISTER',
    expectedAclVersion: 1,
  });
  await w.service.saveContent(ctxFor('bob'), { type: 'doc', content: [{ type: 'paragraph' }] }, 1);
  return w;
}

describe('privacy: pending access requests', () => {
  it('erases a closed account from pending requests', async () => {
    const w = makeWorld();
    for (const u of ['alice', 'carol'])
      w.gateway.addUser(u).setPage('1001', u, { canView: true, canEdit: true });
    await w.service.createSection(alice);
    await w.service.requestAccess(ctxFor('carol'), { role: 'VIEW', reason: 'please' });
    w.privacyGateway.closed.add('carol');
    await w.privacy.sweep();
    expect(JSON.stringify(w.store.dump())).not.toContain('"carol"');
    expect((await w.service.listAccessRequests(alice)).requests).toEqual([]);
  });
});

describe('privacy: closed accounts', () => {
  it('reports stored accountIds and anonymises closed ones everywhere, keeping the chain verifiable', async () => {
    const w = await world();
    w.privacyGateway.closed.add('bob');
    const res = await w.privacy.sweep();
    expect(res.accountsReported).toBe(2);
    expect(res.accountsErased).toBe(1);
    const dump = JSON.stringify(w.store.dump());
    expect(dump).not.toContain('"bob"');
    const grants = await w.service.listGrants(alice);
    expect(grants.grants.map((g) => g.principalId)).toEqual(['alice']);
    const audit = await w.service.listAudit(alice, null);
    expect(audit.chain).toBe('OK');
    expect(audit.entries.some((e) => e.actor.startsWith('erased:'))).toBe(true);
    const hist = await w.service.listRevisions(alice, null);
    expect(hist.revisions.some((r) => r.author?.accountId.startsWith('erased:'))).toBe(true);
  });

  it('never strands a section: an erased last administrator is pseudonymised, not deleted, and recoverable', async () => {
    const w = await world();
    await w.service.revokeGrant(alice, {
      principalType: 'USER',
      principalId: 'alice',
      expectedAclVersion: 2,
    });
    w.privacyGateway.closed.add('bob');
    await w.privacy.sweep();
    const sec = w.store.dump('section')[0]!.value as {
      grants: Array<{ principalId: string }>;
      ownerAccountId: string;
    };
    expect(sec.grants).toHaveLength(1);
    expect(sec.grants[0]?.principalId.startsWith('erased:')).toBe(true);
    expect(JSON.stringify(w.store.dump())).not.toContain('"bob"');
  });

  it('does nothing for accounts that are not closed', async () => {
    const w = await world();
    const snapshot = () => JSON.stringify(w.store.dump().filter((r) => r.entity !== 'meta'));
    const before = snapshot();
    await w.privacy.sweep();
    expect(snapshot()).toBe(before);
  });
});

describe('privacy: reporting cycle', () => {
  it('does not re-report accounts within the 7-day cycle and resumes afterwards', async () => {
    const w = await world();
    const first = await w.privacy.sweep();
    expect(first.skipped).toBeUndefined();
    expect(w.privacyGateway.calls).toBe(1);

    const second = await w.privacy.sweep();
    expect(second.skipped).toBe(true);
    expect(w.privacyGateway.calls).toBe(1);

    w.clock.advanceDays(6);
    expect((await w.privacy.sweep()).skipped).toBe(true);

    w.clock.advanceDays(2);
    const third = await w.privacy.sweep();
    expect(third.skipped).toBeUndefined();
    expect(w.privacyGateway.calls).toBe(2);
  });
});
