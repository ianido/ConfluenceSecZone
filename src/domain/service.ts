import {
  CHANGE_NOTE_MAX_LENGTH,
  REVISION_TAG_MAX_LENGTH,
  REQUEST_REASON_MAX_LENGTH,
  maxRole,
  roleAtLeast,
  safeValidateDoc,
  validateDoc,
  type AccessInfo,
  type AccessRequestItem,
  type AccessRequestList,
  type AuditEntry,
  type AuditList,
  type ContentPayload,
  type Diagnostics,
  type EffectiveAccess,
  type Grant,
  type GrantList,
  type PrincipalHit,
  type PrincipalType,
  type Classification,
  type RetentionConfig,
  type RevisionList,
  type RevisionSummary,
  type RequestableRole,
  type Role,
  type RichDoc,
  type SectionMeta,
  type SectionView,
  type GrantNotice,
  type ProtectionFlags,
  type AdminOverview,
  type AuditExport,
  type MySections,
  type PageSectionRow,
  type SitePolicy,
  type UserSummary,
  type AuditAction,
  MAX_GRANT_TTL_DAYS,
  TITLE_MAX_LENGTH,
  isSectionTemplate,
  templateDoc,
  type SectionTemplate,
  isClassification,
  isPrincipalType,
  isRequestableRole,
  isRole,
} from '@secure-sections/shared';
import { GatewayError, type ConfluenceGateway } from '../ports/confluence';
import type { Clock, IdGenerator, Logger } from '../ports/runtime';
import {
  StoreConflictError,
  StoreUnavailableError,
  type Doc,
  type Store,
  type TxOp,
} from '../ports/store';
import { buildChainedAudit, buildUnchainedAudit, sha256, verifyChain } from './audit';
import { AuthorizationService, type BoundResolved, type Resolved } from './authz';
import type { SiteContext, TrustedContext } from './context';
import { DomainError } from './errors';
import {
  ACCOUNT_ID_RE,
  DEFAULT_RETENTION,
  DEFAULT_SITE_POLICY,
  GROUP_ID_RE,
  GENESIS_HASH,
  Idx,
  Keys,
  LIMITS,
  REQUEST_TTL_DAYS,
  SCHEMA_VERSION,
  UUID_RE,
  type AccessRequestRec,
  type AuditDoc,
  type AuditMeta,
  type BindingDoc,
  type MetaDoc,
  type RevisionDoc,
  type SectionDoc,
} from './model';

export class CorruptedContentError extends Error {
  constructor() {
    super('CORRUPTED');
    this.name = 'CorruptedContentError';
  }
}

export interface ServiceDeps {
  store: Store;
  gateway: ConfluenceGateway;
  clock: Clock;
  ids: IdGenerator;
  logger: Logger;
}

const MAX_ATTEMPTS = 4;

export class SecureSectionService {
  readonly authz: AuthorizationService;
  private readonly store: Store;
  private readonly gateway: ConfluenceGateway;
  private readonly clock: Clock;
  private readonly ids: IdGenerator;
  private readonly logger: Logger;

  constructor(deps: ServiceDeps) {
    this.store = deps.store;
    this.gateway = deps.gateway;
    this.clock = deps.clock;
    this.ids = deps.ids;
    this.logger = deps.logger;
    this.authz = new AuthorizationService(deps.store, deps.gateway, deps.clock);
  }

  // ---------------------------------------------------------------- helpers

