import { describe, expect, it } from 'vitest';
import { DEFAULT_RETENTION, DEFAULT_SITE_POLICY, Keys } from './model';
import type { SiteContext } from './context';
import { ctxFor, makeWorld, type World } from '../testing/world';

function site(accountId: string): SiteContext {
  const c = ctxFor(accountId);
  return {
    accountId,
    cloudId: c.cloudId,
    moduleKey: 'secure-sections-admin',
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
  w.gateway.siteAdmins.add('alice');
  w.gateway.setPage('1001', 'alice', { canView: true, canEdit: true });
  w.gateway.setPage('1001', 'bob', { canView: true, canEdit: true });
  return w;
}

describe('site administration', () => {
  it('is refused to someone who is not a site administrator', async () => {
    const w = await world();
    await expect(w.service.getAdminOverview(site('bob'))).rejects.toMatchObject({ code: 'DENIED' });
  });

  it('saves policy and retention, and the guest grant cap follows the policy', async () => {
    const w = await world();
    const alice = ctxFor('alice');
    await w.service.createSection(alice, 'Plan', 'INTERNAL');
    const overview = await w.service.getAdminOverview(site('alice'));
    expect(overview.policy.maxGrantDays).toBe(DEFAULT_SITE_POLICY.maxGrantDays);
    expect(overview.policy.lockByDefault).toBe(true);
    expect(overview.retention).toEqual(DEFAULT_RETENTION);
    expect(overview.sectionCount).toBe(1);
    const next = await w.service.updateSitePolicy(
      site('alice'),
      { ...overview.policy, maxGrantDays: 7, allowRequests: false },
      { ...overview.retention, revisionsKeep: 10 },
    );
    expect(next.policy.maxGrantDays).toBe(7);
    expect(next.policy.allowRequests).toBe(false);
    expect(next.retention.revisionsKeep).toBe(10);
    const soon = new Date(w.clock.now().getTime() + 30 * 86_400_000).toISOString();
    await expect(
      w.service.upsertGrant(alice, {
        principalType: 'USER',
        principalId: 'bob',
        role: 'VIEW',
        expectedAclVersion: 1,
        expiresAt: soon,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(
      w.service.requestAccess(ctxFor('bob'), { role: 'VIEW', reason: '' }),
    ).rejects.toMatchObject({
      code: 'DENIED',
    });
  });

  it('stores open-locked as a site policy and treats a missing value as on', async () => {
    const w = await world();
    const alice = ctxFor('alice');
    await w.service.createSection(alice, 'Plan', 'INTERNAL');
    const overview = await w.service.getAdminOverview(site('alice'));
    const off = await w.service.updateSitePolicy(
      site('alice'),
      { ...overview.policy, lockByDefault: false },
      overview.retention,
    );
    expect(off.policy.lockByDefault).toBe(false);
    const open = await w.service.getSection(alice);
    expect(open).toMatchObject({ state: 'READY', protection: { lockByDefault: false } });

    w.store.tamper('meta', Keys.meta('site-policy'), (value) => {
      const doc = value as { value: Record<string, unknown> };
      delete doc.value.lockByDefault;
      return doc;
    });
    const again = await w.service.getSection(alice);
    expect(again).toMatchObject({ protection: { lockByDefault: true } });
  });

  it('lists a section with no active administrator and recovers it without returning content', async () => {
    const w = await world();
    const alice = ctxFor('alice');
    await w.service.createSection(alice, 'Orphaned', 'RESTRICTED');
    w.gateway.deactivate('alice');
    w.gateway.setPageMissing('1001');
    const overview = await w.service.getAdminOverview(site('alice'));
    expect(overview.noAdmin).toHaveLength(1);
    expect(overview.orphans).toHaveLength(1);
    expect(JSON.stringify(overview)).not.toContain('bodyJson');
    const id = overview.noAdmin[0]!.sectionId;
    await w.service.recoverUnowned(site('alice'), id, 'bob', 'RECOVER');
    const after = await w.service.getAdminOverview(site('alice'));
    expect(after.noAdmin).toHaveLength(0);
  });
});
