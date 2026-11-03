import { describe, expect, it } from 'vitest';
import { ctxFor, makeWorld, type World } from '../testing/world';

const secretDoc = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [{ type: 'secret', attrs: { label: 'Password', value: 'super-secret-value' } }],
    },
  ],
};

async function world(): Promise<World> {
  const w = makeWorld();
  w.gateway.addUser('alice', 'Alice');
  w.gateway.addUser('bob', 'Bob');
  for (const u of ['alice', 'bob']) w.gateway.setPage('1001', u, { canView: true, canEdit: true });
  return w;
}

describe('reader protection flags', () => {
  it('turns watermark, auto-lock and copy protection on for RESTRICTED only', async () => {
    const w = await world();
    const alice = ctxFor('alice');
    await w.service.createSection(alice, 'Plan', 'RESTRICTED');
    const restricted = await w.service.getSection(alice);
    expect(restricted).toMatchObject({
      state: 'READY',
      protection: {
        watermark: true,
        autoLockMinutes: 5,
        protectCopy: true,
        viewerName: 'Alice',
      },
    });
    await w.service.updateMetadata(alice, { title: 'Plan', classification: 'INTERNAL' });
    const internal = await w.service.getSection(alice);
    expect(internal).toMatchObject({
      protection: { watermark: false, autoLockMinutes: null, protectCopy: false },
    });
  });

  it('audits a secret reveal without storing the secret', async () => {
    const w = await world();
    const alice = ctxFor('alice');
    await w.service.createSection(alice, 'Vault', 'RESTRICTED');
    await w.service.saveContent(alice, secretDoc, 1, 'add password');
    await w.service.revealSecret(alice, 'Password');
    const audit = await w.service.listAudit(alice, null);
    const reveal = audit.entries.find((e) => e.action === 'SECRET_REVEAL');
    expect(reveal?.meta).toEqual({ label: 'Password' });
    expect(JSON.stringify(audit)).not.toContain('super-secret-value');
    expect(w.logger.lines.join('\n')).not.toContain('super-secret-value');
  });
});