  private nowIso(): string {
    return this.clock.now().toISOString();
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        return await fn();
      } catch (e) {
        if (e instanceof StoreConflictError) {
          if (attempt === MAX_ATTEMPTS) throw new DomainError('CONFLICT');
          continue;
        }
        throw e;
      }
    }
    throw new DomainError('CONFLICT');
  }

  private chain(
    section: SectionDoc,
    action: AuditAction,
    actor: string,
    meta: AuditMeta = {},
  ): { audit: AuditDoc; op: TxOp } {
    const at = this.nowIso();
    const audit = buildChainedAudit(section.auditHead, {
      sectionId: section.sectionId,
      action,
      actor,
      meta,
      at,
      rand: this.ids.uuid().slice(-8),
    });
    return {
      audit,
      op: {
        kind: 'create',
        entity: 'audit',
        key: Keys.audit(section.sectionId, audit.id),
        value: audit,
        index: Idx.audit(section.sectionId, audit.id),
      },
    };
  }

  private putSection(doc: Doc<SectionDoc>, next: SectionDoc): TxOp {
    return {
      kind: 'put',
      entity: 'section',
      key: Keys.section(next.sectionId),
      value: next,
      index: Idx.section(next.sectionId),
      expectRev: doc.rev,
    };
  }

  private revisionOp(rev: RevisionDoc): TxOp {
    return {
      kind: 'create',
      entity: 'revision',
      key: Keys.revision(rev.sectionId, rev.version),
      value: rev,
      index: Idx.revision(rev.sectionId, rev.version),
    };
  }

  private buildRevision(
    sectionId: string,
    version: number,
    doc: RichDoc,
    author: string,
    restoredFrom: number | null,
    changeNote: string | null = null,
  ): RevisionDoc {
    const bodyJson = JSON.stringify(doc);
    return {
      schema: SCHEMA_VERSION,
      sectionId,
      version,
      bodyJson,
      sha256: sha256(bodyJson),
      bytes: Buffer.byteLength(bodyJson, 'utf8'),
      authorAccountId: author,
      createdAt: this.nowIso(),
      restoredFrom,
      ...(changeNote ? { changeNote } : {}),
    };
  }

  private decodeRevision(rev: RevisionDoc): RichDoc {
    if (sha256(rev.bodyJson) !== rev.sha256) throw new CorruptedContentError();
    let parsed: unknown;
    try {
      parsed = JSON.parse(rev.bodyJson);
    } catch {
      throw new CorruptedContentError();
    }
    const v = safeValidateDoc(parsed);
    if (!v.ok) throw new CorruptedContentError();
    return v.doc;
  }

  private async userSummary(accountId: string): Promise<UserSummary | null> {
    try {
      const m = await this.gateway.users([accountId]);
      const u = m.get(accountId);
      return u ? { accountId, displayName: u.displayName } : { accountId, displayName: accountId };
    } catch {
      return null;
    }
  }

  private async readHead(section: SectionDoc): Promise<ContentPayload> {
    const rev = await this.store.get<RevisionDoc>(
      'revision',
      Keys.revision(section.sectionId, section.headVersion),
    );
    if (!rev || rev.value.sectionId !== section.sectionId) throw new CorruptedContentError();
    const doc = this.decodeRevision(rev.value);
    return {
      doc,
      version: rev.value.version,
      updatedAt: rev.value.createdAt,
      updatedBy: await this.userSummary(rev.value.authorAccountId),
    };
  }

  private async recordDenied(section: SectionDoc, ctx: TrustedContext, op: string): Promise<void> {
    // Bounded: at most one entry per (section, account, day); only for mutation/admin attempts.
    const at = this.nowIso();
    const day = at.slice(0, 10);
    const key = Keys.deniedAudit(section.sectionId, ctx.accountId, day);
    const audit = buildUnchainedAudit(
      {
        sectionId: section.sectionId,
        action: 'ACCESS_DENIED',
        actor: ctx.accountId,
        meta: { op },
        at,
        rand: '',
      },
      `${day}#denied-${ctx.accountId}`,
    );
    try {
      await this.store.transact([
        {
          kind: 'create',
          entity: 'audit',
          key,
          value: audit,
          index: Idx.audit(section.sectionId, `${day}#denied-${ctx.accountId}`),
        },
      ]);
    } catch (e) {
      if (!(e instanceof StoreConflictError) && !(e instanceof StoreUnavailableError)) throw e;
    }
  }

  /**
   * Common gate for operations on the section bound to the invoking macro.
   * Returns BoundResolved or throws DomainError. Denials are generic.
   */
  private async requireBound(
    ctx: TrustedContext,
    needed: Role,
    opts: { pageEdit?: boolean; op: string; auditDenied?: boolean },
  ): Promise<BoundResolved> {
    const r = await this.authz.resolve(ctx);
    if (r.kind !== 'BOUND') throw new DomainError(r.kind === 'UNBOUND' ? 'NOT_FOUND' : 'DENIED');
    if (!roleAtLeast(r.role.role, needed)) {
      if (r.role.role === null && !r.role.groupsComplete) throw new DomainError('UNAVAILABLE');
      if (opts.auditDenied) await this.recordDenied(r.section.value, ctx, opts.op);
      throw new DomainError('DENIED');
    }
    if (opts.pageEdit && !r.page.canEdit) throw new DomainError('PAGE_EDIT_REQUIRED');
    void this.touchLastAccess(r, ctx.accountId);
    return r;
  }

  /** Best-effort last-seen stamp on the caller's USER grant. Failures never affect the caller. */
  private async touchLastAccess(r: BoundResolved, accountId: string): Promise<void> {
    const s = r.section.value;
    const now = this.nowIso();
    const day = now.slice(0, 10);
    const mine = s.grants.find((g) => g.principalType === 'USER' && g.principalId === accountId);
    if (!mine) return;
    if (mine.lastAccessAt && mine.lastAccessAt.slice(0, 10) === day) return;
    const next: SectionDoc = {
      ...s,
      grants: s.grants.map((g) => (g === mine ? { ...g, lastAccessAt: now } : g)),
    };
    try {
      await this.store.transact([this.putSection(r.section, next)]);
    } catch {
      /* last-access is observational */
    }
  }

  private viewOf(
    r: BoundResolved,
    content: ContentPayload,
    notice: GrantNotice | null,
    protection: ProtectionFlags,
  ): SectionView {
    const role = r.role.role as Role;
    return {
      state: 'READY',
      role,
      canWrite: roleAtLeast(role, 'MODIFY') && r.page.canEdit,
      canEditPage: r.page.canEdit,
      content,
      aclVersion: r.section.value.aclVersion,
      meta: this.metaOf(r.section.value),
      notice,
      protection,
    };
  }

  private async readSitePolicy(): Promise<SitePolicy> {
    const stored = await this.store.get<MetaDoc<Partial<SitePolicy>>>(
      'meta',
      Keys.meta('site-policy'),
    );
    const raw = stored?.value.value ?? {};
    const classes = DEFAULT_SITE_POLICY.classes.map((fallback) => {
      const found = Array.isArray(raw.classes)
        ? raw.classes.find((c) => c?.id === fallback.id)
        : undefined;
      if (!found) return fallback;
      const minutes = found.autoLockMinutes;
      const autoLockMinutes =
        typeof minutes === 'number' && Number.isInteger(minutes) && minutes >= 1 && minutes <= 120
          ? minutes
          : null;
      return {
        id: fallback.id,
        watermark: found.watermark === true,
        autoLockMinutes,
        protectCopy: found.protectCopy === true,
      };
    });
    const days = raw.maxGrantDays;
    return {
      allowRequests: raw.allowRequests !== false,
      maxGrantDays:
        typeof days === 'number' &&
        Number.isInteger(days) &&
        days >= 1 &&
        days <= MAX_GRANT_TTL_DAYS
          ? days
          : DEFAULT_SITE_POLICY.maxGrantDays,
      requireChangeNote: raw.requireChangeNote === true,
      lockByDefault: raw.lockByDefault !== false,
      whoMayCreate: raw.whoMayCreate === 'SITE_ADMINS' ? 'SITE_ADMINS' : 'PAGE_EDITORS',
      classes,
    };
  }

  private async protectionFor(s: SectionDoc, accountId: string): Promise<ProtectionFlags> {
    const policy = await this.readSitePolicy();
    const row = s.classification
      ? policy.classes.find((c) => c.id === s.classification)
      : undefined;
    const viewer = await this.userSummary(accountId);
    return {
      watermark: row?.watermark ?? false,
      autoLockMinutes: row?.autoLockMinutes ?? null,
      protectCopy: row?.protectCopy ?? false,
      viewerName: viewer?.displayName ?? accountId,
      lockByDefault: policy.lockByDefault,
    };
  }

  /** Records that the caller revealed a secret field. The value is never accepted or stored. */
  async revealSecret(ctx: TrustedContext, label: unknown): Promise<{ recorded: true }> {
    const safeLabel = parseRevisionTag(label);
    return this.withRetry(async () => {
      const r = await this.requireBound(ctx, 'VIEW', { op: 'reveal', auditDenied: true });
      const s = r.section.value;
      const { audit, op } = this.chain(s, 'SECRET_REVEAL', ctx.accountId, {
        ...(safeLabel ? { label: safeLabel } : {}),
      });
      const next: SectionDoc = { ...s, auditHead: audit.hash, updatedAt: this.nowIso() };
      await this.store.transact([this.putSection(r.section, next), op]);
      return { recorded: true as const };
    });
  }

  private async noticeFor(s: SectionDoc, accountId: string): Promise<GrantNotice | null> {
    const n = (s.notices ?? []).find((x) => x.accountId === accountId);
    if (!n) return null;
    let addedByName = n.addedBy;
    try {
      const u = (await this.gateway.users([n.addedBy])).get(n.addedBy);
      if (u?.displayName) addedByName = u.displayName;
    } catch {
      /* the note still shows; the name falls back to the account id */
    }
    return { role: n.role, addedByName, at: n.at };
  }

  private pushNotice(
    s: SectionDoc,
    accountId: string,
    role: Role,
    addedBy: string,
    at: string,
  ): NonNullable<SectionDoc['notices']> {
    const rest = (s.notices ?? []).filter((n) => n.accountId !== accountId);
    return [...rest, { accountId, role, addedBy, at }].slice(-LIMITS.maxNotices);
  }

  private metaOf(s: SectionDoc): SectionMeta {
    return {
      title: s.title ?? null,
      classification: s.classification ?? null,
      sharedWith: {
        users: s.grants.filter((g) => g.principalType === 'USER').length,
        groups: s.grants.filter((g) => g.principalType === 'GROUP').length,
      },
    };
  }

  private async viewFor(r: Resolved, accountId: string): Promise<SectionView> {
    if (r.kind === 'NO_ACCESS') return { state: 'DENIED' };
    if (r.kind === 'UNBOUND') return { state: 'UNCONFIGURED', canCreate: r.page.canEdit };
    if (r.role.role === null) {
      return r.role.groupsComplete ? { state: 'DENIED' } : { state: 'UNAVAILABLE' };
    }
    try {
      const content = await this.readHead(r.section.value);
      return this.viewOf(
        r,
        content,
        await this.noticeFor(r.section.value, accountId),
        await this.protectionFor(r.section.value, accountId),
      );
    } catch (e) {
      if (e instanceof CorruptedContentError) {
        this.logger.error('section.corrupted', { sectionId: r.section.value.sectionId });
        return { state: 'CORRUPTED' };
      }
      throw e;
    }
  }

  // ---------------------------------------------------------------- read / create

  async getSection(ctx: TrustedContext): Promise<SectionView> {
    return this.viewFor(await this.authz.resolve(ctx), ctx.accountId);
  }

  async createSection(
    ctx: TrustedContext,
    rawTitle?: unknown,
    rawClassification?: unknown,
    rawOptions?: unknown,
  ): Promise<SectionView> {
    const title = parseTitle(rawTitle);
    const classification = parseClassification(rawClassification);
    const options = parseCreateOptions(rawOptions);
    for (const g of options.initialGrants) {
      if (g.principalId === ctx.accountId && g.principalType === 'USER') continue;
      await this.assertPrincipalExists(g.principalType, g.principalId);
    }
    const seeded = templateDoc(options.template);
    return this.withRetry(async () => {
      const r = await this.authz.resolve(ctx);
      if (r.kind === 'NO_ACCESS') throw new DomainError('DENIED');
      if (r.kind === 'BOUND') return this.viewFor(r, ctx.accountId); // idempotent: already created
      if (!r.page.canEdit) throw new DomainError('PAGE_EDIT_REQUIRED');
      if ((await this.readSitePolicy()).whoMayCreate === 'SITE_ADMINS') {
        try {
          if (!(await this.gateway.isSiteAdmin(ctx.accountId))) throw new DomainError('DENIED');
        } catch (e) {
          if (e instanceof GatewayError) throw new DomainError('UNAVAILABLE');
          throw e;
        }
      }
      await this.assertPageBindingCap(ctx.pageId);

      const now = this.nowIso();
      const sectionId = this.ids.uuid();
      const section: SectionDoc = {
        schema: SCHEMA_VERSION,
        sectionId,
        cloudId: ctx.cloudId,
        status: 'ACTIVE',
        ownerAccountId: ctx.accountId,
        primaryPageId: ctx.pageId,
        spaceKey: ctx.spaceKey,
        createdAt: now,
        createdBy: ctx.accountId,
        updatedAt: now,
        deletedAt: null,
        headVersion: 1,
        aclVersion: 1,
        grants: [
          {
            principalType: 'USER',
            principalId: ctx.accountId,
            role: 'ADMINISTER',
            addedAt: now,
            addedBy: ctx.accountId,
          },
          ...options.initialGrants
            .filter((g) => !(g.principalType === 'USER' && g.principalId === ctx.accountId))
            .map((g) => ({ ...g, addedAt: now, addedBy: ctx.accountId })),
        ],
        bindings: [{ pageId: ctx.pageId, localId: ctx.localId }],
        auditHead: GENESIS_HASH,
        ...(title ? { title } : {}),
        ...(classification ? { classification } : {}),
        ...(options.initialGrants.some(
          (g) => g.principalType === 'USER' && g.principalId !== ctx.accountId,
        )
          ? {
              notices: options.initialGrants
                .filter((g) => g.principalType === 'USER' && g.principalId !== ctx.accountId)
                .map((g) => ({
                  accountId: g.principalId,
                  role: g.role,
                  addedBy: ctx.accountId,
                  at: now,
                })),
            }
          : {}),
      };
      const { audit, op: auditOp } = this.chain(section, 'SECTION_CREATE', ctx.accountId, {
        pageId: ctx.pageId,
        ...(classification ? { classification } : {}),
      });
      section.auditHead = audit.hash;
      const binding: BindingDoc = {
        schema: SCHEMA_VERSION,
        cloudId: ctx.cloudId,
        pageId: ctx.pageId,
        localId: ctx.localId,
        sectionId,
        kind: 'CREATE',
        createdAt: now,
        createdBy: ctx.accountId,
      };
      await this.store.transact([
        {
          kind: 'create',
          entity: 'section',
          key: Keys.section(sectionId),
          value: section,
          index: Idx.section(sectionId),
        },
        this.bindingOp(binding, r.staleBinding),
        this.revisionOp(this.buildRevision(sectionId, 1, seeded, ctx.accountId, null)),
        auditOp,
      ]);
      return this.getSection(ctx);
    });
  }

  private bindingOp(binding: BindingDoc, stale: Doc<BindingDoc> | null): TxOp {
    const key = Keys.binding(binding.pageId, binding.localId);
    const index = Idx.binding(binding.pageId, binding.localId);
    return stale
      ? { kind: 'put', entity: 'binding', key, value: binding, index, expectRev: stale.rev }
      : { kind: 'create', entity: 'binding', key, value: binding, index };
  }

  private async assertPageBindingCap(pageId: string): Promise<void> {
    const res = await this.store.list<BindingDoc>({
      entity: 'binding',
      partition: `page:${pageId}`,
      order: 'ASC',
      limit: LIMITS.maxBindingsPerPage,
    });
    if (res.items.length >= LIMITS.maxBindingsPerPage) throw new DomainError('RATE_LIMITED');
  }

  // ---------------------------------------------------------------- content

  async saveContent(
    ctx: TrustedContext,
    rawDoc: unknown,
    baseVersion: unknown,
    rawNote?: unknown,
  ): Promise<{ content: ContentPayload }> {
    if (typeof baseVersion !== 'number' || !Number.isInteger(baseVersion) || baseVersion < 1) {
      throw new DomainError('INVALID_REQUEST');
    }
    const v = safeValidateDoc(rawDoc);
    if (!v.ok) throw new DomainError('INVALID_CONTENT');
    const note = parseChangeNote(rawNote);
    if ((await this.readSitePolicy()).requireChangeNote && !note) {
      throw new DomainError('INVALID_REQUEST');
    }
    return this.writeVersion(ctx, v.doc, baseVersion, null, 'CONTENT_EDIT', note);
  }

  private async writeVersion(
    ctx: TrustedContext,
    doc: RichDoc,
    baseVersion: number,
    restoredFrom: number | null,
    action: 'CONTENT_EDIT' | 'CONTENT_RESTORE',
    changeNote: string | null = null,
  ): Promise<{ content: ContentPayload }> {
    return this.withRetry(async () => {
      const r = await this.requireBound(ctx, 'MODIFY', {
        pageEdit: true,
        op: 'write',
        auditDenied: true,
      });
      const s = r.section.value;
      if (s.headVersion !== baseVersion) {
        throw new DomainError('CONFLICT', { currentVersion: s.headVersion });
      }
      const version = s.headVersion + 1;
      const next: SectionDoc = { ...s, headVersion: version, updatedAt: this.nowIso() };
      const { audit, op } = this.chain(s, action, ctx.accountId, {
        version,
        ...(restoredFrom !== null ? { restoredFrom } : {}),
      });
      next.auditHead = audit.hash;
      const rev = this.buildRevision(
        s.sectionId,
        version,
        doc,
        ctx.accountId,
        restoredFrom,
        changeNote,
      );
      await this.store.transact([this.putSection(r.section, next), this.revisionOp(rev), op]);
      return {
        content: {
          doc,
          version,
          updatedAt: rev.createdAt,
          updatedBy: await this.userSummary(ctx.accountId),
        },
      };
    });
  }

  async listRevisions(ctx: TrustedContext, cursor: unknown): Promise<RevisionList> {
    const r = await this.requireBound(ctx, 'MODIFY', { op: 'history' });
    const c = parseCursor(cursor);
    const res = await this.store.list<RevisionDoc>({
      entity: 'revision',
      partition: r.section.value.sectionId,
      order: 'DESC',
      limit: LIMITS.revisionPageSize,
      cursor: c,
    });
    const authors = await this.userMap(res.items.map((i) => i.value.authorAccountId));
    return {
      revisions: res.items.map((i) => this.summary(i.value, authors)),
      nextCursor: res.nextCursor,
    };
  }

  private summary(v: RevisionDoc, authors: Map<string, UserSummary>): RevisionSummary {
    return {
      version: v.version,
      createdAt: v.createdAt,
      author: authors.get(v.authorAccountId) ?? null,
      restoredFrom: v.restoredFrom,
      bytes: v.bytes,
      changeNote: v.changeNote ?? null,
      tag: v.tag ?? null,
    };
  }

  private async userMap(ids: string[]): Promise<Map<string, UserSummary>> {
    const out = new Map<string, UserSummary>();
    const unique = [...new Set(ids)];
    if (unique.length === 0) return out;
    try {
      const m = await this.gateway.users(unique);
      for (const id of unique) {
        out.set(id, { accountId: id, displayName: m.get(id)?.displayName ?? id });
      }
    } catch {
      for (const id of unique) out.set(id, { accountId: id, displayName: id });
    }
    return out;
  }

  async getRevision(
    ctx: TrustedContext,
    version: unknown,
  ): Promise<{ doc: RichDoc; summary: RevisionSummary }> {
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
      throw new DomainError('INVALID_REQUEST');
    }
    const r = await this.requireBound(ctx, 'MODIFY', { op: 'history' });
    const rev = await this.store.get<RevisionDoc>(
      'revision',
      Keys.revision(r.section.value.sectionId, version),
    );
    if (!rev || rev.value.sectionId !== r.section.value.sectionId)
      throw new DomainError('NOT_FOUND');
    const doc = this.decodeRevision(rev.value);
    const authors = await this.userMap([rev.value.authorAccountId]);
    return { doc, summary: this.summary(rev.value, authors) };
  }

  async setRevisionTag(
    ctx: TrustedContext,
    version: unknown,
    tag: unknown,
  ): Promise<RevisionSummary> {
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
      throw new DomainError('INVALID_REQUEST');
    }
    const label = parseRevisionTag(tag);
    return this.withRetry(async () => {
      const r = await this.requireBound(ctx, 'MODIFY', {
        pageEdit: true,
        op: 'tag',
        auditDenied: true,
      });
      const key = Keys.revision(r.section.value.sectionId, version);
      const rev = await this.store.get<RevisionDoc>('revision', key);
      if (!rev || rev.value.sectionId !== r.section.value.sectionId) {
        throw new DomainError('NOT_FOUND');
      }
      if ((rev.value.tag ?? null) === label) {
        return this.summary(rev.value, await this.userMap([rev.value.authorAccountId]));
      }
      const nextRev: RevisionDoc = { ...rev.value, tag: label };
      const s = r.section.value;
      const now = this.nowIso();
      const { audit, op } = this.chain(s, 'REVISION_TAG', ctx.accountId, { version });
      const nextSection: SectionDoc = { ...s, auditHead: audit.hash, updatedAt: now };
      await this.store.transact([
        {
          kind: 'put',
          entity: 'revision',
          key,
          value: nextRev,
          index: Idx.revision(s.sectionId, version),
          expectRev: rev.rev,
        },
        this.putSection(r.section, nextSection),
        op,
      ]);
      return this.summary(nextRev, await this.userMap([nextRev.authorAccountId]));
    });
  }

  async restoreRevision(
    ctx: TrustedContext,
    version: unknown,
    baseVersion: unknown,
  ): Promise<{ content: ContentPayload }> {
    if (
      typeof version !== 'number' ||
      !Number.isInteger(version) ||
      version < 1 ||
      typeof baseVersion !== 'number' ||
      !Number.isInteger(baseVersion)
    ) {
      throw new DomainError('INVALID_REQUEST');
    }
    const r = await this.requireBound(ctx, 'MODIFY', {
      pageEdit: true,
      op: 'restore',
      auditDenied: true,
    });
    const rev = await this.store.get<RevisionDoc>(
      'revision',
      Keys.revision(r.section.value.sectionId, version),
    );
    if (!rev || rev.value.sectionId !== r.section.value.sectionId)
      throw new DomainError('NOT_FOUND');
    const doc = this.decodeRevision(rev.value);
    return this.writeVersion(ctx, doc, baseVersion, version, 'CONTENT_RESTORE');
  }

  // ---------------------------------------------------------------- permissions

  async getEffectiveAccess(ctx: TrustedContext): Promise<EffectiveAccess> {
    const r = await this.authz.resolve(ctx);
    if (r.kind !== 'BOUND') throw new DomainError(r.kind === 'UNBOUND' ? 'NOT_FOUND' : 'DENIED');
    const names = await this.groupNames(
      r.role.sources.filter((s) => s.via === 'GROUP').map((s) => s.principalId),
    );
    return {
      role: r.role.role,
      canEditPage: r.page.canEdit,
      groupResolution: r.role.groupsComplete ? 'OK' : 'DEGRADED',
      sources: r.role.sources.map((s) => ({
        via: s.via,
        principalId: s.principalId,
        label: s.via === 'GROUP' ? (names.get(s.principalId) ?? s.principalId) : 'You',
        role: s.role,
      })),
    };
  }

  private async groupNames(ids: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (ids.length === 0) return out;
    try {
      const m = await this.gateway.groups(ids);
      for (const id of ids) {
        const g = m.get(id);
        if (g) out.set(id, g.name);
      }
    } catch {
      /* labels are best-effort */
    }
    return out;
  }

  private async grantList(section: SectionDoc): Promise<GrantList> {
    const userIds = section.grants
      .filter((g) => g.principalType === 'USER')
      .map((g) => g.principalId);
    const groupIds = section.grants
      .filter((g) => g.principalType === 'GROUP')
      .map((g) => g.principalId);
    let users = new Map<string, { displayName: string; active: boolean }>();
    let groups = new Map<string, { name: string; exists: boolean }>();
    try {
      if (userIds.length) users = await this.gateway.users(userIds);
      if (groupIds.length) groups = await this.gateway.groups(groupIds);
    } catch {
      /* best effort labels */
    }
    const grants: Grant[] = section.grants.map((g) => {
      const extra = {
        expiresAt: g.expiresAt ?? null,
        lastAccessAt: g.lastAccessAt ?? null,
      };
      if (g.principalType === 'USER') {
        const u = users.get(g.principalId);
        return {
          ...g,
          ...extra,
          label: u?.displayName ?? g.principalId,
          active: u ? u.active : true,
        };
      }
      const gr = groups.get(g.principalId);
      return {
        ...g,
        ...extra,
        label: gr?.name ?? g.principalId,
        active: gr ? gr.exists : true,
      };
    });
    return { grants, aclVersion: section.aclVersion, ownerAccountId: section.ownerAccountId };
  }

  async listGrants(ctx: TrustedContext): Promise<GrantList> {
    const r = await this.requireBound(ctx, 'ADMINISTER', { op: 'acl-read', auditDenied: true });
    return this.grantList(r.section.value);
  }

  async searchPrincipals(
    ctx: TrustedContext,
    query: unknown,
    type: unknown,
  ): Promise<{ hits: PrincipalHit[] }> {
    if (typeof query !== 'string' || !isPrincipalType(type))
      throw new DomainError('INVALID_REQUEST');
    const q = query.trim();
    if (q.length < 2 || q.length > 100) throw new DomainError('INVALID_REQUEST');
    const resolved = await this.authz.resolve(ctx);
    if (resolved.kind === 'NO_ACCESS') throw new DomainError('DENIED');
    if (resolved.kind === 'BOUND') {
      if (!roleAtLeast(resolved.role.role, 'ADMINISTER')) {
        if (resolved.role.role === null && !resolved.role.groupsComplete) {
          throw new DomainError('UNAVAILABLE');
        }
        await this.recordDenied(resolved.section.value, ctx, 'acl-search');
        throw new DomainError('DENIED');
      }
    } else if (!resolved.page.canEdit) {
      throw new DomainError('DENIED');
    } else if ((await this.readSitePolicy()).whoMayCreate === 'SITE_ADMINS') {
      try {
        if (!(await this.gateway.isSiteAdmin(ctx.accountId))) throw new DomainError('DENIED');
      } catch (e) {
        if (e instanceof GatewayError) throw new DomainError('UNAVAILABLE');
        throw e;
      }
    }
    try {
      const hits =
        type === 'USER' ? await this.gateway.searchUsers(q) : await this.gateway.searchGroups(q);
      return { hits: hits.slice(0, LIMITS.principalSearchLimit) };
    } catch (e) {
      if (e instanceof GatewayError) throw new DomainError('UNAVAILABLE');
      throw e;
    }
  }

  private validatePrincipal(type: unknown, id: unknown): { type: PrincipalType; id: string } {
    if (!isPrincipalType(type) || typeof id !== 'string') throw new DomainError('INVALID_REQUEST');
    const re = type === 'USER' ? ACCOUNT_ID_RE : GROUP_ID_RE;
    if (!re.test(id)) throw new DomainError('INVALID_REQUEST');
    return { type, id };
  }

  private hasDirectAdmin(grants: SectionDoc['grants'], now = this.clock.now().getTime()): boolean {
    return grants.some(
      (g) =>
        g.principalType === 'USER' &&
        g.role === 'ADMINISTER' &&
        (!g.expiresAt || Date.parse(g.expiresAt) > now),
    );
  }

  async upsertGrant(
    ctx: TrustedContext,
    input: {
      principalType: unknown;
      principalId: unknown;
      role: unknown;
      expectedAclVersion: unknown;
      expiresAt?: unknown;
    },
  ): Promise<GrantList> {
    const p = this.validatePrincipal(input.principalType, input.principalId);
    if (!isRole(input.role)) throw new DomainError('INVALID_REQUEST');
    const role = input.role;
    const expected = parseVersion(input.expectedAclVersion);
    const policy = await this.readSitePolicy();
    let cap = policy.maxGrantDays;
    try {
      // Site administrators are not guests: the shorter cap applies to everyone else.
      if (p.type === 'USER' && (await this.gateway.isSiteAdmin(p.id))) cap = MAX_GRANT_TTL_DAYS;
    } catch (e) {
      if (e instanceof GatewayError) throw new DomainError('UNAVAILABLE');
      throw e;
    }
    const expiresAt = parseExpiresAt(input.expiresAt, this.clock.now(), cap);
    await this.assertPrincipalExists(p.type, p.id);
    return this.withRetry(async () => {
      const r = await this.requireBound(ctx, 'ADMINISTER', { op: 'acl-write', auditDenied: true });
      const s = r.section.value;
      if (s.aclVersion !== expected)
        throw new DomainError('CONFLICT', { currentAclVersion: s.aclVersion });
      const existing = s.grants.find((g) => g.principalType === p.type && g.principalId === p.id);
      const nextExpiry = input.expiresAt === undefined ? (existing?.expiresAt ?? null) : expiresAt;
      if (existing?.role === role && (existing.expiresAt ?? null) === nextExpiry) {
        return this.grantList(s);
      }
      if (!existing && s.grants.length >= LIMITS.maxGrants) throw new DomainError('RATE_LIMITED');
      const now = this.nowIso();
      const grants = existing
        ? s.grants.map((g) => (g === existing ? { ...g, role, expiresAt: nextExpiry } : g))
        : [
            ...s.grants,
            {
              principalType: p.type,
              principalId: p.id,
              role,
              addedAt: now,
              addedBy: ctx.accountId,
              expiresAt,
            },
          ];
      if (!this.hasDirectAdmin(grants)) throw new DomainError('LAST_ADMINISTRATOR');
      const next: SectionDoc = {
        ...s,
        grants,
        aclVersion: s.aclVersion + 1,
        updatedAt: now,
        ...(s.requests && p.type === 'USER'
          ? { requests: s.requests.filter((x) => x.accountId !== p.id) }
          : {}),
        ...(!existing && p.type === 'USER'
          ? { notices: this.pushNotice(s, p.id, role, ctx.accountId, now) }
          : {}),
      };
      const { audit, op } = this.chain(s, existing ? 'GRANT_UPDATE' : 'GRANT_ADD', ctx.accountId, {
        principalType: p.type,
        principalId: p.id,
        role,
        expires: nextExpiry !== null,
        ...(existing ? { previousRole: existing.role } : {}),
      });
      next.auditHead = audit.hash;
      await this.store.transact([this.putSection(r.section, next), op]);
      return this.grantList(next);
    });
  }

  private async assertPrincipalExists(type: PrincipalType, id: string): Promise<void> {
    try {
      if (type === 'USER') {
        const u = (await this.gateway.users([id])).get(id);
        if (!u || !u.active) throw new DomainError('INVALID_REQUEST');
      } else {
        const g = (await this.gateway.groups([id])).get(id);
        if (!g || !g.exists) throw new DomainError('INVALID_REQUEST');
      }
    } catch (e) {
      if (e instanceof GatewayError) throw new DomainError('UNAVAILABLE');
      throw e;
    }
  }

  async revokeGrant(
    ctx: TrustedContext,
    input: { principalType: unknown; principalId: unknown; expectedAclVersion: unknown },
  ): Promise<GrantList> {
    const p = this.validatePrincipal(input.principalType, input.principalId);
    const expected = parseVersion(input.expectedAclVersion);
    return this.withRetry(async () => {
      const r = await this.requireBound(ctx, 'ADMINISTER', { op: 'acl-write', auditDenied: true });
      const s = r.section.value;
      if (s.aclVersion !== expected)
        throw new DomainError('CONFLICT', { currentAclVersion: s.aclVersion });
      const existing = s.grants.find((g) => g.principalType === p.type && g.principalId === p.id);
      if (!existing) return this.grantList(s);
      const grants = s.grants.filter((g) => g !== existing);
      if (!this.hasDirectAdmin(grants)) throw new DomainError('LAST_ADMINISTRATOR');
      const next: SectionDoc = {
        ...s,
        grants,
        aclVersion: s.aclVersion + 1,
        updatedAt: this.nowIso(),
        ownerAccountId:
          p.type === 'USER' && p.id === s.ownerAccountId
            ? (grants.find((g) => g.principalType === 'USER' && g.role === 'ADMINISTER')
                ?.principalId ?? s.ownerAccountId)
            : s.ownerAccountId,
      };
      const { audit, op } = this.chain(s, 'GRANT_REVOKE', ctx.accountId, {
        principalType: p.type,
        principalId: p.id,
        previousRole: existing.role,
      });
      next.auditHead = audit.hash;
      await this.store.transact([this.putSection(r.section, next), op]);
      return this.grantList(next);
    });
  }

  async setOwner(
    ctx: TrustedContext,
    input: { accountId: unknown; expectedAclVersion: unknown },
  ): Promise<GrantList> {
    const p = this.validatePrincipal('USER', input.accountId);
    const expected = parseVersion(input.expectedAclVersion);
    return this.withRetry(async () => {
      const r = await this.requireBound(ctx, 'ADMINISTER', { op: 'owner', auditDenied: true });
      const s = r.section.value;
      if (s.aclVersion !== expected)
        throw new DomainError('CONFLICT', { currentAclVersion: s.aclVersion });
      const target = s.grants.find(
        (g) => g.principalType === 'USER' && g.principalId === p.id && g.role === 'ADMINISTER',
      );
      if (!target) throw new DomainError('INVALID_REQUEST');
      if (s.ownerAccountId === p.id) return this.grantList(s);
      const next: SectionDoc = {
        ...s,
        ownerAccountId: p.id,
        aclVersion: s.aclVersion + 1,
        updatedAt: this.nowIso(),
      };
      const { audit, op } = this.chain(s, 'OWNER_CHANGE', ctx.accountId, {
        previousOwner: s.ownerAccountId,
        newOwner: p.id,
      });
      next.auditHead = audit.hash;
      await this.store.transact([this.putSection(r.section, next), op]);
      return this.grantList(next);
    });
  }

  async copyGrants(
    ctx: TrustedContext,
    sourceRef: unknown,
    expectedAclVersion: unknown,
  ): Promise<GrantList> {
    if (typeof sourceRef !== 'string' || !UUID_RE.test(sourceRef)) throw new DomainError('DENIED');
    const expected = parseVersion(expectedAclVersion);
    return this.withRetry(async () => {
      const target = await this.requireBound(ctx, 'ADMINISTER', {
        op: 'acl-write',
        auditDenied: true,
      });
      const source = await this.authz.resolveByRef(ctx, sourceRef);
      // Same answer for a missing section and a section the caller does not administer.
      if (!source || !roleAtLeast(source.role.role, 'ADMINISTER')) throw new DomainError('DENIED');
      const s = target.section.value;
      if (source.section.value.sectionId === s.sectionId) return this.grantList(s);
      if (s.aclVersion !== expected)
        throw new DomainError('CONFLICT', { currentAclVersion: s.aclVersion });
      return this.mergeGrants(ctx, target, source.section.value.grants, 'copy');
    });
  }

  async seedPageRestrictions(ctx: TrustedContext, expectedAclVersion: unknown): Promise<GrantList> {
    const expected = parseVersion(expectedAclVersion);
    let hits;
    try {
      hits = await this.gateway.pageRestrictions(ctx.pageId);
    } catch (e) {
      if (e instanceof GatewayError) throw new DomainError('UNAVAILABLE');
      throw e;
    }
    return this.withRetry(async () => {
      const target = await this.requireBound(ctx, 'ADMINISTER', {
        op: 'acl-write',
        auditDenied: true,
      });
      const s = target.section.value;
      if (s.aclVersion !== expected)
        throw new DomainError('CONFLICT', { currentAclVersion: s.aclVersion });
      const best = new Map<string, { type: PrincipalType; id: string; role: Role }>();
      for (const hit of hits) {
        const key = `${hit.principalType}:${hit.principalId}`;
        const role: Role = hit.operation === 'update' ? 'MODIFY' : 'VIEW';
        const prev = best.get(key);
        if (!prev || roleAtLeast(role, prev.role))
          best.set(key, { type: hit.principalType, id: hit.principalId, role });
      }
      const incoming: SectionDoc['grants'] = [];
      for (const item of best.values()) {
        if (!(await this.principalAlive(item.type, item.id))) continue;
        incoming.push({
          principalType: item.type,
          principalId: item.id,
          role: item.role,
          addedAt: this.nowIso(),
          addedBy: ctx.accountId,
        });
      }
      return this.mergeGrants(ctx, target, incoming, 'page');
    });
  }

  private async principalAlive(type: PrincipalType, id: string): Promise<boolean> {
    try {
      if (type === 'USER') return (await this.gateway.users([id])).get(id)?.active === true;
      return (await this.gateway.groups([id])).get(id)?.exists === true;
    } catch (e) {
      if (e instanceof GatewayError) throw new DomainError('UNAVAILABLE');
      throw e;
    }
  }

  /** Add grants that are not already present. Never removes or downgrades an existing grant. */
  private async mergeGrants(
    ctx: TrustedContext,
    target: BoundResolved,
    incoming: SectionDoc['grants'],
    via: 'copy' | 'page',
  ): Promise<GrantList> {
    const s = target.section.value;
    const have = new Set(s.grants.map((g) => `${g.principalType}:${g.principalId}`));
    const now = this.clock.now().getTime();
    const fresh = incoming.filter((g) => {
      if (have.has(`${g.principalType}:${g.principalId}`)) return false;
      return !g.expiresAt || Date.parse(g.expiresAt) > now;
    });
    if (fresh.length === 0) return this.grantList(s);
    if (s.grants.length + fresh.length > LIMITS.maxGrants) throw new DomainError('RATE_LIMITED');
    const at = this.nowIso();
    let notices = s.notices ?? [];
    const added = fresh.map((g) => ({ ...g, addedAt: at, addedBy: ctx.accountId }));
    for (const g of added) {
      if (g.principalType === 'USER') {
        notices = this.pushNotice({ ...s, notices }, g.principalId, g.role, ctx.accountId, at);
      }
    }
    const next: SectionDoc = {
      ...s,
      grants: [...s.grants, ...added],
      notices,
      aclVersion: s.aclVersion + 1,
      updatedAt: at,
    };
    const { audit, op } = this.chain(s, 'GRANT_ADD', ctx.accountId, {
      via,
      added: added.length,
    });
    next.auditHead = audit.hash;
    await this.store.transact([this.putSection(target.section, next), op]);
    return this.grantList(next);
  }

  async dismissNotice(ctx: TrustedContext): Promise<{ dismissed: true }> {
    return this.withRetry(async () => {
      const r = await this.requireBound(ctx, 'VIEW', { op: 'notice' });
      const s = r.section.value;
      const notices = (s.notices ?? []).filter((n) => n.accountId !== ctx.accountId);
      if (notices.length === (s.notices ?? []).length) return { dismissed: true as const };
      const next: SectionDoc = { ...s, notices, updatedAt: this.nowIso() };
      await this.store.transact([this.putSection(r.section, next)]);
      return { dismissed: true as const };
    });
  }

  // ---------------------------------------------------------------- access requests

  private liveRequests(s: SectionDoc): AccessRequestRec[] {
    const cutoff = this.clock.now().getTime() - REQUEST_TTL_DAYS * 86_400_000;
    return (s.requests ?? []).filter((r) => Date.parse(r.requestedAt) > cutoff);
  }

  /**
   * Gate for the "I have no access" operations: the caller can view the page, the macro is bound
   * to an active section, and the caller has no role on it. Everything else is generic.
   */
  private async requireRequester(ctx: TrustedContext): Promise<BoundResolved> {
    const r = await this.authz.resolve(ctx);
    if (r.kind !== 'BOUND') throw new DomainError(r.kind === 'UNBOUND' ? 'NOT_FOUND' : 'DENIED');
    if (r.role.role !== null) throw new DomainError('DENIED');
    if (!r.role.groupsComplete) throw new DomainError('UNAVAILABLE');
    return r;
  }

  private async accessInfoOf(s: SectionDoc, accountId: string): Promise<AccessInfo> {
    const adminIds = s.grants
      .filter((g) => g.principalType === 'USER' && g.role === 'ADMINISTER')
      .map((g) => g.principalId);
    const administrators: AccessInfo['administrators'] = [];
    if (adminIds.length) {
      try {
        const users = await this.gateway.users(adminIds);
        for (const id of adminIds) {
          const u = users.get(id);
          if (u?.active) administrators.push({ accountId: id, displayName: u.displayName });
          if (administrators.length >= LIMITS.maxAdminNamesShown) break;
        }
      } catch {
        /* names are best effort */
      }
    }
    const mine = this.liveRequests(s).find((r) => r.accountId === accountId);
    return {
      title: s.title ?? null,
      classification: s.classification ?? null,
      administrators,
      myRequest: mine
        ? { role: mine.role, reason: mine.reason, requestedAt: mine.requestedAt }
        : null,
    };
  }

  async getAccessInfo(ctx: TrustedContext): Promise<AccessInfo> {
    const r = await this.requireRequester(ctx);
    return this.accessInfoOf(r.section.value, ctx.accountId);
  }

  async requestAccess(
    ctx: TrustedContext,
    input: { role: unknown; reason: unknown },
  ): Promise<AccessInfo> {
    if (!(await this.readSitePolicy()).allowRequests) throw new DomainError('DENIED');
    if (!isRequestableRole(input.role)) throw new DomainError('INVALID_REQUEST');
    const role: RequestableRole = input.role;
    const reason = parseReason(input.reason);
    return this.withRetry(async () => {
      const r = await this.requireRequester(ctx);
      const s = r.section.value;
      const live = this.liveRequests(s);
      const existing = live.find((x) => x.accountId === ctx.accountId);
      if (existing?.role === role && existing.reason === reason) {
        return this.accessInfoOf(s, ctx.accountId);
      }
      if (!existing && live.length >= LIMITS.maxPendingRequests) {
        throw new DomainError('RATE_LIMITED');
      }
      const requests: AccessRequestRec[] = [
        ...live.filter((x) => x.accountId !== ctx.accountId),
        { accountId: ctx.accountId, role, reason, requestedAt: this.nowIso() },
      ];
      const next: SectionDoc = { ...s, requests, updatedAt: this.nowIso() };
      const { audit, op } = this.chain(s, 'ACCESS_REQUEST', ctx.accountId, {
        role,
        hasReason: reason !== '',
      });
      next.auditHead = audit.hash;
      await this.store.transact([this.putSection(r.section, next), op]);
      return this.accessInfoOf(next, ctx.accountId);
    });
  }

  async cancelAccessRequest(ctx: TrustedContext): Promise<AccessInfo> {
    return this.withRetry(async () => {
      const r = await this.requireRequester(ctx);
      const s = r.section.value;
      const live = this.liveRequests(s);
      if (!live.some((x) => x.accountId === ctx.accountId)) {
        return this.accessInfoOf(s, ctx.accountId);
      }
      const next: SectionDoc = {
        ...s,
        requests: live.filter((x) => x.accountId !== ctx.accountId),
        updatedAt: this.nowIso(),
      };
      const { audit, op } = this.chain(s, 'ACCESS_REQUEST_CANCEL', ctx.accountId, {});
      next.auditHead = audit.hash;
      await this.store.transact([this.putSection(r.section, next), op]);
      return this.accessInfoOf(next, ctx.accountId);
    });
  }

  private async requestList(s: SectionDoc): Promise<AccessRequestList> {
    const live = this.liveRequests(s);
    let users = new Map<string, { displayName: string; active: boolean }>();
    if (live.length) {
      try {
        users = await this.gateway.users(live.map((x) => x.accountId));
      } catch {
        /* names are best effort */
      }
    }
    const requests: AccessRequestItem[] = live
      .map((x) => ({
        accountId: x.accountId,
        displayName: users.get(x.accountId)?.displayName ?? x.accountId,
        active: users.get(x.accountId)?.active ?? true,
        role: x.role,
        reason: x.reason,
        requestedAt: x.requestedAt,
      }))
      .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
    return { requests, aclVersion: s.aclVersion };
  }

  async listAccessRequests(ctx: TrustedContext): Promise<AccessRequestList> {
    const r = await this.requireBound(ctx, 'ADMINISTER', {
      op: 'requests-read',
      auditDenied: true,
    });
    return this.requestList(r.section.value);
  }

  async resolveAccessRequest(
    ctx: TrustedContext,
    input: { accountId: unknown; decision: unknown; role?: unknown; expectedAclVersion: unknown },
  ): Promise<AccessRequestList> {
    const p = this.validatePrincipal('USER', input.accountId);
    if (input.decision !== 'APPROVE' && input.decision !== 'REJECT') {
      throw new DomainError('INVALID_REQUEST');
    }
    const approve = input.decision === 'APPROVE';
    if (input.role !== undefined && !isRequestableRole(input.role)) {
      throw new DomainError('INVALID_REQUEST');
    }
    const roleOverride: RequestableRole | undefined = input.role;
    const expected = parseVersion(input.expectedAclVersion);
    if (approve) await this.assertPrincipalExists('USER', p.id);
    return this.withRetry(async () => {
      const r = await this.requireBound(ctx, 'ADMINISTER', {
        op: 'requests-write',
        auditDenied: true,
      });
      const s = r.section.value;
      const live = this.liveRequests(s);
      const request = live.find((x) => x.accountId === p.id);
      if (!request) throw new DomainError('NOT_FOUND');
      const remaining = live.filter((x) => x !== request);
      const now = this.nowIso();
      if (!approve) {
        const next: SectionDoc = { ...s, requests: remaining, updatedAt: now };
        const { audit, op } = this.chain(s, 'ACCESS_REQUEST_REJECT', ctx.accountId, {
          principalId: p.id,
        });
        next.auditHead = audit.hash;
        await this.store.transact([this.putSection(r.section, next), op]);
        return this.requestList(next);
      }
      if (s.aclVersion !== expected) {
        throw new DomainError('CONFLICT', { currentAclVersion: s.aclVersion });
      }
      const role = roleOverride ?? request.role;
      const existing = s.grants.find((g) => g.principalType === 'USER' && g.principalId === p.id);
      if (!existing && s.grants.length >= LIMITS.maxGrants) throw new DomainError('RATE_LIMITED');
      const grants = existing
        ? s.grants.map((g) => (g === existing && !roleAtLeast(g.role, role) ? { ...g, role } : g))
        : [
            ...s.grants,
            {
              principalType: 'USER' as const,
              principalId: p.id,
              role,
              addedAt: now,
              addedBy: ctx.accountId,
            },
          ];
      const next: SectionDoc = {
        ...s,
        grants,
        requests: remaining,
        aclVersion: s.aclVersion + 1,
        updatedAt: now,
      };
      const { audit, op } = this.chain(s, 'ACCESS_REQUEST_APPROVE', ctx.accountId, {
        principalId: p.id,
        role,
        requestedRole: request.role,
      });
      next.auditHead = audit.hash;
      await this.store.transact([this.putSection(r.section, next), op]);
      return this.requestList(next);
    });
  }

  // ---------------------------------------------------------------- metadata

  /** Title and classification are visible to anyone who can view the page; ADMINISTER only. */
  async updateMetadata(
    ctx: TrustedContext,
    input: { title: unknown; classification: unknown },
  ): Promise<SectionMeta> {
    const title = parseTitle(input.title);
    const classification = parseClassification(input.classification);
    return this.withRetry(async () => {
      const r = await this.requireBound(ctx, 'ADMINISTER', { op: 'metadata', auditDenied: true });
      const s = r.section.value;
      if ((s.title ?? null) === title && (s.classification ?? null) === classification) {
        return this.metaOf(s);
      }
      const next: SectionDoc = { ...s, title, classification, updatedAt: this.nowIso() };
      const { audit, op } = this.chain(s, 'METADATA_UPDATE', ctx.accountId, {
        titleSet: title !== null,
        classification,
      });
      next.auditHead = audit.hash;
      await this.store.transact([this.putSection(r.section, next), op]);
      return this.metaOf(next);
    });
  }

  // ---------------------------------------------------------------- audit

  async listAudit(ctx: TrustedContext, cursor: unknown): Promise<AuditList> {
    const r = await this.requireBound(ctx, 'ADMINISTER', { op: 'audit-read', auditDenied: true });
    const c = parseCursor(cursor);
    const res = await this.store.list<AuditDoc>({
      entity: 'audit',
      partition: r.section.value.sectionId,
      order: 'DESC',
      limit: LIMITS.auditPageSize,
      cursor: c,
    });
    const docs = res.items.map((i) => i.value);
    const entries: AuditEntry[] = docs.map((d) => ({
      id: d.id,
      at: d.at,
      action: d.action,
      actor: d.actor,
      meta: d.meta,
    }));
    const chain = verifyChain(docs, {
      head: r.section.value.auditHead,
      isFirstPage: !c,
      isLastPage: res.nextCursor === null,
    });
    return { entries, nextCursor: res.nextCursor, chain };
  }

  // ---------------------------------------------------------------- binding / copy / delete

  async getShareReference(ctx: TrustedContext): Promise<{ sectionRef: string }> {
    const r = await this.requireBound(ctx, 'ADMINISTER', { op: 'share-ref', auditDenied: true });
    return { sectionRef: r.section.value.sectionId };
  }

  private parseRef(ref: unknown): string {
    if (typeof ref !== 'string') throw new DomainError('INVALID_REQUEST');
    const t = ref.trim().toLowerCase();
    if (!UUID_RE.test(t)) throw new DomainError('INVALID_REQUEST');
    return t;
  }

  async bindHere(ctx: TrustedContext, ref: unknown): Promise<SectionView> {
    const sectionId = this.parseRef(ref);
    return this.withRetry(async () => {
      const r = await this.authz.resolve(ctx);
      if (r.kind === 'NO_ACCESS') throw new DomainError('DENIED');
      if (r.kind === 'BOUND') throw new DomainError('CONFLICT');
      if (!r.page.canEdit) throw new DomainError('PAGE_EDIT_REQUIRED');
      const target = await this.authz.resolveByRef(ctx, sectionId);
      // Same generic error for "does not exist" and "not an administrator": no oracle.
      if (!target || !roleAtLeast(target.role.role, 'ADMINISTER')) throw new DomainError('DENIED');
      const s = target.section.value;
      if (s.bindings.length >= LIMITS.maxBindingsPerSection) throw new DomainError('RATE_LIMITED');
      await this.assertPageBindingCap(ctx.pageId);
      const now = this.nowIso();
      const next: SectionDoc = {
        ...s,
        bindings: [...s.bindings, { pageId: ctx.pageId, localId: ctx.localId }],
        updatedAt: now,
      };
      const { audit, op } = this.chain(s, 'BINDING_ADD', ctx.accountId, {
        pageId: ctx.pageId,
        kind: 'REBIND',
      });
      next.auditHead = audit.hash;
      const binding: BindingDoc = {
        schema: SCHEMA_VERSION,
        cloudId: ctx.cloudId,
        pageId: ctx.pageId,
        localId: ctx.localId,
        sectionId,
        kind: 'REBIND',
        createdAt: now,
        createdBy: ctx.accountId,
      };
      await this.store.transact([
        this.putSection(target.section, next),
        this.bindingOp(binding, r.staleBinding),
        op,
      ]);
      return this.getSection(ctx);
    });
  }

  async copyHere(ctx: TrustedContext, ref: unknown): Promise<SectionView> {
    const sourceId = this.parseRef(ref);
    return this.withRetry(async () => {
      const r = await this.authz.resolve(ctx);
      if (r.kind === 'NO_ACCESS') throw new DomainError('DENIED');
      if (r.kind === 'BOUND') throw new DomainError('CONFLICT');
      if (!r.page.canEdit) throw new DomainError('PAGE_EDIT_REQUIRED');
      const source = await this.authz.resolveByRef(ctx, sourceId);
      if (!source || !roleAtLeast(source.role.role, 'VIEW')) throw new DomainError('DENIED');
      const srcPage = await this.authz.pageAccess(
        ctx.accountId,
        source.section.value.primaryPageId,
      );
      if (!srcPage.canView) throw new DomainError('DENIED');
      let head: ContentPayload;
      try {
        head = await this.readHead(source.section.value);
      } catch (e) {
        if (e instanceof CorruptedContentError) throw new DomainError('NOT_FOUND');
        throw e;
      }
      await this.assertPageBindingCap(ctx.pageId);

      const now = this.nowIso();
      const sectionId = this.ids.uuid();
      const section: SectionDoc = {
        schema: SCHEMA_VERSION,
        sectionId,
        cloudId: ctx.cloudId,
        status: 'ACTIVE',
        ownerAccountId: ctx.accountId,
        primaryPageId: ctx.pageId,
        spaceKey: ctx.spaceKey,
        createdAt: now,
        createdBy: ctx.accountId,
        updatedAt: now,
        deletedAt: null,
        headVersion: 1,
        aclVersion: 1,
        grants: [
          {
            principalType: 'USER',
            principalId: ctx.accountId,
            role: 'ADMINISTER',
            addedAt: now,
            addedBy: ctx.accountId,
          },
        ],
        bindings: [{ pageId: ctx.pageId, localId: ctx.localId }],
        auditHead: GENESIS_HASH,
      };
      const created = this.chain(section, 'SECTION_COPY', ctx.accountId, {
        direction: 'target',
        pageId: ctx.pageId,
      });
      section.auditHead = created.audit.hash;
      const src = source.section.value;
      const srcNext: SectionDoc = { ...src, updatedAt: now };
      const srcAudit = this.chain(src, 'SECTION_COPY', ctx.accountId, {
        direction: 'source',
        targetPageId: ctx.pageId,
      });
      srcNext.auditHead = srcAudit.audit.hash;
      const binding: BindingDoc = {
        schema: SCHEMA_VERSION,
        cloudId: ctx.cloudId,
        pageId: ctx.pageId,
        localId: ctx.localId,
        sectionId,
        kind: 'COPY',
        createdAt: now,
        createdBy: ctx.accountId,
      };
      await this.store.transact([
        {
          kind: 'create',
          entity: 'section',
          key: Keys.section(sectionId),
          value: section,
          index: Idx.section(sectionId),
        },
        this.bindingOp(binding, r.staleBinding),
        this.revisionOp(this.buildRevision(sectionId, 1, head.doc, ctx.accountId, null)),
        created.op,
        this.putSection(source.section, srcNext),
        srcAudit.op,
      ]);
      return this.getSection(ctx);
    });
  }

  async deleteSection(ctx: TrustedContext, confirm: unknown): Promise<{ deleted: true }> {
    if (confirm !== 'DELETE') throw new DomainError('INVALID_REQUEST');
    return this.withRetry(async () => {
      const r = await this.requireBound(ctx, 'ADMINISTER', {
        pageEdit: true,
        op: 'delete',
        auditDenied: true,
      });
      const s = r.section.value;
      const now = this.nowIso();
      const next: SectionDoc = { ...s, status: 'DELETED', deletedAt: now, updatedAt: now };
      const { audit, op } = this.chain(s, 'SECTION_DELETE', ctx.accountId, {});
      next.auditHead = audit.hash;
      await this.store.transact([this.putSection(r.section, next), op]);
      return { deleted: true as const };
    });
  }

  // ---------------------------------------------------------------- diagnostics / recovery

  async getRetention(): Promise<RetentionConfig> {
    const m = await this.store.get<MetaDoc<Partial<RetentionConfig>>>(
      'meta',
      Keys.meta('retention'),
    );
    return { ...DEFAULT_RETENTION, ...(m?.value.value ?? {}) };
  }

  async getDiagnostics(ctx: TrustedContext): Promise<Diagnostics> {
    await this.requireSiteAdmin(ctx.accountId);
    const checks: Diagnostics['checks'] = [];
    const canary = Keys.meta(`canary-${this.ids.uuid().slice(-8)}`);
    try {
      await this.store.transact([
        {
          kind: 'create',
          entity: 'meta',
          key: canary,
          value: { schema: SCHEMA_VERSION },
          index: Idx.meta(canary),
        },
      ]);
      await this.store.transact([{ kind: 'delete', entity: 'meta', key: canary }]);
      checks.push({
        name: 'storage-transaction',
        status: 'OK',
        message: 'Conditional write and delete succeeded.',
      });
    } catch {
      checks.push({
        name: 'storage-transaction',
        status: 'FAIL',
        message: 'Storage transaction failed.',
      });
    }
    try {
      await this.gateway.groupMembership(ctx.accountId);
      checks.push({ name: 'group-resolution', status: 'OK', message: 'Group lookup works.' });
    } catch {
      checks.push({
        name: 'group-resolution',
        status: 'FAIL',
        message: 'Group lookup failed; group grants will not apply.',
      });
    }
    try {
      await this.gateway.pagePermissions(ctx.accountId, ctx.pageId);
      checks.push({
        name: 'page-permission-check',
        status: 'OK',
        message: 'Page permission check works.',
      });
    } catch {
      checks.push({
        name: 'page-permission-check',
        status: 'FAIL',
        message: 'Page permission check failed; access is denied until fixed.',
      });
    }
    const first = await this.store.list<unknown>({
      entity: 'section',
      partition: 'all',
      order: 'ASC',
      limit: 1000,
    });
    return {
      schemaVersion: SCHEMA_VERSION,
      sectionCount: first.nextCursor ? null : first.items.length,
      healthy: checks.every((c) => c.status === 'OK'),
      checks,
      retention: await this.getRetention(),
    };
  }

  private async requireSiteAdmin(accountId: string): Promise<void> {
    try {
      if (!(await this.gateway.isSiteAdmin(accountId))) throw new DomainError('DENIED');
    } catch (e) {
      if (e instanceof GatewayError) throw new DomainError('UNAVAILABLE');
      throw e;
    }
  }

  /**
   * Break-glass recovery. Separate authority (Confluence site administrator, verified server-side),
   * only when the macro's section has NO active administrator, explicit typed confirmation, and a
   * permanent audit entry. It adds one administrator; it never returns content.
   */
  async recoverSection(
    ctx: TrustedContext,
    input: { newAdministratorAccountId: unknown; confirm: unknown },
  ): Promise<{ recovered: true }> {
    if (input.confirm !== 'RECOVER') throw new DomainError('INVALID_REQUEST');
    const target = this.validatePrincipal('USER', input.newAdministratorAccountId);
    await this.requireSiteAdmin(ctx.accountId);
    await this.assertPrincipalExists('USER', target.id);
    return this.withRetry(async () => {
      const page = await this.authz.pageAccess(ctx.accountId, ctx.pageId);
      if (!page.canView) throw new DomainError('DENIED');
      const binding = await this.store.get<BindingDoc>(
        'binding',
        Keys.binding(ctx.pageId, ctx.localId),
      );
      if (!binding || binding.value.cloudId !== ctx.cloudId)
        throw new DomainError('NOT_RECOVERABLE');
      const sec = await this.store.get<SectionDoc>(
        'section',
        Keys.section(binding.value.sectionId),
      );
      if (!sec || sec.value.cloudId !== ctx.cloudId) throw new DomainError('NOT_RECOVERABLE');
      const s = sec.value;
      if (await this.hasActiveAdministrator(s)) throw new DomainError('NOT_RECOVERABLE');
      const now = this.nowIso();
      const existing = s.grants.find(
        (g) => g.principalType === 'USER' && g.principalId === target.id,
      );
      const grants = existing
        ? s.grants.map((g) => (g === existing ? { ...g, role: 'ADMINISTER' as const } : g))
        : [
            ...s.grants,
            {
              principalType: 'USER' as const,
              principalId: target.id,
              role: 'ADMINISTER' as const,
              addedAt: now,
              addedBy: ctx.accountId,
            },
          ];
      const next: SectionDoc = {
        ...s,
        status: 'ACTIVE',
        deletedAt: null,
        grants,
        ownerAccountId: target.id,
        aclVersion: s.aclVersion + 1,
        updatedAt: now,
      };
      const { audit, op } = this.chain(s, 'ADMIN_RECOVERY', ctx.accountId, {
        newAdministrator: target.id,
        wasDeleted: s.status === 'DELETED',
      });
      next.auditHead = audit.hash;
      await this.store.transact([this.putSection(sec, next), op]);
      return { recovered: true as const };
    });
  }

  private async hasActiveAdministrator(s: SectionDoc): Promise<boolean> {
    const admins = s.grants.filter((g) => g.role === 'ADMINISTER');
    const users = admins.filter((g) => g.principalType === 'USER').map((g) => g.principalId);
    const groups = admins.filter((g) => g.principalType === 'GROUP').map((g) => g.principalId);
    try {
      if (users.length) {
        const m = await this.gateway.users(users);
        if (users.some((id) => m.get(id)?.active)) return true;
      }
      for (const gid of groups) {
        const info = (await this.gateway.groups([gid])).get(gid);
        if (info?.exists && (await this.gateway.groupHasMembers(gid))) return true;
      }
    } catch (e) {
      // If we cannot prove the administrators are gone, treat them as present (fail closed).
      if (e instanceof GatewayError) return true;
      throw e;
    }
    return false;
  }

  // ---------------------------------------------------------------- site home

  private directRole(
    s: SectionDoc,
    accountId: string,
    groupIds: Set<string>,
    now: number,
  ): Role | null {
    const roles: Role[] = [];
    for (const g of s.grants) {
      if (g.expiresAt && Date.parse(g.expiresAt) <= now) continue;
      if (g.principalType === 'USER' && g.principalId === accountId) roles.push(g.role);
      if (g.principalType === 'GROUP' && groupIds.has(g.principalId)) roles.push(g.role);
    }
    return maxRole(roles);
  }

  private async visibleSections(
    ctx: SiteContext,
  ): Promise<Array<{ section: Doc<SectionDoc>; role: Role }>> {
    let groupIds = new Set<string>();
    try {
      const membership = await this.gateway.groupMembership(ctx.accountId);
      if (membership.complete) groupIds = new Set(membership.groupIds);
    } catch (e) {
      if (!(e instanceof GatewayError)) throw e;
    }
    const listed = await this.store.list<SectionDoc>({
      entity: 'section',
      partition: 'all',
      order: 'ASC',
      limit: 200,
    });
    const now = this.clock.now().getTime();
    const out: Array<{ section: Doc<SectionDoc>; role: Role }> = [];
    for (const item of listed.items) {
      const s = item.value;
      if (s.cloudId !== ctx.cloudId || s.status !== 'ACTIVE') continue;
      const role = this.directRole(s, ctx.accountId, groupIds, now);
      if (role) out.push({ section: item, role });
    }
    return out;
  }

  async listMySections(ctx: SiteContext): Promise<MySections> {
    const visible = await this.visibleSections(ctx);
    const now = this.clock.now().getTime();
    const rows: MySections['rows'] = [];
    const activity: MySections['activity'] = [];
    let administered = 0;
    let pendingRequests = 0;
    let expiringGrants = 0;
    let inactive = 0;
    for (const { section, role } of visible) {
      const s = section.value;
      let pageStatus: MySections['rows'][number]['pageStatus'] = 'UNKNOWN';
      let pageTitle: string | null = null;
      try {
        const page = await this.gateway.pageSummary(s.primaryPageId);
        pageStatus = page.status;
        pageTitle = page.title;
      } catch (e) {
        if (!(e instanceof GatewayError)) throw e;
      }
      if (role === 'ADMINISTER') {
        administered += 1;
        pendingRequests += this.liveRequests(s).length;
        expiringGrants += s.grants.filter((g) => {
          if (!g.expiresAt) return false;
          const t = Date.parse(g.expiresAt);
          return t > now && t - now <= 7 * 86_400_000;
        }).length;
      }
      if (now - Date.parse(s.updatedAt) > 90 * 86_400_000) inactive += 1;
      rows.push({
        sectionId: s.sectionId,
        title: s.title ?? null,
        classification: s.classification ?? null,
        pageId: s.primaryPageId,
        pageTitle,
        spaceKey: s.spaceKey,
        pageStatus,
        role,
        sharedUsers: s.grants.filter((g) => g.principalType === 'USER').length,
        updatedAt: s.updatedAt,
      });
      const audits = await this.store.list<AuditDoc>({
        entity: 'audit',
        partition: s.sectionId,
        order: 'DESC',
        limit: 5,
      });
      for (const a of audits.items) {
        if (a.value.erased) continue;
        activity.push({
          at: a.value.at,
          action: a.value.action,
          actor: a.value.actor,
          title: s.title ?? null,
        });
      }
    }
    rows.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    activity.sort((a, b) => (a.at < b.at ? 1 : -1));
    const listed = await this.store.list<SectionDoc>({
      entity: 'section',
      partition: 'all',
      order: 'ASC',
      limit: 200,
    });
    return {
      rows,
      truncated: listed.nextCursor !== null,
      kpis: { administered, pendingRequests, expiringGrants, inactive },
      activity: activity.slice(0, 20),
    };
  }

  async exportMyAudit(ctx: SiteContext): Promise<AuditExport> {
    const visible = await this.visibleSections(ctx);
    const lines = ['at,action,actor,section'];
    let rows = 0;
    let truncated = false;
    for (const { section } of visible) {
      const s = section.value;
      const audits = await this.store.list<AuditDoc>({
        entity: 'audit',
        partition: s.sectionId,
        order: 'DESC',
        limit: 100,
      });
      for (const a of audits.items) {
        if (rows >= 500) {
          truncated = true;
          break;
        }
        if (a.value.erased) continue;
        const title = s.title ?? '';
        lines.push([a.value.at, a.value.action, a.value.actor, title].map(csvCell).join(','));
        rows += 1;
      }
      if (truncated) break;
    }
    return { csv: lines.join('\n'), rows, truncated };
  }

  async deleteOrphan(
    ctx: SiteContext,
    sectionId: unknown,
    confirm: unknown,
  ): Promise<{ deleted: true }> {
    if (confirm !== 'DELETE') throw new DomainError('INVALID_REQUEST');
    if (typeof sectionId !== 'string' || !UUID_RE.test(sectionId)) throw new DomainError('DENIED');
    return this.withRetry(async () => {
      const found = await this.authz.resolveByRef(
        { ...ctx, pageId: ctx.pageId ?? '0', localId: ctx.localId ?? 'site' } as TrustedContext,
        sectionId,
      );
      if (!found || !roleAtLeast(found.role.role, 'ADMINISTER')) throw new DomainError('DENIED');
      const s = found.section.value;
      let status: 'OK' | 'MISSING' | 'UNKNOWN' = 'UNKNOWN';
      try {
        status = (await this.gateway.pageSummary(s.primaryPageId)).status;
      } catch (e) {
        if (e instanceof GatewayError) throw new DomainError('UNAVAILABLE');
        throw e;
      }
      if (status !== 'MISSING') throw new DomainError('DENIED');
      const now = this.nowIso();
      const next: SectionDoc = { ...s, status: 'DELETED', deletedAt: now, updatedAt: now };
      const { audit, op } = this.chain(s, 'SECTION_DELETE', ctx.accountId, { orphan: true });
      next.auditHead = audit.hash;
      await this.store.transact([this.putSection(found.section, next), op]);
      return { deleted: true as const };
    });
  }

  async listPageSections(ctx: SiteContext): Promise<{ sections: PageSectionRow[] }> {
    if (!ctx.pageId) throw new DomainError('DENIED');
    const page = await this.authz.pageAccess(ctx.accountId, ctx.pageId);
    if (!page.canView) throw new DomainError('DENIED');
    let groupIds = new Set<string>();
    try {
      const membership = await this.gateway.groupMembership(ctx.accountId);
      if (membership.complete) groupIds = new Set(membership.groupIds);
    } catch (e) {
      if (!(e instanceof GatewayError)) throw e;
    }
    const bindings = await this.store.list<BindingDoc>({
      entity: 'binding',
      partition: `page:${ctx.pageId}`,
      order: 'ASC',
      limit: LIMITS.maxBindingsPerPage,
    });
    const now = this.clock.now().getTime();
    const sections: PageSectionRow[] = [];
    for (const b of bindings.items) {
      if (b.value.cloudId !== ctx.cloudId) continue;
      const sec = await this.store.get<SectionDoc>('section', Keys.section(b.value.sectionId));
      if (!sec || sec.value.status !== 'ACTIVE' || sec.value.cloudId !== ctx.cloudId) continue;
      sections.push({
        localId: b.value.localId,
        title: sec.value.title ?? null,
        classification: sec.value.classification ?? null,
        role: this.directRole(sec.value, ctx.accountId, groupIds, now),
      });
    }
    return { sections };
  }

  async getAdminOverview(ctx: SiteContext): Promise<AdminOverview> {
    await this.requireSiteAdmin(ctx.accountId);
    const listed = await this.store.list<SectionDoc>({
      entity: 'section',
      partition: 'all',
      order: 'ASC',
      limit: 200,
    });
    const noAdmin: AdminOverview['noAdmin'] = [];
    const orphans: AdminOverview['orphans'] = [];
    for (const item of listed.items) {
      const s = item.value;
      if (s.cloudId !== ctx.cloudId || s.status !== 'ACTIVE') continue;
      if (!(await this.hasActiveAdministrator(s))) {
        noAdmin.push({ sectionId: s.sectionId, title: s.title ?? null, pageId: s.primaryPageId });
      }
      try {
        const page = await this.gateway.pageSummary(s.primaryPageId);
        if (page.status === 'MISSING') {
          orphans.push({ sectionId: s.sectionId, title: s.title ?? null, pageId: s.primaryPageId });
        }
      } catch (e) {
        if (!(e instanceof GatewayError)) throw e;
      }
    }
    const sweep = await this.store.get<MetaDoc<string>>('meta', Keys.meta('retention-swept'));
    return {
      sectionCount: listed.items.filter((i) => i.value.status === 'ACTIVE').length,
      truncated: listed.nextCursor !== null,
      noAdmin,
      orphans,
      lastSweep: typeof sweep?.value.value === 'string' ? sweep.value.value : null,
      policy: await this.readSitePolicy(),
      retention: await this.getRetention(),
    };
  }

  async updateSitePolicy(
    ctx: SiteContext,
    policyRaw: unknown,
    retentionRaw: unknown,
  ): Promise<AdminOverview> {
    await this.requireSiteAdmin(ctx.accountId);
    const policy = parseSitePolicy(policyRaw);
    const retention = parseRetention(retentionRaw);
    await this.writeMeta('site-policy', policy);
    await this.writeMeta('retention', retention);
    return this.getAdminOverview(ctx);
  }

  async recoverUnowned(
    ctx: SiteContext,
    sectionId: unknown,
    newAdministratorAccountId: unknown,
    confirm: unknown,
  ): Promise<{ recovered: true }> {
    if (confirm !== 'RECOVER') throw new DomainError('INVALID_REQUEST');
    if (typeof sectionId !== 'string' || !UUID_RE.test(sectionId)) throw new DomainError('DENIED');
    const target = this.validatePrincipal('USER', newAdministratorAccountId);
    await this.requireSiteAdmin(ctx.accountId);
    await this.assertPrincipalExists('USER', target.id);
    return this.withRetry(async () => {
      const sec = await this.store.get<SectionDoc>('section', Keys.section(sectionId));
      if (!sec || sec.value.cloudId !== ctx.cloudId || sec.value.status !== 'ACTIVE') {
        throw new DomainError('NOT_RECOVERABLE');
      }
      const s = sec.value;
      if (await this.hasActiveAdministrator(s)) throw new DomainError('NOT_RECOVERABLE');
      const now = this.nowIso();
      const existing = s.grants.find(
        (g) => g.principalType === 'USER' && g.principalId === target.id,
      );
      const grants = existing
        ? s.grants.map((g) => (g === existing ? { ...g, role: 'ADMINISTER' as const } : g))
        : [
            ...s.grants,
            {
              principalType: 'USER' as const,
              principalId: target.id,
              role: 'ADMINISTER' as const,
              addedAt: now,
              addedBy: ctx.accountId,
            },
          ];
      const next: SectionDoc = {
        ...s,
        grants,
        ownerAccountId: target.id,
        aclVersion: s.aclVersion + 1,
        updatedAt: now,
      };
      const { audit, op } = this.chain(s, 'ADMIN_RECOVERY', ctx.accountId, {
        newAdministrator: target.id,
      });
      next.auditHead = audit.hash;
      await this.store.transact([this.putSection(sec, next), op]);
      return { recovered: true as const };
    });
  }

  private async writeMeta(name: string, value: unknown): Promise<void> {
    const cur = await this.store.get<MetaDoc>('meta', Keys.meta(name));
    const doc: MetaDoc = { schema: SCHEMA_VERSION, value, updatedAt: this.nowIso() };
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
}

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

