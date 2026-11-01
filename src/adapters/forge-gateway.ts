import api, { route, privacy } from '@forge/api';
import type { PrincipalHit } from '@secure-sections/shared';
import {
  GatewayError,
  type ConfluenceGateway,
  type GroupInfo,
  type GroupMembership,
  type PagePermissions,
  type PrivacyGateway,
  type UserInfo,
} from '../ports/confluence.js';
import { PAGE_ID_RE } from '../domain/model.js';

const JSON_HEADERS = { Accept: 'application/json', 'Content-Type': 'application/json' };
const MEMBERSHIP_PAGE = 100;
const MAX_MEMBERSHIP_PAGES = 10;

type Json = Record<string, unknown>;

function isObj(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

async function readJson(res: { json: () => Promise<unknown> }): Promise<Json> {
  try {
    const j = await res.json();
    return isObj(j) ? j : {};
  } catch {
    throw new GatewayError('invalid json');
  }
}

function fail(res: { status: number }): never {
  throw new GatewayError(`confluence status ${res.status}`, res.status);
}

/**
 * Production Confluence gateway built only on documented Forge `@forge/api` calls.
 * STATUS: NOT EXECUTED against a live site in this repository (see docs/QA_MATRIX.md S1-S8).
 * Identity inputs always originate from the trusted resolver context.
 */
export class ForgeConfluenceGateway implements ConfluenceGateway {
  private async check(
    accountId: string,
    pageId: string,
    operation: 'read' | 'update',
  ): Promise<boolean> {
    // asUser: the call is authorised with the invoking user's own permissions.
    const res = await api
      .asUser()
      .requestConfluence(route`/wiki/rest/api/content/${pageId}/permission/check`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ subject: { type: 'user', identifier: accountId }, operation }),
      });
    if (res.status === 403 || res.status === 404) return false;
    if (!res.ok) fail(res);
    const j = await readJson(res);
    return j.hasPermission === true;
  }

  async pagePermissions(accountId: string, pageId: string): Promise<PagePermissions> {
    if (!PAGE_ID_RE.test(pageId)) return { canView: false, canEdit: false };
    const canView = await this.check(accountId, pageId, 'read');
    if (!canView) return { canView: false, canEdit: false };
    const canEdit = await this.check(accountId, pageId, 'update');
    return { canView, canEdit };
  }

  async groupMembership(accountId: string): Promise<GroupMembership> {
    const ids: string[] = [];
    for (let page = 0; page < MAX_MEMBERSHIP_PAGES; page += 1) {
      const start = page * MEMBERSHIP_PAGE;
      const res = await api
        .asApp()
        .requestConfluence(
          route`/wiki/rest/api/user/memberof?accountId=${accountId}&start=${start}&limit=${MEMBERSHIP_PAGE}`,
          { headers: { Accept: 'application/json' } },
        );
      if (!res.ok) fail(res);
      const j = await readJson(res);
      const results = Array.isArray(j.results) ? j.results : [];
      for (const r of results) if (isObj(r) && typeof r.id === 'string') ids.push(r.id);
      if (results.length < MEMBERSHIP_PAGE) return { groupIds: ids, complete: true };
    }
    return { groupIds: ids, complete: false };
  }

  async searchUsers(query: string): Promise<PrincipalHit[]> {
    const cql = `user.fullname ~ "${escapeCql(query)}"`;
    const res = await api
      .asUser()
      .requestConfluence(route`/wiki/rest/api/search/user?cql=${cql}&limit=20`, {
        headers: { Accept: 'application/json' },
      });
    if (!res.ok) fail(res);
    const j = await readJson(res);
    const out: PrincipalHit[] = [];
    for (const r of Array.isArray(j.results) ? j.results : []) {
      const u = isObj(r) && isObj(r.user) ? r.user : null;
      if (u && typeof u.accountId === 'string' && u.accountType !== 'app') {
        out.push({
          principalType: 'USER',
          principalId: u.accountId,
          label: typeof u.displayName === 'string' ? u.displayName : u.accountId,
        });
      }
    }
    return out;
  }

  async searchGroups(query: string): Promise<PrincipalHit[]> {
    const res = await api
      .asUser()
      .requestConfluence(route`/wiki/rest/api/group/picker?query=${query}&limit=20`, {
        headers: { Accept: 'application/json' },
      });
    if (!res.ok) fail(res);
    const j = await readJson(res);
    const out: PrincipalHit[] = [];
    for (const r of Array.isArray(j.results) ? j.results : []) {
      if (isObj(r) && typeof r.id === 'string' && typeof r.name === 'string') {
        out.push({ principalType: 'GROUP', principalId: r.id, label: r.name });
      }
    }
    return out;
  }

  async users(accountIds: string[]): Promise<Map<string, UserInfo>> {
    const out = new Map<string, UserInfo>();
    for (let i = 0; i < accountIds.length; i += 100) {
      const chunk = accountIds.slice(i, i + 100);
      const qs = new URLSearchParams();
      for (const id of chunk) qs.append('accountId', id);
      const res = await api.asApp().requestConfluence(route`/wiki/rest/api/user/bulk?${qs}`, {
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) fail(res);
      const j = await readJson(res);
      for (const r of Array.isArray(j.results) ? j.results : []) {
        if (isObj(r) && typeof r.accountId === 'string') {
          out.set(r.accountId, {
            accountId: r.accountId,
            displayName: typeof r.displayName === 'string' ? r.displayName : r.accountId,
            // accountType "" means unavailable (e.g. deactivated); see spike S8.
            active: r.accountType === 'atlassian' || r.accountType === 'app',
          });
        }
      }
    }
    return out;
  }

  async groups(groupIds: string[]): Promise<Map<string, GroupInfo>> {
    const out = new Map<string, GroupInfo>();
    for (const id of groupIds) {
      const res = await api.asApp().requestConfluence(route`/wiki/rest/api/group/by-id?id=${id}`, {
        headers: { Accept: 'application/json' },
      });
      if (res.status === 404) {
        out.set(id, { id, name: id, exists: false });
        continue;
      }
      if (!res.ok) fail(res);
      const j = await readJson(res);
      out.set(id, { id, name: typeof j.name === 'string' ? j.name : id, exists: true });
    }
    return out;
  }

  async groupHasMembers(groupId: string): Promise<boolean> {
    const res = await api
      .asApp()
      .requestConfluence(route`/wiki/rest/api/group/${groupId}/membersByGroupId?limit=1`, {
        headers: { Accept: 'application/json' },
      });
    if (res.status === 404) return false;
    if (!res.ok) fail(res);
    const j = await readJson(res);
    return Array.isArray(j.results) && j.results.length > 0;
  }

  async isSiteAdmin(accountId: string): Promise<boolean> {
    void accountId;
    // Evaluated as the invoking user: the response describes the caller's own operations.
    const res = await api
      .asUser()
      .requestConfluence(route`/wiki/rest/api/user/current?expand=operations`, {
        headers: { Accept: 'application/json' },
      });
    if (!res.ok) fail(res);
    const j = await readJson(res);
    const ops = Array.isArray(j.operations) ? j.operations : [];
    return ops.some(
      (o) => isObj(o) && o.operation === 'administer' && o.targetType === 'application',
    );
  }
}

function escapeCql(q: string): string {
  return [...q]
    .map((ch) => (ch === '\\' || ch === '"' || ch.charCodeAt(0) < 32 ? ' ' : ch))
    .join('')
    .trim();
}

export class ForgePrivacyGateway implements PrivacyGateway {
  async report(
    accounts: Array<{ accountId: string; updatedAt: string }>,
  ): Promise<Array<{ accountId: string; status: 'closed' | 'updated' }>> {
    const res = await privacy.reportPersonalData(accounts);
    return (res as Array<{ accountId: string; status: string }>)
      .filter((r) => r.status === 'closed' || r.status === 'updated')
      .map((r) => ({ accountId: r.accountId, status: r.status as 'closed' | 'updated' }));
  }
}
