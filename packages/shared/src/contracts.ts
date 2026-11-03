import type { RichDoc } from './editor-schema.js';
import type { PrincipalType, Role } from './roles.js';

/**
 * Typed resolver contract shared by the Custom UI and the Forge resolver.
 * Nothing in a request identifies the user, tenant, page, macro or section: all of that is
 * derived server-side from the Forge resolver context. Only `sectionRef` in bindHere/copyHere
 * is client supplied, and it is never an authority on its own (an ACL check always follows).
 */

export const RESOLVER_FUNCTIONS = [
  'getSection',
  'createSection',
  'saveContent',
  'listRevisions',
  'getRevision',
  'restoreRevision',
  'getEffectiveAccess',
  'listGrants',
  'searchPrincipals',
  'upsertGrant',
  'revokeGrant',
  'setOwner',
  'listAudit',
  'getShareReference',
  'bindHere',
  'copyHere',
  'deleteSection',
  'getDiagnostics',
  'recoverSection',
  'updateMetadata',
] as const;
export type ResolverFunction = (typeof RESOLVER_FUNCTIONS)[number];

export type ErrorCode =
  | 'DENIED'
  | 'INVALID_REQUEST'
  | 'INVALID_CONTENT'
  | 'CONFLICT'
  | 'NOT_FOUND'
  | 'LAST_ADMINISTRATOR'
  | 'UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'PAGE_EDIT_REQUIRED'
  | 'NOT_RECOVERABLE';

export type Result<T> =
  { ok: true; data: T } | { ok: false; code: ErrorCode; detail?: ErrorDetail };

/** Never contains protected content or information about other users' access. */
export interface ErrorDetail {
  currentVersion?: number;
  currentAclVersion?: number;
}

export interface ContentPayload {
  doc: RichDoc;
  version: number;
  updatedAt: string;
  updatedBy: UserSummary | null;
}

export interface UserSummary {
  accountId: string;
  displayName: string;
}

export interface PageCapabilities {
  canEditPage: boolean;
}

export const CLASSIFICATIONS = ['INTERNAL', 'CONFIDENTIAL', 'RESTRICTED'] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];

export function isClassification(value: unknown): value is Classification {
  return typeof value === 'string' && (CLASSIFICATIONS as readonly string[]).includes(value);
}

export const TITLE_MAX_LENGTH = 80;

/**
 * Descriptive metadata of a section. The title and classification are deliberately NOT secret:
 * they are visible to everyone who can view the page (see docs/SECURITY.md). Never put
 * confidential text in them.
 */
export interface SectionMeta {
  title: string | null;
  classification: Classification | null;
  sharedWith: { users: number; groups: number };
}

export type SectionView =
  | { state: 'UNCONFIGURED'; canCreate: boolean }
  | { state: 'DENIED' }
  | { state: 'UNAVAILABLE' }
  | { state: 'CORRUPTED' }
  | {
      state: 'READY';
      role: Role;
      canWrite: boolean;
      canEditPage: boolean;
      content: ContentPayload;
      aclVersion: number;
      meta: SectionMeta;
    };

export interface EffectiveAccess {
  role: Role | null;
  canEditPage: boolean;
  sources: Array<{ via: 'USER' | 'GROUP'; principalId: string; label: string; role: Role }>;
  groupResolution: 'OK' | 'DEGRADED';
}

export interface Grant {
  principalType: PrincipalType;
  principalId: string;
  label: string;
  role: Role;
  addedAt: string;
  addedBy: string;
  active: boolean;
}

export interface GrantList {
  grants: Grant[];
  aclVersion: number;
  ownerAccountId: string;
}

export interface PrincipalHit {
  principalType: PrincipalType;
  principalId: string;
  label: string;
}

export interface RevisionSummary {
  version: number;
  createdAt: string;
  author: UserSummary | null;
  restoredFrom: number | null;
  bytes: number;
}

export interface RevisionList {
  revisions: RevisionSummary[];
  nextCursor: string | null;
}

export type AuditAction =
  | 'SECTION_CREATE'
  | 'CONTENT_EDIT'
  | 'CONTENT_RESTORE'
  | 'GRANT_ADD'
  | 'GRANT_UPDATE'
  | 'GRANT_REVOKE'
  | 'OWNER_CHANGE'
  | 'BINDING_ADD'
  | 'SECTION_COPY'
  | 'SECTION_DELETE'
  | 'ADMIN_RECOVERY'
  | 'METADATA_UPDATE'
  | 'ACCESS_DENIED'
  | 'RETENTION_PURGE';

export interface AuditEntry {
  id: string;
  at: string;
  action: AuditAction;
  actor: string;
  meta: Record<string, string | number | boolean | null>;
}

export interface AuditList {
  entries: AuditEntry[];
  nextCursor: string | null;
  chain: 'OK' | 'BROKEN' | 'PARTIAL';
}

export interface Diagnostics {
  schemaVersion: number;
  sectionCount: number | null;
  healthy: boolean;
  checks: Array<{ name: string; status: 'OK' | 'WARN' | 'FAIL'; message: string }>;
  retention: RetentionConfig;
}

export interface RetentionConfig {
  revisionsKeep: number;
  revisionsMaxAgeDays: number;
  auditMaxAgeDays: number;
  deletedSectionGraceDays: number;
}

export interface RequestMap {
  getSection: { req: Record<string, never>; res: SectionView };
  createSection: {
    req: { title?: string | null; classification?: Classification | null };
    res: Result<SectionView>;
  };
  saveContent: {
    req: { doc: unknown; baseVersion: number };
    res: Result<{ content: ContentPayload }>;
  };
  listRevisions: { req: { cursor?: string | null }; res: Result<RevisionList> };
  getRevision: {
    req: { version: number };
    res: Result<{ doc: RichDoc; summary: RevisionSummary }>;
  };
  restoreRevision: {
    req: { version: number; baseVersion: number };
    res: Result<{ content: ContentPayload }>;
  };
  getEffectiveAccess: { req: Record<string, never>; res: Result<EffectiveAccess> };
  listGrants: { req: Record<string, never>; res: Result<GrantList> };
  searchPrincipals: {
    req: { query: string; type: PrincipalType };
    res: Result<{ hits: PrincipalHit[] }>;
  };
  upsertGrant: {
    req: {
      principalType: PrincipalType;
      principalId: string;
      role: Role;
      expectedAclVersion: number;
    };
    res: Result<GrantList>;
  };
  revokeGrant: {
    req: { principalType: PrincipalType; principalId: string; expectedAclVersion: number };
    res: Result<GrantList>;
  };
  setOwner: {
    req: { accountId: string; expectedAclVersion: number };
    res: Result<GrantList>;
  };
  listAudit: { req: { cursor?: string | null }; res: Result<AuditList> };
  getShareReference: { req: Record<string, never>; res: Result<{ sectionRef: string }> };
  bindHere: { req: { sectionRef: string }; res: Result<SectionView> };
  copyHere: { req: { sourceRef: string }; res: Result<SectionView> };
  deleteSection: { req: { confirm: 'DELETE' }; res: Result<{ deleted: true }> };
  getDiagnostics: { req: Record<string, never>; res: Result<Diagnostics> };
  recoverSection: {
    req: { newAdministratorAccountId: string; confirm: string };
    res: Result<{ recovered: true }>;
  };
  updateMetadata: {
    req: { title: string | null; classification: Classification | null };
    res: Result<SectionMeta>;
  };
}

export type RequestOf<K extends ResolverFunction> = RequestMap[K]['req'];
export type ResponseOf<K extends ResolverFunction> = RequestMap[K]['res'];