export { validateDoc };

function parseCreateOptions(raw: unknown): {
  template: SectionTemplate;
  initialGrants: Array<{
    principalType: PrincipalType;
    principalId: string;
    role: Role;
  }>;
} {
  if (raw === undefined || raw === null) return { template: 'blank', initialGrants: [] };
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new DomainError('INVALID_REQUEST');
  const o = raw as Record<string, unknown>;
  const template = o.template === undefined || o.template === null ? 'blank' : o.template;
  if (!isSectionTemplate(template)) throw new DomainError('INVALID_REQUEST');
  const list = o.initialGrants === undefined ? [] : o.initialGrants;
  if (!Array.isArray(list) || list.length > 8) throw new DomainError('INVALID_REQUEST');
  const initialGrants = list.map((item) => {
    if (typeof item !== 'object' || item === null) throw new DomainError('INVALID_REQUEST');
    const g = item as Record<string, unknown>;
    if (!isPrincipalType(g.principalType) || !isRole(g.role) || typeof g.principalId !== 'string') {
      throw new DomainError('INVALID_REQUEST');
    }
    const re = g.principalType === 'USER' ? ACCOUNT_ID_RE : GROUP_ID_RE;
    if (!re.test(g.principalId)) throw new DomainError('INVALID_REQUEST');
    return { principalType: g.principalType, principalId: g.principalId, role: g.role };
  });
  return { template, initialGrants };
}

