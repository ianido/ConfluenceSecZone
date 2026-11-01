import { describe, expect, it } from 'vitest';
import { EMPTY_DOC } from '@secure-sections/shared';
import { ctxFor, makeWorld, type World } from '../testing/world.js';

const A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const B = 'bbbbbbbb-0000-4000-8000-00000000000b';

function setup(): World {
  const w = makeWorld();
  for (const u of ['alice', 'bob', 'carol', 'mallory']) w.gateway.addUser(u);
  for (const p of ['1001', '1002']) {
    w.gateway.setPage(p, 'alice', { canView: true, canEdit: true });
    w.gateway.setPage(p, 'bob', { canView: true, canEdit: false });
    w.gateway.setPage(p, 'carol', { canView: true, canEdit: true });
    w.gateway.setPage(p, 'mallory', { canView: true, canEdit: true });
  }
  return w;
}

const doc = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

describe('section lifecycle and binding', () => {
  it('shows an unconfigured placeholder before setup and honours page edit rights', async () => {
    const w = setup();
    expect(await w.service.getSection(ctxFor('alice'))).toEqual({
      state: 'UNCONFIGURED',
      canCreate: true,
    });
    expect(await w.service.getSection(ctxFor('bob'))).toEqual({
      state: 'UNCONFIGURED',
      canCreate: false,
    });
  });

  it('creates idempotently with the creator as first administrator', async () => {
    const w = setup();
    const v1 = await w.service.createSection(ctxFor('alice'));
    const v2 = await w.service.createSection(ctxFor('alice'));
    expect(v1.state).toBe('READY');
    expect(v2).toEqual(v1);
    if (v1.state === 'READY') {
      expect(v1.role).toBe('ADMINISTER');
      expect(v1.content.doc).toEqual(EMPTY_DOC);
    }
    expect(w.store.dump('section')).toHaveLength(1);
  });

  it('refuses setup without page edit permission', async () => {
    const w = setup();
    await expect(w.service.createSection(ctxFor('bob'))).rejects.toMatchObject({
      code: 'PAGE_EDIT_REQUIRED',
    });
  });

  it('refuses setup for users without page view access (generic denial)', async () => {
    const w = setup();
    await expect(w.service.createSection(ctxFor('nobody'))).rejects.toMatchObject({
      code: 'DENIED',
    });
  });

  it('concurrent creation by two users yields exactly one section; loser sees normal access rules', async () => {
    const w = setup();
    const [a, c] = await Promise.allSettled([
      w.service.createSection(ctxFor('alice')),
      w.service.createSection(ctxFor('carol')),
    ]);
    expect(w.store.dump('section')).toHaveLength(1);
    expect(w.store.dump('binding')).toHaveLength(1);
    const results = [a, c].map((r) => (r.status === 'fulfilled' ? r.value.state : 'ERR'));
    expect(results.sort()).toEqual(['DENIED', 'READY']);
  });

  it('keeps two macros on the same page independent', async () => {
    const w = setup();
    const m1 = ctxFor('alice', { localId: 'aaaaaaaa-1111-4000-8000-000000000001' });
    const m2 = ctxFor('alice', { localId: 'aaaaaaaa-2222-4000-8000-000000000002' });
    await w.service.createSection(m1);
    await w.service.createSection(m2);
    await w.service.saveContent(m1, doc('first'), 1);
    await w.service.saveContent(m2, doc('second'), 1);
    const v1 = await w.service.getSection(m1);
    const v2 = await w.service.getSection(m2);
    expect(JSON.stringify(v1)).toContain('first');
    expect(JSON.stringify(v1)).not.toContain('second');
    expect(JSON.stringify(v2)).toContain('second');
    expect(w.store.dump('section')).toHaveLength(2);
  });

  it('a copied page (new page id, same localId) renders unconfigured and never references original content', async () => {
    const w = setup();
    await w.service.createSection(ctxFor('alice'));
    await w.service.saveContent(ctxFor('alice'), doc('SECRET-ALPHA'), 1);
    const copy = ctxFor('alice', { pageId: '1002' });
    const view = await w.service.getSection(copy);
    expect(view).toEqual({ state: 'UNCONFIGURED', canCreate: true });
    expect(JSON.stringify(view)).not.toContain('SECRET');
  });

  it('a new macro created on a copied page cannot hijack the original section', async () => {
    const w = setup();
    await w.service.createSection(ctxFor('alice'));
    await w.service.saveContent(ctxFor('alice'), doc('SECRET-ALPHA'), 1);
    const attacker = ctxFor('mallory', { pageId: '1002' });
    const created = await w.service.createSection(attacker);
    expect(created.state).toBe('READY');
    expect(JSON.stringify(created)).not.toContain('SECRET');
    expect(w.store.dump('section')).toHaveLength(2);
  });

  it('an attacker with page edit rights who reuses the localId on the SAME page gets no access', async () => {
    const w = setup();
    await w.service.createSection(ctxFor('alice'));
    await w.service.saveContent(ctxFor('alice'), doc('SECRET-ALPHA'), 1);
    expect(await w.service.getSection(ctxFor('mallory'))).toEqual({ state: 'DENIED' });
  });

  it('malicious client parameters cannot substitute identity, page, macro or section', async () => {
    const w = setup();
    await w.service.createSection(ctxFor('alice'));
    await w.service.saveContent(ctxFor('alice'), doc('SECRET-ALPHA'), 1);
    const mallory = ctxFor('mallory');
    const res = await w.handlers.saveContent({
      context: { ...(await import('../testing/world.js')).rawContext(mallory) },
      payload: {
        doc: doc('pwned'),
        baseVersion: 1,
        accountId: 'alice',
        pageId: '1001',
        localId: mallory.localId,
        sectionId: A,
        sectionRef: A,
        cloudId: 'cloud-1',
      },
    });
    expect(res).toMatchObject({ ok: false, code: 'DENIED' });
    const view = await w.service.getSection(ctxFor('alice'));
    expect(JSON.stringify(view)).not.toContain('pwned');
  });

  it('bindHere requires ADMINISTER on the existing section and page edit; failures are indistinguishable', async () => {
    const w = setup();
    await w.service.createSection(ctxFor('alice'));
    const { sectionRef } = await w.service.getShareReference(ctxFor('alice'));
    const target = ctxFor('alice', { pageId: '1002' });
    // carol has no grant: same error as unknown ref
    const carol = ctxFor('carol', { pageId: '1002' });
    await expect(w.service.bindHere(carol, sectionRef)).rejects.toMatchObject({ code: 'DENIED' });
    await expect(w.service.bindHere(carol, B)).rejects.toMatchObject({ code: 'DENIED' });
    const v = await w.service.bindHere(target, sectionRef);
    expect(v.state).toBe('READY');
    expect(w.store.dump('section')).toHaveLength(1);
    expect(w.store.dump('binding')).toHaveLength(2);
  });

  it('bindHere with a malformed reference is an invalid request', async () => {
    const w = setup();
    await expect(w.service.bindHere(ctxFor('alice'), "'; DROP TABLE x;--")).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
  });

  it('copyHere duplicates content into an independent section with empty ACL (copier is admin) and audits both sides', async () => {
    const w = setup();
    const src = ctxFor('alice');
    await w.service.createSection(src);
    await w.service.saveContent(src, doc('COPY-ME'), 1);
    const { sectionRef } = await w.service.getShareReference(src);
    await w.service.upsertGrant(src, {
      principalType: 'USER',
      principalId: 'bob',
      role: 'VIEW',
      expectedAclVersion: 1,
    });
    const dst = ctxFor('carol', { pageId: '1002' });
    // carol has no VIEW on the source -> denied
    await expect(w.service.copyHere(dst, sectionRef)).rejects.toMatchObject({ code: 'DENIED' });
    await w.service.upsertGrant(src, {
      principalType: 'USER',
      principalId: 'carol',
      role: 'VIEW',
      expectedAclVersion: 2,
    });
    const v = await w.service.copyHere(dst, sectionRef);
    expect(v.state).toBe('READY');
    if (v.state === 'READY') {
      expect(v.role).toBe('ADMINISTER');
      expect(JSON.stringify(v.content.doc)).toContain('COPY-ME');
    }
    const grants = await w.service.listGrants(dst);
    expect(grants.grants.map((g) => g.principalId)).toEqual(['carol']);
    const srcAudit = await w.service.listAudit(src, null);
    expect(srcAudit.entries.some((e) => e.action === 'SECTION_COPY')).toBe(true);
  });

  it('copyHere requires the source page to still be viewable by the copier', async () => {
    const w = setup();
    const src = ctxFor('alice');
    await w.service.createSection(src);
    const { sectionRef } = await w.service.getShareReference(src);
    await w.service.upsertGrant(src, {
      principalType: 'USER',
      principalId: 'carol',
      role: 'VIEW',
      expectedAclVersion: 1,
    });
    w.gateway.setPage('1001', 'carol', { canView: false, canEdit: false });
    await expect(
      w.service.copyHere(ctxFor('carol', { pageId: '1002' }), sectionRef),
    ).rejects.toMatchObject({
      code: 'DENIED',
    });
  });

  it('delete is soft; the macro then shows unconfigured and a new section can replace the stale binding (orphan recovery)', async () => {
    const w = setup();
    const ctx = ctxFor('alice');
    await w.service.createSection(ctx);
    await w.service.saveContent(ctx, doc('GONE'), 1);
    await expect(w.service.deleteSection(ctx, 'nope')).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
    await w.service.deleteSection(ctx, 'DELETE');
    expect(await w.service.getSection(ctx)).toEqual({ state: 'UNCONFIGURED', canCreate: true });
    expect(w.store.dump('section')).toHaveLength(1); // retained for grace period
    const fresh = await w.service.createSection(ctx);
    expect(fresh.state).toBe('READY');
    expect(JSON.stringify(fresh)).not.toContain('GONE');
    expect(w.store.dump('section')).toHaveLength(2);
  });

  it('a dangling binding (section missing) is recoverable and leaks nothing', async () => {
    const w = setup();
    const ctx = ctxFor('alice');
    await w.service.createSection(ctx);
    const sec = w.store.dump('section')[0]!;
    await w.store.transact([{ kind: 'delete', entity: 'section', key: sec.key }]);
    expect(await w.service.getSection(ctx)).toEqual({ state: 'UNCONFIGURED', canCreate: true });
    expect((await w.service.createSection(ctx)).state).toBe('READY');
  });

  it('refuses a binding whose stored identity does not match the trusted context (integrity)', async () => {
    const w = setup();
    const ctx = ctxFor('alice');
    await w.service.createSection(ctx);
    const b = w.store.dump('binding')[0]!;
    w.store.tamper('binding', b.key, (v) => ({ ...(v as object), cloudId: 'other-tenant' }));
    expect(await w.service.getSection(ctx)).toEqual({ state: 'DENIED' });
  });

  it('cross-tenant: a section stamped with another cloudId is never served', async () => {
    const w = setup();
    const ctx = ctxFor('alice');
    await w.service.createSection(ctx);
    const s = w.store.dump('section')[0]!;
    w.store.tamper('section', s.key, (v) => ({ ...(v as object), cloudId: 'other-tenant' }));
    expect(await w.service.getSection(ctx)).toEqual({ state: 'DENIED' });
  });

  it('caps bindings per page', async () => {
    const w = setup();
    for (let i = 0; i < 100; i += 1) {
      const id = `aaaaaaaa-${String(i).padStart(4, '0')}-4000-8000-000000000001`;
      await w.service.createSection(ctxFor('alice', { localId: id }));
    }
    await expect(
      w.service.createSection(ctxFor('alice', { localId: 'aaaaaaaa-9999-4000-8000-000000000001' })),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });
});
