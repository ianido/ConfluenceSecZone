import { describe, expect, it } from 'vitest';
import { RESOLVER_FUNCTIONS } from '@secure-sections/shared';
import { ctxFor, makeWorld, rawContext, type World } from '../src/testing/world.js';

const doc = (t: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }],
});
const SECRET = 'TOP-SECRET-PAYLOAD-9f3a';

async function world(): Promise<World> {
  const w = makeWorld();
  for (const u of ['alice', 'bob', 'mallory', 'nopage']) w.gateway.addUser(u);
  const full = { canView: true, canEdit: true };
  for (const u of ['alice', 'bob', 'mallory']) w.gateway.setPage('1001', u, full);
  await w.service.createSection(ctxFor('alice'));
  await w.service.saveContent(ctxFor('alice'), doc(SECRET), 1);
  return w;
}

const call = (w: World, fn: string, who: string, payload?: unknown, ctxOverride = {}) =>
  (w.handlers as unknown as Record<string, (r: unknown) => Promise<unknown>>)[fn]!({
    payload,
    context: rawContext(ctxFor(who, ctxOverride)),
  });

describe('resolver surface: every function denies unauthorised callers and leaks nothing', () => {
  const payloads: Record<string, unknown> = {
    saveContent: { doc: doc('x'), baseVersion: 2 },
    getRevision: { version: 1 },
    restoreRevision: { version: 1, baseVersion: 2 },
    searchPrincipals: { query: 'a', type: 'USER' },
    upsertGrant: {
      principalType: 'USER',
      principalId: 'mallory',
      role: 'ADMINISTER',
      expectedAclVersion: 1,
    },
    revokeGrant: { principalType: 'USER', principalId: 'alice', expectedAclVersion: 1 },
    setOwner: { accountId: 'mallory', expectedAclVersion: 1 },
    deleteSection: { confirm: true },
    recoverSection: { newAdministratorAccountId: 'mallory', confirm: true },
    bindHere: { sectionRef: 'x' },
    copyHere: { sourceRef: 'x' },
    updateMetadata: { title: 'hijack', classification: 'RESTRICTED' },
  };

  for (const fn of RESOLVER_FUNCTIONS.filter((f) => f !== 'createSection')) {
    it(`${fn}: page-editor without a grant gets no secret data`, async () => {
      const w = await world();
      const res = await call(w, fn, 'mallory', payloads[fn]);
      expect(JSON.stringify(res)).not.toContain(SECRET);
      if (fn === 'getEffectiveAccess') {
        // Reporting "no role" for the caller's own identity reveals nothing beyond the denied card.
        expect(res).toMatchObject({ ok: true, data: { role: null, sources: [] } });
      } else if (fn !== 'getSection') expect(res).toMatchObject({ ok: false });
      else expect(res).toEqual({ state: 'DENIED' });
    });

    it(`${fn}: user without page access gets no secret data`, async () => {
      const w = await world();
      const res = await call(w, fn, 'nopage', payloads[fn]);
      expect(JSON.stringify(res)).not.toContain(SECRET);
      expect(JSON.stringify(res)).not.toContain('alice');
    });

    it(`${fn}: missing or malformed trusted context fails closed`, async () => {
      const w = await world();
      const h = (w.handlers as unknown as Record<string, (r: unknown) => Promise<unknown>>)[fn]!;
      for (const context of [
        undefined,
        null,
        {},
        'x',
        42,
        { accountId: 'alice' },
        { extension: {} },
      ]) {
        const res = await h({ payload: payloads[fn], context });
        expect(JSON.stringify(res)).not.toContain(SECRET);
      }
    });
  }

  it('createSection by a user who cannot edit the page is refused', async () => {
    const w = await world();
    w.gateway.setPage('2002', 'bob', { canView: true, canEdit: false });
    const res = await call(
      w,
      'createSection',
      'bob',
      {},
      { pageId: '2002', localId: 'bbbbbbbb-0000-4000-8000-000000000002' },
    );
    expect(res).toMatchObject({ ok: false });
  });
});

