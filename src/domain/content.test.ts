import { describe, expect, it } from 'vitest';
import { ctxFor, makeWorld, rawContext, type World } from '../testing/world';

const doc = (t: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }],
});
const alice = ctxFor('alice');

async function world(): Promise<World> {
  const w = makeWorld();
  for (const u of ['alice', 'bob', 'carol']) {
    w.gateway.addUser(u);
    w.gateway.setPage('1001', u, { canView: true, canEdit: true });
  }
  await w.service.createSection(alice);
  await w.service.upsertGrant(alice, {
    principalType: 'USER',
    principalId: 'bob',
    role: 'MODIFY',
    expectedAclVersion: 1,
  });
  return w;
}

describe('content versions', () => {
  it('increments versions, records the author and keeps history', async () => {
    const w = await world();
    const r1 = await w.service.saveContent(alice, doc('one'), 1);
    expect(r1.content.version).toBe(2);
    const r2 = await w.service.saveContent(ctxFor('bob'), doc('two'), 2);
    expect(r2.content.version).toBe(3);
    const hist = await w.service.listRevisions(alice, null);
    expect(hist.revisions.map((r) => [r.version, r.author?.accountId])).toEqual([
      [3, 'bob'],
      [2, 'alice'],
      [1, 'alice'],
    ]);
  });

  it('stores an optional change note on the revision and never puts it in the audit payload', async () => {
    const w = await world();
    await w.service.saveContent(alice, doc('one'), 1, 'raise Technology');
    const hist = await w.service.listRevisions(alice, null);
    expect(hist.revisions.find((r) => r.version === 2)?.changeNote).toBe('raise Technology');
    const audit = await w.service.listAudit(alice, null);
    expect(JSON.stringify(audit)).not.toContain('raise Technology');
    await expect(
      w.service.saveContent(alice, doc('two'), 2, 'x'.repeat(141)),
    ).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
  });

  it('labels a revision without copying the label into the audit entry', async () => {
    const w = await world();
    await w.service.saveContent(alice, doc('one'), 1);
    const tagged = await w.service.setRevisionTag(alice, 2, ' approved ');
    expect(tagged.tag).toBe('approved');
    const hist = await w.service.listRevisions(alice, null);
    expect(hist.revisions.find((r) => r.version === 2)?.tag).toBe('approved');
    const audit = await w.service.listAudit(alice, null);
    expect(audit.entries.some((e) => e.action === 'REVISION_TAG')).toBe(true);
    expect(JSON.stringify(audit)).not.toContain('approved');
    const cleared = await w.service.setRevisionTag(alice, 2, '');
    expect(cleared.tag).toBeNull();
  });

  it('detects concurrent edits (optimistic concurrency) and never silently overwrites', async () => {
    const w = await world();
    const [a, b] = await Promise.allSettled([
      w.service.saveContent(alice, doc('from alice'), 1),
      w.service.saveContent(ctxFor('bob'), doc('from bob'), 1),
    ]);
    const fulfilled = [a, b].filter((x) => x.status === 'fulfilled');
    const rejected = [a, b].filter((x) => x.status === 'rejected') as PromiseRejectedResult[];
    expect(fulfilled).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({ code: 'CONFLICT', detail: { currentVersion: 2 } });
  });

  it('restore creates a NEW version and preserves the old one', async () => {
    const w = await world();
    await w.service.saveContent(alice, doc('v2'), 1);
    await w.service.saveContent(alice, doc('v3'), 2);
    const restored = await w.service.restoreRevision(alice, 2, 3);
    expect(restored.content.version).toBe(4);
    expect(JSON.stringify(restored.content.doc)).toContain('v2');
    const hist = await w.service.listRevisions(alice, null);
    expect(hist.revisions).toHaveLength(4);
    expect(hist.revisions[0]?.restoredFrom).toBe(2);
    const audit = await w.service.listAudit(alice, null);
    expect(audit.entries[0]).toMatchObject({
      action: 'CONTENT_RESTORE',
      meta: { version: 4, restoredFrom: 2 },
    });
  });

  it('restore with a stale base version conflicts', async () => {
    const w = await world();
    await w.service.saveContent(alice, doc('v2'), 1);
    await expect(w.service.restoreRevision(alice, 1, 1)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('VIEW users cannot read revisions', async () => {
    const w = await world();
    await w.service.upsertGrant(alice, {
      principalType: 'USER',
      principalId: 'carol',
      role: 'VIEW',
      expectedAclVersion: 2,
    });
    await expect(w.service.listRevisions(ctxFor('carol'), null)).rejects.toMatchObject({
      code: 'DENIED',
    });
    await expect(w.service.getRevision(ctxFor('carol'), 1)).rejects.toMatchObject({
      code: 'DENIED',
    });
  });

  it('getRevision for a non-existent version is NOT_FOUND', async () => {
    const w = await world();
    await expect(w.service.getRevision(alice, 99)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('never writes content into audit, logs or errors', async () => {
    const w = await world();
    await w.service.saveContent(alice, doc('CANARY-9f3a'), 1);
    await expect(
      w.service.saveContent(ctxFor('carol'), doc('CANARY-9f3a'), 2),
    ).rejects.toBeTruthy();
    const dump = JSON.stringify(w.store.dump().filter((r) => r.entity !== 'revision'));
    expect(dump).not.toContain('CANARY-9f3a');
    expect(w.logger.lines.join('\n')).not.toContain('CANARY-9f3a');
  });

  it('rejects hostile content: scripts, javascript: links, unknown nodes, oversize', async () => {
    const w = await world();
    const bad: unknown[] = [
      { type: 'doc', content: [{ type: 'html', html: '<script>alert(1)</script>' }] },
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
      {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'x',
                marks: [{ type: 'link', attrs: { href: 'data:text/html;base64,AAAA' } }],
              },
            ],
          },
        ],
      },
      { type: 'doc', content: [{ type: 'paragraph', attrs: { onclick: 'x' } }] },
      {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a'.repeat(200_000) }] }],
      },
      'not-an-object',
      null,
      { type: 'doc', content: [] },
    ];
    for (const b of bad) {
      await expect(w.service.saveContent(alice, b, 1)).rejects.toMatchObject({
        code: 'INVALID_CONTENT',
      });
    }
    const v = await w.service.getSection(alice);
    expect(v.state === 'READY' && v.content.version).toBe(1);
  });

  it('rejects invalid base versions', async () => {
    const w = await world();
    for (const bv of [0, -1, 1.5, '1', null, undefined, NaN]) {
      await expect(w.service.saveContent(alice, doc('x'), bv)).rejects.toMatchObject({
        code: 'INVALID_REQUEST',
      });
    }
  });

  it('detects tampered or corrupted stored content and shows CORRUPTED instead of rendering it', async () => {
    const w = await world();
    await w.service.saveContent(alice, doc('legit'), 1);
    const rev = w.store
      .dump('revision')
      .find((r) => (r.value as { version: number }).version === 2)!;
    w.store.tamper('revision', rev.key, (v) => ({
      ...(v as object),
      bodyJson: JSON.stringify({
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: '<img src=x onerror=alert(1)>' }] },
        ],
      }),
    }));
    const res = await w.handlers.getSection({ context: rawContext(alice) });
    expect(res).toEqual({ state: 'CORRUPTED' });
  });

  it('stored content that fails schema validation (even with a valid hash) is never rendered', async () => {
    const w = await world();
    await w.service.saveContent(alice, doc('legit'), 1);
    const rev = w.store
      .dump('revision')
      .find((r) => (r.value as { version: number }).version === 2)!;
    const evil = JSON.stringify({ type: 'doc', content: [{ type: 'script' }] });
    const { sha256 } = await import('./audit');
    w.store.tamper('revision', rev.key, (v) => ({
      ...(v as object),
      bodyJson: evil,
      sha256: sha256(evil),
    }));
    expect(await w.handlers.getSection({ context: rawContext(alice) })).toEqual({
      state: 'CORRUPTED',
    });
  });

  it('a revision from another section can never be served', async () => {
    const w = await world();
    const rev = w.store.dump('revision')[0]!;
    w.store.tamper('revision', rev.key, (v) => ({ ...(v as object), sectionId: 'other' }));
    expect(await w.handlers.getSection({ context: rawContext(alice) })).toEqual({
      state: 'CORRUPTED',
    });
  });

  it('transactional write: a failed storage transaction leaves version, revision and audit unchanged', async () => {
    const w = await world();
    const before = JSON.stringify(w.store.dump().map((r) => [r.key, r.rev]));
    w.store.failNextTransact = new Error('boom');
    await expect(w.service.saveContent(alice, doc('x'), 1)).rejects.toThrow('boom');
    expect(JSON.stringify(w.store.dump().map((r) => [r.key, r.rev]))).toBe(before);
  });
});

