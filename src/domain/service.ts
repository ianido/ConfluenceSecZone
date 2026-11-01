import {
  EMPTY_DOC,
  roleAtLeast,
  safeValidateDoc,
  validateDoc,
  type AuditEntry,
  type AuditList,
  type ContentPayload,
  type Diagnostics,
  type EffectiveAccess,
  type Grant,
  type GrantList,
  type PrincipalHit,
  type PrincipalType,
  type RetentionConfig,
  type RevisionList,
  type RevisionSummary,
  type Role,
  type RichDoc,
  type SectionView,
  type UserSummary,
  type AuditAction,
  isPrincipalType,
  isRole,
} from '@secure-sections/shared';
import { GatewayError, type ConfluenceGateway } from '../ports/confluence.js';
import type { Clock, IdGenerator, Logger } from '../ports/runtime.js';
import {
  StoreConflictError,
  StoreUnavailableError,
  type Doc,
  type Store,
  type TxOp,
} from '../ports/store.js';
import { buildChainedAudit, buildUnchainedAudit, sha256, verifyChain } from './audit.js';
import { AuthorizationService, type BoundResolved, type Resolved } from './authz.js';
import type { TrustedContext } from './context.js';
import { DomainError } from './errors.js';
import {
  ACCOUNT_ID_RE,
  DEFAULT_RETENTION,
  GROUP_ID_RE,
  GENESIS_HASH,
  Idx,
  Keys,
  LIMITS,
  SCHEMA_VERSION,
  UUID_RE,
  type AuditDoc,
  type AuditMeta,
  type BindingDoc,
  type MetaDoc,
  type RevisionDoc,
  type SectionDoc,
} from './model.js';

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
    this.authz = new AuthorizationService(deps.store, deps.gateway);
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
    return r;
  }

  private viewOf(r: BoundResolved, content: ContentPayload): SectionView {
    const role = r.role.role as Role;
    return {
      state: 'READY',
      role,
      canWrite: roleAtLeast(role, 'MODIFY') && r.page.canEdit,
      canEditPage: r.page.canEdit,
      content,
      aclVersion: r.section.value.aclVersion,
    };
  }

  private async viewFor(r: Resolved): Promise<SectionView> {
    if (r.kind === 'NO_ACCESS') return { state: 'DENIED' };
    if (r.kind === 'UNBOUND') return { state: 'UNCONFIGURED', canCreate: r.page.canEdit };
    if (r.role.role === null) {
      return r.role.groupsComplete ? { state: 'DENIED' } : { state: 'UNAVAILABLE' };
    }
    try {
      return this.viewOf(r, await this.readHead(r.section.value));
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
    return this.viewFor(await this.authz.resolve(ctx));
  }

  async createSection(ctx: TrustedContext): Promise<SectionView> {
    return this.withRetry(async () => {
      const r = await this.authz.resolve(ctx);
      if (r.kind === 'NO_ACCESS') throw new DomainError('DENIED');
      if (r.kind === 'BOUND') return this.viewFor(r); // idempotent: already created
      if (!r.page.canEdit) throw new DomainError('PAGE_EDIT_REQUIRED');
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
      const { audit, op: auditOp } = this.chain(section, 'SECTION_CREATE', ctx.accountId, {
        pageId: ctx.pageId,
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
        this.revisionOp(this.buildRevision(sectionId, 1, EMPTY_DOC, ctx.accountId, null)),
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
  ): Promise<{ content: ContentPayload }> {
    if (typeof baseVersion !== 'number' || !Number.isInteger(baseVersion) || baseVersion < 1) {
      throw new DomainError('INVALID_REQUEST');
    }
    const v = safeValidateDoc(rawDoc);
    if (!v.ok) throw new DomainError('INVALID_CONTENT');
    return this.writeVersion(ctx, v.doc, baseVersion, null, 'CONTENT_EDIT');
  }

  private async writeVersion(
    ctx: TrustedContext,
    doc: RichDoc,
    baseVersion: number,
    restoredFrom: number | null,
    action: 'CONTENT_EDIT' | 'CONTENT_RESTORE',
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
      const rev = this.buildRevision(s.sectionId, version, doc, ctx.accountId, restoredFrom);
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
      if (g.principalType === 'USER') {
        const u = users.get(g.principalId);
        return { ...g, label: u?.displayName ?? g.principalId, active: u ? u.active : true };
      }
      const gr = groups.get(g.principalId);
      return { ...g, label: gr?.name ?? g.principalId, active: gr ? gr.exists : true };
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
    await this.requireBound(ctx, 'ADMINISTER', { op: 'acl-search', auditDenied: true });
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

  private hasDirectAdmin(grants: SectionDoc['grants']): boolean {
    return grants.some((g) => g.principalType === 'USER' && g.role === 'ADMINISTER');
  }

  async upsertGrant(
    ctx: TrustedContext,
    input: {
      principalType: unknown;
      principalId: unknown;
      role: unknown;
      expectedAclVersion: unknown;
    },
  ): Promise<GrantList> {
    const p = this.validatePrincipal(input.principalType, input.principalId);
    if (!isRole(input.role)) throw new DomainError('INVALID_REQUEST');
    const role = input.role;
    const expected = parseVersion(input.expectedAclVersion);
    await this.assertPrincipalExists(p.type, p.id);
    return this.withRetry(async () => {
      const r = await this.requireBound(ctx, 'ADMINISTER', { op: 'acl-write', auditDenied: true });
      const s = r.section.value;
      if (s.aclVersion !== expected)
        throw new DomainError('CONFLICT', { currentAclVersion: s.aclVersion });
      const existing = s.grants.find((g) => g.principalType === p.type && g.principalId === p.id);
      if (existing?.role === role) return this.grantList(s);
      if (!existing && s.grants.length >= LIMITS.maxGrants) throw new DomainError('RATE_LIMITED');
      const now = this.nowIso();
      const grants = existing
        ? s.grants.map((g) => (g === existing ? { ...g, role } : g))
        : [
            ...s.grants,
            {
              principalType: p.type,
              principalId: p.id,
              role,
              addedAt: now,
              addedBy: ctx.accountId,
            },
          ];
      if (!this.hasDirectAdmin(grants)) throw new DomainError('LAST_ADMINISTRATOR');
      const next: SectionDoc = { ...s, grants, aclVersion: s.aclVersion + 1, updatedAt: now };
      const { audit, op } = this.chain(s, existing ? 'GRANT_UPDATE' : 'GRANT_ADD', ctx.accountId, {
        principalType: p.type,
        principalId: p.id,
        role,
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
    await this.requireSiteAdmin(ctx);
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

  private async requireSiteAdmin(ctx: TrustedContext): Promise<void> {
    try {
      if (!(await this.gateway.isSiteAdmin(ctx.accountId))) throw new DomainError('DENIED');
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
    await this.requireSiteAdmin(ctx);
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
}

export { validateDoc };

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
