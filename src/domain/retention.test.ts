import { describe, expect, it } from 'vitest';
import { DEFAULT_RETENTION } from './model';
import { ctxFor, makeWorld } from '../testing/world';

const doc = (t: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }],
});
const alice = ctxFor('alice');

async function world() {
  const w = makeWorld();
  w.gateway.addUser('alice').setPage('1001', 'alice', { canView: true, canEdit: true });
  await w.service.createSection(alice);
  return w;
}

describe('retention', () => {
  it('prunes old revisions beyond keep+age but never the head', async () => {
    const w = await world();
    const cfg = { ...DEFAULT_RETENTION, revisionsKeep: 3, revisionsMaxAgeDays: 10 };
    for (let i = 1; i <= 8; i += 1) await w.service.saveContent(alice, doc(`v${i}`), i);
    w.clock.advanceDays(30);
    const res = await w.retention.sweep(cfg);
    expect(res.revisionsDeleted).toBe(6); // versions 1..6 of 9 total; keep 7,8,9
    const hist = await w.service.listRevisions(alice, null);
    expect(hist.revisions.map((r) => r.version)).toEqual([9, 8, 7]);
    const view = await w.service.getSection(alice);
    expect(view.state).toBe('READY');
  });

  it('keeps recent revisions even beyond the count limit until they age out', async () => {
    const w = await world();
    const cfg = { ...DEFAULT_RETENTION, revisionsKeep: 2, revisionsMaxAgeDays: 10 };
    for (let i = 1; i <= 5; i += 1) await w.service.saveContent(alice, doc(`v${i}`), i);
    const res = await w.retention.sweep(cfg);
    expect(res.revisionsDeleted).toBe(0);
  });

  it('purges soft-deleted sections only after the grace period, including bindings, revisions and audit', async () => {
    const w = await world();
    await w.service.deleteSection(alice, 'DELETE');
    w.clock.advanceDays(10);
    let res = await w.retention.sweep(DEFAULT_RETENTION);
    expect(res.sectionsPurged).toBe(0);
    w.clock.advanceDays(25);
    res = await w.retention.sweep(DEFAULT_RETENTION);
    expect(res.sectionsPurged).toBe(1);
    expect(w.store.dump('section')).toHaveLength(0);
    expect(w.store.dump('binding')).toHaveLength(0);
    expect(w.store.dump('revision')).toHaveLength(0);
    expect(w.store.dump('audit')).toHaveLength(0);
  });

  it('does not purge active sections or touch other sections', async () => {
    const w = await world();
    w.clock.advanceDays(1000);
    const res = await w.retention.sweep(DEFAULT_RETENTION);
    expect(res.sectionsPurged).toBe(0);
    expect(w.store.dump('section')).toHaveLength(1);
  });

  it('prunes aged audit entries; verification then reports PARTIAL (not BROKEN)', async () => {
    const w = await world();
    await w.service.saveContent(alice, doc('a'), 1);
    w.clock.advanceDays(800);
    await w.service.saveContent(alice, doc('b'), 2);
    const res = await w.retention.sweep(DEFAULT_RETENTION);
    expect(res.auditDeleted).toBe(2);
    expect((await w.service.listAudit(alice, null)).chain).toBe('PARTIAL');
  });

  it('is resumable: scans in bounded pages with a stored cursor', async () => {
    const w = makeWorld();
    w.gateway.addUser('alice').setPage('1001', 'alice', { canView: true, canEdit: true });
    for (let i = 0; i < 5; i += 1) {
      await w.service.createSection(
        ctxFor('alice', { localId: `aaaaaaaa-000${i}-4000-8000-000000000001` }),
      );
    }
    const r1 = await w.retention.sweep(DEFAULT_RETENTION, 2);
    expect(r1).toMatchObject({ sectionsScanned: 2, done: false });
    const r2 = await w.retention.sweep(DEFAULT_RETENTION, 2);
    const r3 = await w.retention.sweep(DEFAULT_RETENTION, 2);
    expect(r2.sectionsScanned + r3.sectionsScanned).toBe(3);
    expect(r3.done).toBe(true);
  });

  it('administrator recovery can restore a soft-deleted section within the grace period', async () => {
    const w = await world();
    w.gateway.addUser('siteadmin').setPage('1001', 'siteadmin', { canView: true, canEdit: false });
    w.gateway.siteAdmins.add('siteadmin');
    await w.service.saveContent(alice, doc('keep me'), 1);
    await w.service.deleteSection(alice, 'DELETE');
    w.gateway.deactivate('alice');
    w.gateway.addUser('newadmin').setPage('1001', 'newadmin', { canView: true, canEdit: true });
    await w.service.recoverSection(ctxFor('siteadmin'), {
      newAdministratorAccountId: 'newadmin',
      confirm: 'RECOVER',
    });
    const view = await w.service.getSection(ctxFor('newadmin'));
    expect(view.state === 'READY' && JSON.stringify(view.content.doc)).toContain('keep me');
  });
});
