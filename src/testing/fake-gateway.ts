import type { PrincipalHit } from '@secure-sections/shared';
import {
  GatewayError,
  type ConfluenceGateway,
  type GroupInfo,
  type GroupMembership,
  type PagePermissions,
  type PrivacyGateway,
  type UserInfo,
} from '../ports/confluence';

/**
 * Scriptable Confluence double for offline contract/security tests. It models the *documented*
 * semantics (per-user page rights, group membership, user/group directory) but is NOT evidence
 * of real Confluence behaviour: see docs/QA_MATRIX.md for the real-site checklist.
 */
export class FakeConfluence implements ConfluenceGateway {
  private pages = new Map<string, Map<string, PagePermissions>>();
  private userDir = new Map<string, UserInfo>();
  private groupDir = new Map<string, { info: GroupInfo; members: Set<string> }>();
  siteAdmins = new Set<string>();
  failing = new Set<keyof ConfluenceGateway>();
  incompleteGroupFor = new Set<string>();
  calls: string[] = [];

  addUser(accountId: string, displayName = accountId, active = true): this {
    this.userDir.set(accountId, { accountId, displayName, active });
    return this;
  }

  addGroup(id: string, name = id, members: string[] = []): this {
    this.groupDir.set(id, { info: { id, name, exists: true }, members: new Set(members) });
    return this;
  }

  removeGroup(id: string): this {
    this.groupDir.delete(id);
    return this;
  }

  addToGroup(id: string, accountId: string): this {
    this.groupDir.get(id)?.members.add(accountId);
    return this;
  }

  removeFromGroup(id: string, accountId: string): this {
    this.groupDir.get(id)?.members.delete(accountId);
    return this;
  }

  deactivate(accountId: string): this {
    const u = this.userDir.get(accountId);
    if (u) this.userDir.set(accountId, { ...u, active: false });
    return this;
  }

  setPage(pageId: string, accountId: string, perms: PagePermissions): this {
    let m = this.pages.get(pageId);
    if (!m) this.pages.set(pageId, (m = new Map()));
    m.set(accountId, perms);
    return this;
  }

  private maybeFail(name: keyof ConfluenceGateway): void {
    this.calls.push(name);
    if (this.failing.has(name)) throw new GatewayError(`injected ${name} failure`, 503);
  }

  async pagePermissions(accountId: string, pageId: string): Promise<PagePermissions> {
    await Promise.resolve();
    this.maybeFail('pagePermissions');
    return this.pages.get(pageId)?.get(accountId) ?? { canView: false, canEdit: false };
  }

  async groupMembership(accountId: string): Promise<GroupMembership> {
    await Promise.resolve();
    this.maybeFail('groupMembership');
    const groupIds = [...this.groupDir.values()]
      .filter((g) => g.members.has(accountId))
      .map((g) => g.info.id);
    return { groupIds, complete: !this.incompleteGroupFor.has(accountId) };
  }

  async searchUsers(query: string): Promise<PrincipalHit[]> {
    this.maybeFail('searchUsers');
    return [...this.userDir.values()]
      .filter((u) => u.active && u.displayName.toLowerCase().includes(query.toLowerCase()))
      .map((u) => ({ principalType: 'USER', principalId: u.accountId, label: u.displayName }));
  }

  async searchGroups(query: string): Promise<PrincipalHit[]> {
    this.maybeFail('searchGroups');
    return [...this.groupDir.values()]
      .filter((g) => g.info.name.toLowerCase().includes(query.toLowerCase()))
      .map((g) => ({ principalType: 'GROUP', principalId: g.info.id, label: g.info.name }));
  }

  async users(accountIds: string[]): Promise<Map<string, UserInfo>> {
    await Promise.resolve();
    this.maybeFail('users');
    const out = new Map<string, UserInfo>();
    for (const id of accountIds) {
      const u = this.userDir.get(id);
      if (u) out.set(id, u);
    }
    return out;
  }

  async groups(groupIds: string[]): Promise<Map<string, GroupInfo>> {
    await Promise.resolve();
    this.maybeFail('groups');
    const out = new Map<string, GroupInfo>();
    for (const id of groupIds) {
      const g = this.groupDir.get(id);
      out.set(id, g ? g.info : { id, name: id, exists: false });
    }
    return out;
  }

  async groupHasMembers(groupId: string): Promise<boolean> {
    this.maybeFail('groupHasMembers');
    return (this.groupDir.get(groupId)?.members.size ?? 0) > 0;
  }

  async isSiteAdmin(accountId: string): Promise<boolean> {
    this.maybeFail('isSiteAdmin');
    return this.siteAdmins.has(accountId);
  }
}

export class FakePrivacy implements PrivacyGateway {
  closed = new Set<string>();
  reported: string[] = [];
  calls = 0;
  async report(accounts: Array<{ accountId: string; updatedAt: string }>) {
    this.calls += 1;
    this.reported.push(...accounts.map((a) => a.accountId));
    return accounts
      .filter((a) => this.closed.has(a.accountId))
      .map((a) => ({ accountId: a.accountId, status: 'closed' as const }));
  }
}
