import { describe, expect, it } from 'vitest';
import type { SiteContext } from './context';
import { ctxFor, makeWorld, type World } from '../testing/world';

function site(accountId: string): SiteContext {
  const c = ctxFor(accountId);
  return {
    accountId: c.accountId,
    cloudId: c.cloudId,
    moduleKey: 'secure-sections-home',
    environmentId: c.environmentId,
    locale: 'en',
    pageId: null,
    localId: null,
    spaceKey: null,
  };
}

async function world(): Promise<World> {
  const w = makeWorld();
  w.gateway.addUser('alice', 'Alice');
  w.gateway.addUser('bob', 'Bob');
  w.gateway.setPage('1001', 'alice', { canView: true, canEdit: true });
  w.gateway.setPage('1001', 'bob', { canView: true, canEdit: true });
  return w;
}

describe('my sections', () => {
  it('lists only sections the caller can access and omits content from activity and csv', async () => {
    const w = await world();
    const alice = ctxFor('alice');
    await w.service.createSection(alice, 'Roadmap', 'CONFIDENTIAL');
    await w.service.saveContent(
      alice,
      {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hidden-body-text' }] }],
      },
      1,
    );
    await w.service.upsertGrant(alice, {
      principalType: 'USER',
      principalId: 'bob',
      role: 'VIEW',
      expectedAclVersion: 1,
    });
    const mine = await w.service.listMySections(site('bob'));
    expect(mine.rows).toHaveLength(1);
    expect(mine.rows[0]).toMatchObject({
      title: 'Roadmap',
      classification: 'CONFIDENTIAL',
      role: 'VIEW',
      pageId: '1001',
      pageTitle: 'Page 1001',
      pageStatus: 'OK',
    });
    expect(JSON.stringify(mine)).not.toContain('hidden-body-text');
    const csv = await w.service.exportMyAudit(site('alice'));
    expect(csv.csv).toContain('Roadmap');
    expect(csv.csv).not.toContain('hidden-body-text');
    expect(csv.rows).toBeGreaterThan(0);
    const stranger = await w.service.listMySections(site('nobody'));
    expect(stranger.rows).toHaveLength(0);
  });

  it('lets an administrator delete a section whose page is gone', async () => {
    const w = await world();
    const alice = ctxFor('alice');
    await w.service.createSection(alice, 'Gone', 'INTERNAL');
    const id = (await w.service.getShareReference(alice)).sectionRef;
    w.gateway.setPageMissing('1001');
    const listed = await w.service.listMySections(site('alice'));
    expect(listed.rows[0]?.pageStatus).toBe('MISSING');
    expect(listed.rows[0]?.pageTitle).toBeNull();
    await w.service.deleteOrphan(site('alice'), id, 'DELETE');
    const after = await w.service.listMySections(site('alice'));
    expect(after.rows).toHaveLength(0);
    await expect(w.service.deleteOrphan(site('bob'), id, 'DELETE')).rejects.toMatchObject({
      code: 'DENIED',
    });
  });
});