function parseSitePolicy(raw: unknown): SitePolicy {
  if (typeof raw !== 'object' || raw === null) throw new DomainError('INVALID_REQUEST');
  const o = raw as Record<string, unknown>;
  const days = o.maxGrantDays;
  if (
    typeof days !== 'number' ||
    !Number.isInteger(days) ||
    days < 1 ||
    days > MAX_GRANT_TTL_DAYS
  ) {
    throw new DomainError('INVALID_REQUEST');
  }
  if (o.whoMayCreate !== 'PAGE_EDITORS' && o.whoMayCreate !== 'SITE_ADMINS') {
    throw new DomainError('INVALID_REQUEST');
  }
  const classList: unknown = o.classes;
  if (!Array.isArray(classList)) throw new DomainError('INVALID_REQUEST');
  const classes = DEFAULT_SITE_POLICY.classes.map((fallback) => {
    const found = classList.find(
      (c: unknown) =>
        typeof c === 'object' && c !== null && (c as { id?: unknown }).id === fallback.id,
    ) as { watermark?: unknown; protectCopy?: unknown; autoLockMinutes?: unknown } | undefined;
    if (!found) throw new DomainError('INVALID_REQUEST');
    const minutes = found.autoLockMinutes;
    if (
      minutes !== null &&
      (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < 1 || minutes > 120)
    ) {
      throw new DomainError('INVALID_REQUEST');
    }
    if (typeof found.watermark !== 'boolean' || typeof found.protectCopy !== 'boolean') {
      throw new DomainError('INVALID_REQUEST');
    }
    return {
      id: fallback.id,
      watermark: found.watermark,
      protectCopy: found.protectCopy,
      autoLockMinutes: minutes,
    };
  });
  if (
    typeof o.allowRequests !== 'boolean' ||
    typeof o.requireChangeNote !== 'boolean' ||
    typeof o.lockByDefault !== 'boolean'
  ) {
    throw new DomainError('INVALID_REQUEST');
  }
  return {
    allowRequests: o.allowRequests,
    maxGrantDays: days,
    requireChangeNote: o.requireChangeNote,
    lockByDefault: o.lockByDefault,
    whoMayCreate: o.whoMayCreate,
    classes,
  };
}

