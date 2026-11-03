import type {
  AuditAction,
  Classification,
  PrincipalType,
  RetentionConfig,
  Role,
} from '@secure-sections/shared';
import type { DocKeyIndex } from '../ports/store';

export const SCHEMA_VERSION = 1;
export const GENESIS_HASH = '0'.repeat(64);

export const LIMITS = {
  maxGrants: 500,
  maxBindingsPerSection: 20,
  maxBindingsPerPage: 100,
  auditPageSize: 50,
  revisionPageSize: 25,
  principalSearchLimit: 20,
  maxGroupPages: 10,
  maxPendingRequests: 50,
  maxAdminNamesShown: 5,
} as const;

export const REQUEST_TTL_DAYS = 30;

export const DEFAULT_RETENTION: RetentionConfig = {
  revisionsKeep: 50,
  revisionsMaxAgeDays: 365,
  auditMaxAgeDays: 730,
  deletedSectionGraceDays: 30,
};

export interface GrantRec {
  principalType: PrincipalType;
  principalId: string;
  role: Role;
  addedAt: string;
  addedBy: string;
  /** Absent or null: never expires. ISO timestamp otherwise. */
  expiresAt?: string | null;
  lastAccessAt?: string | null;
}

export interface AccessRequestRec {
  accountId: string;
  role: 'VIEW' | 'MODIFY';
  reason: string;
  requestedAt: string;
}

export interface BindingRef {
  pageId: string;
  localId: string;
}

export interface SectionDoc {
  schema: number;
  sectionId: string;
  cloudId: string;
  status: 'ACTIVE' | 'DELETED';
  ownerAccountId: string;
  primaryPageId: string;
  spaceKey: string | null;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  deletedAt: string | null;
  headVersion: number;
  aclVersion: number;
  grants: GrantRec[];
  bindings: BindingRef[];
  auditHead: string;
  /** Optional descriptive metadata; absent on sections created before it existed. */
  title?: string | null;
  classification?: Classification | null;
  /** Pending access requests, bounded by LIMITS.maxPendingRequests and REQUEST_TTL_DAYS. */
  requests?: AccessRequestRec[];
}

export interface BindingDoc {
  schema: number;
  cloudId: string;
  pageId: string;
  localId: string;
  sectionId: string;
  kind: 'CREATE' | 'REBIND' | 'COPY';
  createdAt: string;
  createdBy: string;
}

export interface RevisionDoc {
  schema: number;
  sectionId: string;
  version: number;
  bodyJson: string;
  sha256: string;
  bytes: number;
  authorAccountId: string;
  createdAt: string;
  restoredFrom: number | null;
}

export type AuditMeta = Record<string, string | number | boolean | null>;

export interface AuditDoc {
  schema: number;
  sectionId: string;
  id: string;
  at: string;
  action: AuditAction;
  actor: string;
  meta: AuditMeta;
  chained: boolean;
  prev: string;
  hash: string;
  erased?: boolean;
}

export interface MetaDoc<T = unknown> {
  schema: number;
  value: T;
  updatedAt: string;
}

export const pad = (n: number): string => String(n).padStart(10, '0');

export const Keys = {
  section: (id: string): string => id,
  binding: (pageId: string, localId: string): string => `${pageId}:${localId}`,
  revision: (sectionId: string, version: number): string => `${sectionId}:${pad(version)}`,
  audit: (sectionId: string, id: string): string => `${sectionId}:${id}`,
  deniedAudit: (sectionId: string, accountId: string, day: string): string =>
    `${sectionId}:denied-${day}-${accountId}`,
  meta: (name: string): string => name,
};

export const Idx = {
  section: (id: string): DocKeyIndex => ({ partition: 'all', range: id }),
  binding: (pageId: string, localId: string): DocKeyIndex => ({
    partition: `page:${pageId}`,
    range: localId,
  }),
  revision: (sectionId: string, version: number): DocKeyIndex => ({
    partition: sectionId,
    range: pad(version),
  }),
  audit: (sectionId: string, id: string): DocKeyIndex => ({ partition: sectionId, range: id }),
  meta: (name: string): DocKeyIndex => ({ partition: 'meta', range: name }),
};

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const ACCOUNT_ID_RE = /^[A-Za-z0-9:_-]{1,128}$/;
export const GROUP_ID_RE = /^[A-Za-z0-9:_-]{1,128}$/;
export const PAGE_ID_RE = /^\d{1,20}$/;
export const LOCAL_ID_RE = /^[A-Za-z0-9-]{8,64}$/;
