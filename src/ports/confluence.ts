import type { PrincipalHit, PrincipalType } from '@secure-sections/shared';

export class GatewayError extends Error {
  readonly status: number | undefined;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'GatewayError';
    this.status = status;
  }
}

export interface PagePermissions {
  canView: boolean;
  canEdit: boolean;
}

export interface UserInfo {
  accountId: string;
  displayName: string;
  active: boolean;
}

export interface GroupInfo {
  id: string;
  name: string;
  exists: boolean;
}

export interface PageRestrictionHit {
  principalType: PrincipalType;
  principalId: string;
  operation: 'read' | 'update';
}

export interface GroupMembership {
  groupIds: string[];
  /** false when pagination cap was hit or the lookup failed: group grants may be missed (fail closed). */
  complete: boolean;
}

/**
 * Confluence/Atlassian lookups. Every method throws GatewayError on API failure; callers MUST
 * fail closed. `accountId` arguments always come from the trusted Forge resolver context.
 */
export interface ConfluenceGateway {
  /** Evaluated as the invoking user (asUser) against the actual page/draft content id. */
  pagePermissions(accountId: string, pageId: string): Promise<PagePermissions>;
  groupMembership(accountId: string): Promise<GroupMembership>;
  searchUsers(query: string): Promise<PrincipalHit[]>;
  searchGroups(query: string): Promise<PrincipalHit[]>;
  users(accountIds: string[]): Promise<Map<string, UserInfo>>;
  groups(groupIds: string[]): Promise<Map<string, GroupInfo>>;
  groupHasMembers(groupId: string): Promise<boolean>;
  isSiteAdmin(accountId: string): Promise<boolean>;
  /**
   * Page view/edit restrictions as the invoking user.
   * Empty means the page is not restricted (or the caller cannot see a restriction list).
   */
  pageRestrictions(pageId: string): Promise<PageRestrictionHit[]>;
}

export interface PrivacyGateway {
  report(
    accounts: Array<{ accountId: string; updatedAt: string }>,
  ): Promise<Array<{ accountId: string; status: 'closed' | 'updated' }>>;
}

export type { PrincipalHit, PrincipalType };
