import { maxRole, type Role } from '@secure-sections/shared';
import { GatewayError, type ConfluenceGateway, type PagePermissions } from '../ports/confluence.js';
import type { Doc, Store } from '../ports/store.js';
import type { TrustedContext } from './context.js';
import { DomainError } from './errors.js';
import { Keys, type BindingDoc, type SectionDoc } from './model.js';

export interface RoleResolution {
  role: Role | null;
  groupsComplete: boolean;
  sources: Array<{ via: 'USER' | 'GROUP'; principalId: string; role: Role }>;
}

export type Resolved =
  | { kind: 'NO_ACCESS' }
  | { kind: 'UNBOUND'; page: PagePermissions; staleBinding: Doc<BindingDoc> | null }
  | {
      kind: 'BOUND';
      page: PagePermissions;
      section: Doc<SectionDoc>;
      binding: Doc<BindingDoc>;
      role: RoleResolution;
    };

export type BoundResolved = Extract<Resolved, { kind: 'BOUND' }>;

/**
 * Centralised server-side authorization. Every resolver operation goes through here.
 * Inputs: a TrustedContext (from Forge resolver context only). Nothing client-supplied is ever
 * used to pick the section: the binding key is derived from (pageId, localId) in the context.
 */
export class AuthorizationService {
  constructor(
    private readonly store: Store,
    private readonly gateway: ConfluenceGateway,
  ) {}

  /** Page rights as the invoking user. Throws DomainError('UNAVAILABLE') when Confluence cannot answer. */
  async pageAccess(accountId: string, pageId: string): Promise<PagePermissions> {
    try {
      const p = await this.gateway.pagePermissions(accountId, pageId);
      return { canView: p.canView, canEdit: p.canView && p.canEdit };
    } catch (e) {
      if (e instanceof GatewayError) throw new DomainError('UNAVAILABLE');
      throw e;
    }
  }

  async roleOnSection(section: SectionDoc, accountId: string): Promise<RoleResolution> {
    const roles: Role[] = [];
    const sources: RoleResolution['sources'] = [];
    for (const g of section.grants) {
      if (g.principalType === 'USER' && g.principalId === accountId) {
        roles.push(g.role);
        sources.push({ via: 'USER', principalId: g.principalId, role: g.role });
      }
    }
    let groupsComplete = true;
    const groupGrants = section.grants.filter((g) => g.principalType === 'GROUP');
    if (groupGrants.length > 0) {
      try {
        const m = await this.gateway.groupMembership(accountId);
        groupsComplete = m.complete;
        const member = new Set(m.groupIds);
        for (const g of groupGrants) {
          if (member.has(g.principalId)) {
            roles.push(g.role);
            sources.push({ via: 'GROUP', principalId: g.principalId, role: g.role });
          }
        }
      } catch (e) {
        if (!(e instanceof GatewayError)) throw e;
        groupsComplete = false;
      }
    }
    return { role: maxRole(roles), groupsComplete, sources };
  }

  async resolve(ctx: TrustedContext): Promise<Resolved> {
    const page = await this.pageAccess(ctx.accountId, ctx.pageId);
    if (!page.canView) return { kind: 'NO_ACCESS' };

    const binding = await this.store.get<BindingDoc>(
      'binding',
      Keys.binding(ctx.pageId, ctx.localId),
    );
    if (!binding) return { kind: 'UNBOUND', page, staleBinding: null };
    const b = binding.value;
    if (b.cloudId !== ctx.cloudId || b.pageId !== ctx.pageId || b.localId !== ctx.localId) {
      return { kind: 'NO_ACCESS' };
    }
    const section = await this.store.get<SectionDoc>('section', Keys.section(b.sectionId));
    if (!section || section.value.status !== 'ACTIVE') {
      return { kind: 'UNBOUND', page, staleBinding: binding };
    }
    if (section.value.cloudId !== ctx.cloudId || section.value.sectionId !== b.sectionId) {
      return { kind: 'NO_ACCESS' };
    }
    const role = await this.roleOnSection(section.value, ctx.accountId);
    return { kind: 'BOUND', page, section, binding, role };
  }

  /** Load a section by (client-supplied) reference and compute the caller's role. Never grants anything by itself. */
  async resolveByRef(
    ctx: TrustedContext,
    sectionId: string,
  ): Promise<{ section: Doc<SectionDoc>; role: RoleResolution } | null> {
    const section = await this.store.get<SectionDoc>('section', Keys.section(sectionId));
    if (!section || section.value.status !== 'ACTIVE') return null;
    if (section.value.cloudId !== ctx.cloudId) return null;
    const role = await this.roleOnSection(section.value, ctx.accountId);
    return { section, role };
  }
}
