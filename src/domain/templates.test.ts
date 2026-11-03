import { describe, expect, it } from 'vitest';
import type { SiteContext } from './context';
import { ctxFor, makeWorld, type World } from '../testing/world';

function site(accountId: string, pageId: string | null): SiteContext {
  const c = ctxFor(accountId, pageId ? { pageId } : {});
  return {
    accountId,
    cloudId: c.cloudId,
    moduleKey: 'secure-sections-byline',
    environmentId: c.environmentId,
    locale: 'en',
    pageId,
    localId: null,
    spaceKey: 'SEC',
  };
}

async function world(): Promise<World> {
  const w = makeWorld();
  for (const u of ['alice', 'bob', 'carol']) w.gateway.addUser(u, u);
  for (const u of ['alice', 'bob', 'carol']) {
    w.gateway.setPage('1001', u, { canView: true, canEdit: u !== 'carol' });
  }
  return w;
}

describe('templates and the page byline', () => {
  it('seeds a credentials document and an initial grant without putting the placeholder in the audit', async () => {
    const w = await world();
    const alice = ctxFor('alice');
    const view = await w.service.createSection(alice, 'Vault', 'RESTRICTED', {
      template: 'credentials',
      initialGrants: [{ principalType: 'USER', principalId: 'bob', role: 'VIEW' }],
    });
    expect(view).toMatchObject({ state: 'READY' });
    if (view.state !== 'READY') return;
    expect(JSON.stringify(view.content.doc)).toContain('replace-me');
    const bob = await w.service.getSection(ctxFor('bob'));
    expect(bob).toMatchObject({ state: 'READY', role: 'VIEW', notice: { role: 'VIEW' } });
    const audit = await w.service.listAudit(alice, null);
    expect(JSON.stringify(audit)).not.toContain('replace-me');
  });

  it('lets a page editor search the directory before the section exists', async () => {
    const w = await world();
    const hits = await w.service.searchPrincipals(ctxFor('alice'), 'bo', 'USER');
    expect(hits.hits.map((h) => h.principalId)).toContain('bob');
    await expect(w.service.searchPrincipals(ctxFor('carol'), 'bo', 'USER')).rejects.toMatchObject({
      code: 'DENIED',
    });
  });

  it('lists titles and the caller role on the page, never the content', async () => {
    const w = await world();
    await w.service.createSection(ctxFor('alice'), 'Roadmap', 'CONFIDENTIAL', {
      template: 'minutes',
    });
    await w.service.saveContent(
      ctxFor('alice'),
      {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hidden-minutes' }] }],
      },
      1,
    );
    const page = await w.service.listPageSections(site('carol', '1001'));
    expect(page.sections).toEqual([
      expect.objectContaining({
        title: 'Roadmap',
        classification: 'CONFIDENTIAL',
        role: null,
      }),
    ]);
    expect(JSON.stringify(page)).not.toContain('hidden-minutes');
    await expect(w.service.listPageSections(site('carol', null))).rejects.toMatchObject({
      code: 'DENIED',
    });
  });
});