function parseRetention(raw: unknown): RetentionConfig {
  if (typeof raw !== 'object' || raw === null) throw new DomainError('INVALID_REQUEST');
  const o = raw as Record<string, unknown>;
  const num = (key: keyof RetentionConfig, min: number, max: number): number => {
    const v = o[key];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
      throw new DomainError('INVALID_REQUEST');
    }
    return v;
  };
  return {
    revisionsKeep: num('revisionsKeep', 1, 500),
    revisionsMaxAgeDays: num('revisionsMaxAgeDays', 1, 3650),
    auditMaxAgeDays: num('auditMaxAgeDays', 1, 3650),
    deletedSectionGraceDays: num('deletedSectionGraceDays', 1, 365),
  };
}

function hasControlChars(t: string): boolean {
  for (let i = 0; i < t.length; i += 1) {
    const c = t.charCodeAt(i);
    if (c < 0x20 || c === 0x7f || c === 0x2028 || c === 0x2029) return true;
  }
  return false;
}

function parseTitle(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') throw new DomainError('INVALID_REQUEST');
  const t = v.trim();
  if (t === '') return null;
  if (t.length > TITLE_MAX_LENGTH || hasControlChars(t)) {
    throw new DomainError('INVALID_REQUEST');
  }
  return t;
}

