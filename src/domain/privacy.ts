import type { Clock, Logger } from '../ports/runtime';
import type { PrivacyGateway } from '../ports/confluence';
import { StoreConflictError, type Store, type TxOp } from '../ports/store';
import { sha256 } from './audit';
import {
  Idx,
  Keys,
  SCHEMA_VERSION,
  type AuditDoc,
  type MetaDoc,
  type RevisionDoc,
  type SectionDoc,
} from './model';

const ERASED = 'erased';

/**
 * Atlassian's default personal-data reporting cycle is 7 days and apps must not report an
 * accountId more often (https://developer.atlassian.com/platform/forge/user-privacy-guidelines/).
 * The helper API does not expose the Cycle-Period header, so the default is used as a floor.
 */
export const REPORT_CYCLE_MS = 7 * 86_400_000;

interface PrivacyCursor {
  cursor: string | null;
  nextAllowedAt?: string;
}

export interface PrivacyResult {
  accountsReported: number;
  accountsErased: number;
  done: boolean;
  skipped?: boolean;
}

/**
 * Personal-data lifecycle. The only personal identifier stored is the Atlassian accountId
 * (no names or emails). Closed accounts reported by the Forge Privacy API are anonymised.
 */
export class PrivacyService {
  constructor(
    private readonly store: Store,
    private readonly gateway: PrivacyGateway,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  async collectAccountIds(s: SectionDoc): Promise<Set<string>> {
    const ids = new Set<string>([s.ownerAccountId, s.createdBy]);
    for (const g of s.grants) {
      if (g.principalType === 'USER') ids.add(g.principalId);
      ids.add(g.addedBy);
    }
    const audits = await this.store.list<AuditDoc>({
      entity: 'audit',
      partition: s.sectionId,
      order: 'DESC',
      limit: 100,
    });
    for (const a of audits.items) ids.add(a.value.actor);
    const revs = await this.store.list<RevisionDoc>({
      entity: 'revision',
      partition: s.sectionId,
      order: 'DESC',
      limit: 100,
    });
    for (const r of revs.items) ids.add(r.value.authorAccountId);
    ids.delete(ERASED);
    return ids;
  }

  async sweep(maxSections = 20): Promise<PrivacyResult> {
    const cursorDoc = await this.store.get<MetaDoc<PrivacyCursor>>(
      'meta',
      Keys.meta('privacy-cursor'),
    );
    const nextAllowedAt = cursorDoc?.value.value.nextAllowedAt;
    if (nextAllowedAt && Date.parse(nextAllowedAt) > this.clock.now().getTime()) {
      return { accountsReported: 0, accountsErased: 0, done: true, skipped: true };
    }
    const page = await this.store.list<SectionDoc>({
      entity: 'section',
      partition: 'all',
      order: 'ASC',
      limit: maxSections,
      cursor: cursorDoc?.value.value.cursor ?? null,
    });
    const all = new Set<string>();
    for (const s of page.items) for (const id of await this.collectAccountIds(s.value)) all.add(id);
    const updatedAt = new Date(0).toISOString();
    const ids = [...all];
    const closed: string[] = [];
    for (let i = 0; i < ids.length; i += 90) {
      const res = await this.gateway.report(
        ids.slice(i, i + 90).map((accountId) => ({ accountId, updatedAt })),
      );
      for (const r of res) if (r.status === 'closed') closed.push(r.accountId);
    }
    for (const id of closed)
      await this.eraseAccount(
        id,
        page.items.map((i) => i.value.sectionId),
      );
    const passComplete = page.nextCursor === null;
    const next: MetaDoc<PrivacyCursor> = {
      schema: SCHEMA_VERSION,
      value: {
        cursor: page.nextCursor,
        ...(passComplete
          ? { nextAllowedAt: new Date(this.clock.now().getTime() + REPORT_CYCLE_MS).toISOString() }
          : {}),
      },
      updatedAt: this.clock.now().toISOString(),
    };
    await this.store.transact([
      cursorDoc
        ? {
            kind: 'put',
            entity: 'meta',
            key: Keys.meta('privacy-cursor'),
            value: next,
            index: Idx.meta('privacy-cursor'),
            expectRev: cursorDoc.rev,
          }
        : {
            kind: 'create',
            entity: 'meta',
            key: Keys.meta('privacy-cursor'),
            value: next,
            index: Idx.meta('privacy-cursor'),
          },
    ]);
    this.logger.info('privacy.sweep', { reported: ids.length, erased: closed.length });
    return {
      accountsReported: ids.length,
      accountsErased: closed.length,
      done: page.nextCursor === null,
    };
  }

  /** Anonymise one account across the given sections. Idempotent. */
  async eraseAccount(accountId: string, sectionIds: string[]): Promise<void> {
    const pseudonym = `${ERASED}:${sha256(accountId).slice(0, 12)}`;
    for (const sid of sectionIds) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          await this.eraseInSection(accountId, sid, pseudonym);
          break;
        } catch (e) {
          if (!(e instanceof StoreConflictError) || attempt === 2) throw e;
        }
      }
    }
  }

  private async eraseInSection(accountId: string, sid: string, pseudonym: string): Promise<void> {
    const sec = await this.store.get<SectionDoc>('section', Keys.section(sid));
    if (!sec) return;
    const s = sec.value;
    const ops: TxOp[] = [];
    const remaining = s.grants.filter(
      (g) => !(g.principalType === 'USER' && g.principalId === accountId),
    );
    const lastAdmin = !remaining.some((g) => g.principalType === 'USER' && g.role === 'ADMINISTER');
    const grants = (lastAdmin ? s.grants : remaining).map((g) => ({
      ...g,
      principalId:
        lastAdmin && g.principalType === 'USER' && g.principalId === accountId
          ? pseudonym
          : g.principalId,
      addedBy: g.addedBy === accountId ? pseudonym : g.addedBy,
    }));
    const touched =
      s.ownerAccountId === accountId ||
      s.createdBy === accountId ||
      grants.length !== s.grants.length ||
      s.grants.some((g, i) => g.principalId !== grants[i]?.principalId || g.addedBy === accountId);
    if (touched) {
      const owner =
        grants.find(
          (g) =>
            g.principalType === 'USER' &&
            g.role === 'ADMINISTER' &&
            !g.principalId.startsWith(ERASED),
        )?.principalId ?? pseudonym;
      const next: SectionDoc = {
        ...s,
        grants,
        ownerAccountId: s.ownerAccountId === accountId ? owner : s.ownerAccountId,
        createdBy: s.createdBy === accountId ? pseudonym : s.createdBy,
        aclVersion: s.aclVersion + 1,
        updatedAt: this.clock.now().toISOString(),
      };
      ops.push({
        kind: 'put',
        entity: 'section',
        key: Keys.section(sid),
        value: next,
        index: Idx.section(sid),
        expectRev: sec.rev,
      });
    }
    if (ops.length) await this.store.transact(ops);

    const audits = await this.store.list<AuditDoc>({
      entity: 'audit',
      partition: sid,
      order: 'ASC',
      limit: 24,
    });
    let page = audits;
    for (;;) {
      const updates: TxOp[] = [];
      for (const a of page.items) {
        const metaHit = Object.values(a.value.meta).includes(accountId);
        if (a.value.actor === accountId || metaHit) {
          const meta = Object.fromEntries(
            Object.entries(a.value.meta).map(([k, v]) => [k, v === accountId ? pseudonym : v]),
          );
          updates.push({
            kind: 'put',
            entity: 'audit',
            key: a.key,
            value: {
              ...a.value,
              actor: a.value.actor === accountId ? pseudonym : a.value.actor,
              meta,
              erased: true,
            },
            index: Idx.audit(sid, a.value.id),
            expectRev: a.rev,
          });
        }
      }
      if (updates.length) await this.store.transact(updates);
      if (!page.nextCursor) break;
      page = await this.store.list<AuditDoc>({
        entity: 'audit',
        partition: sid,
        order: 'ASC',
        limit: 24,
        cursor: page.nextCursor,
      });
    }

    let rpage = await this.store.list<RevisionDoc>({
      entity: 'revision',
      partition: sid,
      order: 'ASC',
      limit: 24,
    });
    for (;;) {
      const updates: TxOp[] = rpage.items
        .filter((r) => r.value.authorAccountId === accountId)
        .map((r) => ({
          kind: 'put',
          entity: 'revision',
          key: r.key,
          value: { ...r.value, authorAccountId: pseudonym },
          index: Idx.revision(sid, r.value.version),
          expectRev: r.rev,
        }));
      if (updates.length) await this.store.transact(updates);
      if (!rpage.nextCursor) break;
      rpage = await this.store.list<RevisionDoc>({
        entity: 'revision',
        partition: sid,
        order: 'ASC',
        limit: 24,
        cursor: rpage.nextCursor,
      });
    }
  }
}
