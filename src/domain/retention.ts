import type { RetentionConfig } from '@secure-sections/shared';
import type { Clock, Logger } from '../ports/runtime';
import { MAX_TX_OPS, type Doc, type Store, type TxOp } from '../ports/store';
import {
  Idx,
  Keys,
  SCHEMA_VERSION,
  type AuditDoc,
  type BindingDoc,
  type MetaDoc,
  type RevisionDoc,
  type SectionDoc,
} from './model';

export interface SweepResult {
  sectionsScanned: number;
  sectionsPurged: number;
  revisionsDeleted: number;
  auditDeleted: number;
  done: boolean;
}

const DAY = 86_400_000;
const BATCH = MAX_TX_OPS - 1;

/**
 * Bounded, resumable retention sweep (scheduled trigger). Never deletes a section's head revision
 * and only purges soft-deleted sections after the configured grace period.
 */
export class RetentionService {
  constructor(
    private readonly store: Store,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  async sweep(cfg: RetentionConfig, maxSections = 25): Promise<SweepResult> {
    const cursorDoc = await this.store.get<MetaDoc<string | null>>(
      'meta',
      Keys.meta('retention-cursor'),
    );
    const res = await this.store.list<SectionDoc>({
      entity: 'section',
      partition: 'all',
      order: 'ASC',
      limit: maxSections,
      cursor: cursorDoc?.value.value ?? null,
    });
    const out: SweepResult = {
      sectionsScanned: 0,
      sectionsPurged: 0,
      revisionsDeleted: 0,
      auditDeleted: 0,
      done: res.nextCursor === null,
    };
    const now = this.clock.now().getTime();
    for (const item of res.items) {
      out.sectionsScanned += 1;
      const s = item.value;
      if (s.status === 'DELETED' && s.deletedAt) {
        if (now - Date.parse(s.deletedAt) > cfg.deletedSectionGraceDays * DAY) {
          await this.purgeSection(item);
          out.sectionsPurged += 1;
          continue;
        }
      }
      if (s.status === 'ACTIVE') {
        out.revisionsDeleted += await this.pruneRevisions(s, cfg, now);
      }
      out.auditDeleted += await this.pruneAudit(s, cfg, now);
    }
    await this.saveMeta('retention-cursor', res.nextCursor);
    if (out.done) await this.saveMeta('retention-swept', this.clock.now().toISOString());
    this.logger.info('retention.sweep', {
      scanned: out.sectionsScanned,
      purged: out.sectionsPurged,
      revisions: out.revisionsDeleted,
      audit: out.auditDeleted,
    });
    return out;
  }

  private async saveMeta(name: string, value: unknown): Promise<void> {
    const cur = await this.store.get<MetaDoc>('meta', Keys.meta(name));
    const doc: MetaDoc = {
      schema: SCHEMA_VERSION,
      value,
      updatedAt: this.clock.now().toISOString(),
    };
    await this.store.transact([
      cur
        ? {
            kind: 'put',
            entity: 'meta',
            key: Keys.meta(name),
            value: doc,
            index: Idx.meta(name),
            expectRev: cur.rev,
          }
        : {
            kind: 'create',
            entity: 'meta',
            key: Keys.meta(name),
            value: doc,
            index: Idx.meta(name),
          },
    ]);
  }

  private async deleteDocs(ops: TxOp[]): Promise<void> {
    for (let i = 0; i < ops.length; i += BATCH) {
      await this.store.transact(ops.slice(i, i + BATCH));
    }
  }

  private async pruneRevisions(s: SectionDoc, cfg: RetentionConfig, now: number): Promise<number> {
    const res = await this.store.list<RevisionDoc>({
      entity: 'revision',
      partition: s.sectionId,
      order: 'ASC',
      limit: 100,
    });
    const keepFrom = s.headVersion - cfg.revisionsKeep + 1;
    const ops: TxOp[] = res.items
      .filter(
        (r) =>
          r.value.version < keepFrom &&
          r.value.version !== s.headVersion &&
          now - Date.parse(r.value.createdAt) > cfg.revisionsMaxAgeDays * DAY,
      )
      .map((r) => ({ kind: 'delete', entity: 'revision', key: r.key, expectRev: r.rev }));
    await this.deleteDocs(ops);
    return ops.length;
  }

  private async pruneAudit(s: SectionDoc, cfg: RetentionConfig, now: number): Promise<number> {
    const res = await this.store.list<AuditDoc>({
      entity: 'audit',
      partition: s.sectionId,
      order: 'ASC',
      limit: 100,
    });
    const ops: TxOp[] = res.items
      .filter((a) => now - Date.parse(a.value.at) > cfg.auditMaxAgeDays * DAY)
      .map((a) => ({ kind: 'delete', entity: 'audit', key: a.key, expectRev: a.rev }));
    await this.deleteDocs(ops);
    return ops.length;
  }

  private async purgeSection(section: Doc<SectionDoc>): Promise<void> {
    const sid = section.value.sectionId;
    for (const entity of ['revision', 'audit'] as const) {
      for (;;) {
        const page = await this.store.list<unknown>({
          entity,
          partition: sid,
          order: 'ASC',
          limit: BATCH,
        });
        if (page.items.length === 0) break;
        await this.store.transact(
          page.items.map((i) => ({ kind: 'delete', entity, key: i.key }) as TxOp),
        );
      }
    }
    for (const b of section.value.bindings) {
      const doc = await this.store.get<BindingDoc>('binding', Keys.binding(b.pageId, b.localId));
      if (doc && doc.value.sectionId === sid) {
        await this.store.transact([
          { kind: 'delete', entity: 'binding', key: doc.key, expectRev: doc.rev },
        ]);
      }
    }
    await this.store.transact([
      { kind: 'delete', entity: 'section', key: Keys.section(sid), expectRev: section.rev },
    ]);
  }
}
