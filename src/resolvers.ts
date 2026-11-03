import {
  RESOLVER_FUNCTIONS,
  type ErrorCode,
  type RequestOf,
  type ResolverFunction,
  type ResponseOf,
  type SectionView,
} from '@secure-sections/shared';
import { parseResolverContext, type TrustedContext } from './domain/context';
import { DomainError } from './domain/errors';
import { CorruptedContentError, type SecureSectionService } from './domain/service';
import { GatewayError } from './ports/confluence';
import type { Logger } from './ports/runtime';
import { StoreConflictError, StoreUnavailableError } from './ports/store';

export interface ResolverRequest {
  payload?: unknown;
  context?: unknown;
}

type Failure = {
  ok: false;
  code: ErrorCode;
  detail?: { currentVersion?: number; currentAclVersion?: number };
};

function toFailure(e: unknown, fn: string, logger: Logger): Failure {
  if (e instanceof DomainError) {
    return e.detail ? { ok: false, code: e.code, detail: e.detail } : { ok: false, code: e.code };
  }
  if (e instanceof StoreConflictError) return { ok: false, code: 'CONFLICT' };
  // Log the failure class only: messages may embed identifiers and must never embed content.
  logger.error('resolver.failure', {
    fn,
    kind: e instanceof Error ? e.name : 'unknown',
    ...(e instanceof GatewayError && e.status ? { status: e.status } : {}),
  });
  if (e instanceof StoreUnavailableError || e instanceof GatewayError) {
    return { ok: false, code: 'UNAVAILABLE' };
  }
  return { ok: false, code: 'UNAVAILABLE' };
}

function payloadOf(req: ResolverRequest): Record<string, unknown> {
  const p = req.payload;
  return typeof p === 'object' && p !== null && !Array.isArray(p)
    ? (p as Record<string, unknown>)
    : {};
}

type Handler<K extends ResolverFunction> = (req: ResolverRequest) => Promise<ResponseOf<K>>;
export type Handlers = { [K in ResolverFunction]: Handler<K> };

/**
 * Wires the typed resolver contract to the domain service.
 * Identity ALWAYS comes from `req.context` (platform-signed). `req.payload` carries only operation
 * parameters and is treated as hostile.
 */
export function createHandlers(service: SecureSectionService, logger: Logger): Handlers {
  const guarded =
    <K extends Exclude<ResolverFunction, 'getSection'>>(
      fn: K,
      run: (ctx: TrustedContext, p: Record<string, unknown>) => Promise<unknown>,
    ): Handler<K> =>
    async (req) => {
      const ctx = parseResolverContext(req.context);
      if (!ctx) return { ok: false, code: 'UNAVAILABLE' } as ResponseOf<K>;
      try {
        return { ok: true, data: await run(ctx, payloadOf(req)) } as ResponseOf<K>;
      } catch (e) {
        return toFailure(e, fn, logger) as ResponseOf<K>;
      }
    };

  const handlers: Handlers = {
    async getSection(req): Promise<SectionView> {
      const ctx = parseResolverContext(req.context);
      if (!ctx) return { state: 'UNAVAILABLE' };
      try {
        return await service.getSection(ctx);
      } catch (e) {
        if (e instanceof CorruptedContentError) return { state: 'CORRUPTED' };
        const f = toFailure(e, 'getSection', logger);
        return f.code === 'DENIED' ? { state: 'DENIED' } : { state: 'UNAVAILABLE' };
      }
    },
    createSection: guarded('createSection', (ctx, p) =>
      service.createSection(ctx, p.title, p.classification),
    ),
    saveContent: guarded('saveContent', (ctx, p) =>
      service.saveContent(ctx, p.doc, p.baseVersion, p.changeNote),
    ),
    listRevisions: guarded('listRevisions', (ctx, p) => service.listRevisions(ctx, p.cursor)),
    getRevision: guarded('getRevision', (ctx, p) => service.getRevision(ctx, p.version)),
    restoreRevision: guarded('restoreRevision', (ctx, p) =>
      service.restoreRevision(ctx, p.version, p.baseVersion),
    ),
    getEffectiveAccess: guarded('getEffectiveAccess', (ctx) => service.getEffectiveAccess(ctx)),
    listGrants: guarded('listGrants', (ctx) => service.listGrants(ctx)),
    searchPrincipals: guarded('searchPrincipals', (ctx, p) =>
      service.searchPrincipals(ctx, p.query, p.type),
    ),
    upsertGrant: guarded('upsertGrant', (ctx, p) =>
      service.upsertGrant(ctx, {
        principalType: p.principalType,
        principalId: p.principalId,
        role: p.role,
        expectedAclVersion: p.expectedAclVersion,
        expiresAt: p.expiresAt,
      }),
    ),
    revokeGrant: guarded('revokeGrant', (ctx, p) =>
      service.revokeGrant(ctx, {
        principalType: p.principalType,
        principalId: p.principalId,
        expectedAclVersion: p.expectedAclVersion,
      }),
    ),
    setOwner: guarded('setOwner', (ctx, p) =>
      service.setOwner(ctx, { accountId: p.accountId, expectedAclVersion: p.expectedAclVersion }),
    ),
    listAudit: guarded('listAudit', (ctx, p) => service.listAudit(ctx, p.cursor)),
    getShareReference: guarded('getShareReference', (ctx) => service.getShareReference(ctx)),
    bindHere: guarded('bindHere', (ctx, p) => service.bindHere(ctx, p.sectionRef)),
    copyHere: guarded('copyHere', (ctx, p) => service.copyHere(ctx, p.sourceRef)),
    deleteSection: guarded('deleteSection', (ctx, p) => service.deleteSection(ctx, p.confirm)),
    getDiagnostics: guarded('getDiagnostics', (ctx) => service.getDiagnostics(ctx)),
    getAccessInfo: guarded('getAccessInfo', (ctx) => service.getAccessInfo(ctx)),
    requestAccess: guarded('requestAccess', (ctx, p) =>
      service.requestAccess(ctx, { role: p.role, reason: p.reason }),
    ),
    cancelAccessRequest: guarded('cancelAccessRequest', (ctx) => service.cancelAccessRequest(ctx)),
    listAccessRequests: guarded('listAccessRequests', (ctx) => service.listAccessRequests(ctx)),
    resolveAccessRequest: guarded('resolveAccessRequest', (ctx, p) =>
      service.resolveAccessRequest(ctx, {
        accountId: p.accountId,
        decision: p.decision,
        role: p.role,
        expectedAclVersion: p.expectedAclVersion,
      }),
    ),
    updateMetadata: guarded('updateMetadata', (ctx, p) =>
      service.updateMetadata(ctx, { title: p.title, classification: p.classification }),
    ),
    copyGrants: guarded('copyGrants', (ctx, p) =>
      service.copyGrants(ctx, p.sourceRef, p.expectedAclVersion),
    ),
    seedPageRestrictions: guarded('seedPageRestrictions', (ctx, p) =>
      service.seedPageRestrictions(ctx, p.expectedAclVersion),
    ),
    dismissNotice: guarded('dismissNotice', (ctx) => service.dismissNotice(ctx)),
    setRevisionTag: guarded('setRevisionTag', (ctx, p) =>
      service.setRevisionTag(ctx, p.version, p.tag),
    ),
    recoverSection: guarded('recoverSection', (ctx, p) =>
      service.recoverSection(ctx, {
        newAdministratorAccountId: p.newAdministratorAccountId,
        confirm: p.confirm,
      }),
    ),
  };
  return handlers;
}

export type { RequestOf };
export { RESOLVER_FUNCTIONS };