function parseRevisionTag(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') throw new DomainError('INVALID_REQUEST');
  const t = v.trim();
  if (t === '') return null;
  if (t.length > REVISION_TAG_MAX_LENGTH || hasControlChars(t)) {
    throw new DomainError('INVALID_REQUEST');
  }
  return t;
}

function parseChangeNote(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') throw new DomainError('INVALID_REQUEST');
  const t = v.trim();
  if (t === '') return null;
  if (t.length > CHANGE_NOTE_MAX_LENGTH || hasControlChars(t)) {
    throw new DomainError('INVALID_REQUEST');
  }
  return t;
}

function parseReason(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') throw new DomainError('INVALID_REQUEST');
  const t = v.trim();
  if (t.length > REQUEST_REASON_MAX_LENGTH || hasControlChars(t)) {
    throw new DomainError('INVALID_REQUEST');
  }
  return t;
}

function parseExpiresAt(v: unknown, now: Date, maxDays = MAX_GRANT_TTL_DAYS): string | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string') throw new DomainError('INVALID_REQUEST');
  const t = Date.parse(v);
  if (!Number.isFinite(t) || v !== new Date(t).toISOString()) {
    throw new DomainError('INVALID_REQUEST');
  }
  const max = now.getTime() + maxDays * 86_400_000;
  if (t <= now.getTime() || t > max) throw new DomainError('INVALID_REQUEST');
  return v;
}

function parseClassification(v: unknown): Classification | null {
  if (v === undefined || v === null || v === '') return null;
  if (!isClassification(v)) throw new DomainError('INVALID_REQUEST');
  return v;
}

function parseVersion(v: unknown): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1)
    throw new DomainError('INVALID_REQUEST');
  return v;
}

function parseCursor(c: unknown): string | null {
  if (c === undefined || c === null || c === '') return null;
  if (typeof c !== 'string' || c.length > 200 || !/^[A-Za-z0-9:.#_=+/-]+$/.test(c)) {
    throw new DomainError('INVALID_REQUEST');
  }
  return c;
}