describe('audit integrity', () => {
  it('chains entries and detects tampering', async () => {
    const w = await world();
    await w.service.saveContent(alice, doc('a'), 1);
    await w.service.saveContent(alice, doc('b'), 2);
    expect((await w.service.listAudit(alice, null)).chain).toBe('OK');
    const target = w.store
      .dump('audit')
      .find((r) => (r.value as { action: string }).action === 'CONTENT_EDIT')!;
    w.store.tamper('audit', target.key, (v) => ({ ...(v as object), actor: 'someone-else' }));
    expect((await w.service.listAudit(alice, null)).chain).toBe('BROKEN');
  });

  it('detects deletion of the newest audit entry via the section head hash', async () => {
    const w = await world();
    await w.service.saveContent(alice, doc('a'), 1);
    const newest = w.store.dump('audit').sort((a, b) => (a.range < b.range ? 1 : -1))[0]!;
    await w.store.transact([{ kind: 'delete', entity: 'audit', key: newest.key }]);
    expect((await w.service.listAudit(alice, null)).chain).toBe('BROKEN');
  });

  it('records no content, only metadata', async () => {
    const w = await world();
    await w.service.saveContent(alice, doc('SUPERSECRET-BODY'), 1);
    const audit = await w.service.listAudit(alice, null);
    expect(JSON.stringify(audit)).not.toContain('SUPERSECRET');
    expect(audit.entries[0]?.meta).toEqual({ version: 2 });
  });

  it('paginates', async () => {
    const w = await world();
    for (let i = 0; i < 60; i += 1) {
      await w.service.saveContent(alice, doc(`v${i}`), i + 1);
    }
    const p1 = await w.service.listAudit(alice, null);
    expect(p1.entries).toHaveLength(50);
    expect(p1.nextCursor).toBeTruthy();
    const p2 = await w.service.listAudit(alice, p1.nextCursor);
    expect(p2.entries.length).toBeGreaterThan(0);
    expect(p2.chain).toBe('OK');
    await expect(w.service.listAudit(alice, "'; drop")).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
  });
});
