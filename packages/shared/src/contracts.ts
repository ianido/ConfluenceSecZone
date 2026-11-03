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
  'getAccessInfo',
  'requestAccess',
  'cancelAccessRequest',
  'listAccessRequests',
  'resolveAccessRequest',
  'copyGrants',
  'seedPageRestrictions',
  'dismissNotice',
  'setRevisionTag',
  'revealSecret',
  'listMySections',
  'exportMyAudit',
  'deleteOrphan',
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

export const REQUESTABLE_ROLES = ['VIEW', 'MODIFY'] as const;
export type RequestableRole = (typeof REQUESTABLE_ROLES)[number];

export function isRequestableRole(value: unknown): value is RequestableRole {
  return typeof value === 'string' && (REQUESTABLE_ROLES as readonly string[]).includes(value);
}

export const REQUEST_REASON_MAX_LENGTH = 280;

export interface MyAccessRequest {
  role: RequestableRole;
  reason: string;
  requestedAt: string;
}

/**
 * What a page viewer WITHOUT access may learn about a section: the public title and
 * classification, up to a few administrator names (so they know whom to ask) and their own
 * pending request. Never content, grants, or counts.
 */
export interface AccessInfo {
  title: string | null;
  classification: Classification | null;
  administrators: UserSummary[];
  myRequest: MyAccessRequest | null;
}

export interface AccessRequestItem {
  accountId: string;
  displayName: string;
  active: boolean;
  role: RequestableRole;
  reason: string;
  requestedAt: string;
}

export interface AccessRequestList {
  requests: AccessRequestItem[];
  aclVersion: number;
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
      /** In-app note that this caller was granted access. Null when there is nothing to show. */
      notice: GrantNotice | null;
      protection: ProtectionFlags;
    };

export interface GrantNotice {
  role: Role;
  addedByName: string;
  at: string;
}

export interface EffectiveAccess {
  role: Role | null;
  canEditPage: boolean;
  sources: Array<{ via: 'USER' | 'GROUP'; principalId: string; label: string; role: Role }>;
  groupResolution: 'OK' | 'DEGRADED';
}

export const GRANT_EXPIRY_PRESETS_DAYS = [7, 30, 90] as const;
export const MAX_GRANT_TTL_DAYS = 365;

export interface Grant {
  principalType: PrincipalType;
  principalId: string;
  label: string;
  role: Role;
  addedAt: string;
  addedBy: string;
  active: boolean;
  /** ISO timestamp; null means the grant does not expire. */
  expiresAt: string | null;
  lastAccessAt: string | null;
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

export const CHANGE_NOTE_MAX_LENGTH = 140;
export const REVISION_TAG_MAX_LENGTH = 40;

export interface RevisionSummary {
  version: number;
  createdAt: string;
  author: UserSummary | null;
  restoredFrom: number | null;
  bytes: number;
  changeNote: string | null;
  tag: string | null;
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
  | 'ACCESS_REQUEST'
  | 'ACCESS_REQUEST_CANCEL'
  | 'ACCESS_REQUEST_APPROVE'
  | 'ACCESS_REQUEST_REJECT'
  | 'REVISION_TAG'
  | 'SECRET_REVEAL'
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

export interface ClassPolicy {
  id: Classification;
  watermark: boolean;
  /** Minutes of inactivity before the reader must reload. Null disables auto-lock. */
  autoLockMinutes: number | null;
  protectCopy: boolean;
}

export type WhoMayCreate = 'PAGE_EDITORS' | 'SITE_ADMINS';

/**
 * Site-wide knobs. Reader protection derived from this is deterrence only:
 * a watermark and a hidden selection do not stop a determined reader.
 */
export interface SitePolicy {
  allowRequests: boolean;
  maxGrantDays: number;
  requireChangeNote: boolean;
  whoMayCreate: WhoMayCreate;
  classes: ClassPolicy[];
}

export type PageStatus = 'OK' | 'MISSING' | 'UNKNOWN';

export interface MySectionRow {
  sectionId: string;
  title: string | null;
  classification: Classification | null;
  pageId: string;
  spaceKey: string | null;
  pageStatus: PageStatus;
  role: Role;
  sharedUsers: number;
  updatedAt: string;
}

export interface MySections {
  rows: MySectionRow[];
  truncated: boolean;
  kpis: {
    administered: number;
    pendingRequests: number;
    expiringGrants: number;
    inactive: number;
  };
  /** Recent audit metadata only. Never content, reasons or document text. */
  activity: Array<{ at: string; action: string; actor: string; title: string | null }>;
}

export interface AuditExport {
  csv: string;
  rows: number;
  truncated: boolean;
}

export interface ProtectionFlags {
  watermark: boolean;
  autoLockMinutes: number | null;
  protectCopy: boolean;
  viewerName: string;
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
    req: { doc: unknown; baseVersion: number; changeNote?: string | null };
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
      expiresAt?: string | null;
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
  getAccessInfo: { req: Record<string, never>; res: Result<AccessInfo> };
  requestAccess: {
    req: { role: RequestableRole; reason?: string };
    res: Result<AccessInfo>;
  };
  cancelAccessRequest: { req: Record<string, never>; res: Result<AccessInfo> };
  listAccessRequests: { req: Record<string, never>; res: Result<AccessRequestList> };
  resolveAccessRequest: {
    req: {
      accountId: string;
      decision: 'APPROVE' | 'REJECT';
      role?: RequestableRole;
      expectedAclVersion: number;
    };
    res: Result<AccessRequestList>;
  };
  updateMetadata: {
    req: { title: string | null; classification: Classification | null };
    res: Result<SectionMeta>;
  };
  copyGrants: {
    req: { sourceRef: string; expectedAclVersion: number };
    res: Result<GrantList>;
  };
  seedPageRestrictions: {
    req: { expectedAclVersion: number };
    res: Result<GrantList>;
  };
  dismissNotice: { req: Record<string, never>; res: Result<{ dismissed: true }> };
  setRevisionTag: {
    req: { version: number; tag: string | null };
    res: Result<RevisionSummary>;
  };
  revealSecret: {
    req: { label?: string | null };
    res: Result<{ recorded: true }>;
  };
  listMySections: { req: Record<string, never>; res: Result<MySections> };
  exportMyAudit: { req: Record<string, never>; res: Result<AuditExport> };
  deleteOrphan: {
    req: { sectionId: string; confirm: 'DELETE' };
    res: Result<{ deleted: true }>;
  };
}

export type RequestOf<K extends ResolverFunction> = RequestMap[K]['req'];
export type ResponseOf<K extends ResolverFunction> = RequestMap[K]['res'];