describe('hostile payloads and identity spoofing', () => {
  it('ignores identity fields smuggled into the payload', async () => {
    const w = await world();
    const res = await call(w, 'getSection', 'mallory', {
      accountId: 'alice',
      pageId: '1001',
      localId: ctxFor('alice').localId,
      role: 'ADMINISTER',
      context: rawContext(ctxFor('alice')),
    });
    expect(res).toEqual({ state: 'DENIED' });
  });

  it('cannot escalate by smuggling accountId into upsertGrant', async () => {
    const w = await world();
    const res = await call(w, 'upsertGrant', 'mallory', {
      accountId: 'alice',
      principalType: 'USER',
      principalId: 'mallory',
      role: 'ADMINISTER',
      expectedAclVersion: 1,
    });
    expect(res).toMatchObject({ ok: false });
    expect(await call(w, 'getSection', 'mallory')).toEqual({ state: 'DENIED' });
  });

  it('a section on another page (copied macro localId) is not readable by id guessing', async () => {
    const w = await world();
    w.gateway.setPage('3003', 'mallory', { canView: true, canEdit: true });
    const res = await call(w, 'getSection', 'mallory', undefined, { pageId: '3003' });
    expect(JSON.stringify(res)).not.toContain(SECRET);
  });

  it.each([
    [
      'prototype pollution key',
      JSON.parse('{"__proto__":{"role":"ADMINISTER"},"constructor":{"prototype":{"x":1}}}'),
    ],
    ['array payload', [1, 2, 3]],
    ['string payload', 'DROP'],
    ['null payload', null],
    ['huge nested payload', { doc: JSON.parse('{"a":'.repeat(500) + '1' + '}'.repeat(500)) }],
    ['huge string', { query: 'a'.repeat(5_000_000) }],
  ])('survives %s on every handler without leaking', async (_n, payload) => {
    const w = await world();
    for (const fn of RESOLVER_FUNCTIONS) {
      const res = await call(w, fn, 'mallory', payload);
      expect(JSON.stringify(res)).not.toContain(SECRET);
    }
    expect(({} as Record<string, unknown>).role).toBeUndefined();
  });

  it('saveContent from an authorised editor rejects hostile documents and keeps prior content', async () => {
    const w = await world();
    const bad = [
      { type: 'doc', content: [{ type: 'image', attrs: { src: 'x' } }] },
      {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'x',
                marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
              },
            ],
          },
        ],
      },
      { type: 'doc', content: [{ type: 'html', content: '<script>' }] },
    ];
    for (const d of bad) {
      const r = await call(w, 'saveContent', 'alice', { doc: d, baseVersion: 2 });
      expect(r).toMatchObject({ ok: false });
    }
    const view = (await call(w, 'getSection', 'alice')) as { state: string };
    expect(view.state).toBe('READY');
    expect(JSON.stringify(view)).toContain(SECRET);
  });

  it('non-integer, negative and NaN-like versions are rejected rather than coerced', async () => {
    const w = await world();
    for (const baseVersion of [-1, 1.5, '2', null, Number.NaN, Infinity, {}, []]) {
      const r = await call(w, 'saveContent', 'alice', { doc: doc('y'), baseVersion });
      expect(r).toMatchObject({ ok: false });
    }
  });
});

describe('no plaintext leakage into logs or storage metadata', () => {
  it('the secret never appears in logs, audit, revision metadata or index keys', async () => {
    const w = await world();
    await call(w, 'getSection', 'mallory');
    await call(w, 'saveContent', 'mallory', { doc: doc(SECRET), baseVersion: 2 });
    expect(w.logger.lines.join('\n')).not.toContain(SECRET);
    const audit = await call(w, 'listAudit', 'alice', {});
    expect(JSON.stringify(audit)).not.toContain(SECRET);
    const revs = await call(w, 'listRevisions', 'alice', {});
    expect(JSON.stringify(revs)).not.toContain(SECRET);
    for (const rec of w.store.dump()) {
      const keyAndPartition = `${rec.partition}|${rec.key}`;
      expect(keyAndPartition).not.toContain(SECRET);
    }
  });
});

describe('availability failures fail closed', () => {
  it('storage and confluence outages never reveal content', async () => {
    const w = await world();
    w.gateway.failing.add('pagePermissions');
    expect(JSON.stringify(await call(w, 'getSection', 'alice'))).not.toContain(SECRET);
    w.gateway.failing.clear();
    w.store.failReads = true;
    const res = await call(w, 'getSection', 'alice');
    expect(JSON.stringify(res)).not.toContain(SECRET);
  });
});
