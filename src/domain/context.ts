import { ACCOUNT_ID_RE, LOCAL_ID_RE, PAGE_ID_RE } from './model.js';

/**
 * The ONLY source of user, tenant, page and macro identity for authorization.
 * Built exclusively from the Forge resolver `req.context`, which the platform guarantees to be
 * secure and unalterable (see docs/PLATFORM_FINDINGS.md). Never populate from `req.payload`.
 */
export interface TrustedContext {
  accountId: string;
  cloudId: string;
  pageId: string;
  localId: string;
  spaceKey: string | null;
  moduleKey: string;
  environmentId: string;
  locale: string;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 && v.length <= 256 ? v : null;
}

/** Returns null for any missing/malformed field: callers must then refuse to operate (fail closed). */
export function parseResolverContext(raw: unknown): TrustedContext | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const c = raw as Record<string, unknown>;
  const accountId = str(c.accountId);
  const cloudId = str(c.cloudId);
  const localId = str(c.localId);
  const moduleKey = str(c.moduleKey);
  const environmentId = str(c.environmentId);
  const ext = c.extension;
  if (!accountId || !cloudId || !localId || !moduleKey || !environmentId) return null;
  if (typeof ext !== 'object' || ext === null) return null;
  const e = ext as Record<string, unknown>;
  const content = e.content;
  const contentId =
    typeof content === 'object' && content !== null
      ? (content as Record<string, unknown>).id
      : undefined;
  const pageId =
    typeof contentId === 'string' || typeof contentId === 'number' ? String(contentId) : null;
  if (!pageId || !PAGE_ID_RE.test(pageId)) return null;
  if (!ACCOUNT_ID_RE.test(accountId) || !LOCAL_ID_RE.test(localId)) return null;
  const space = e.space;
  const spaceKey =
    typeof space === 'object' && space !== null
      ? str((space as Record<string, unknown>).key)
      : null;
  return {
    accountId,
    cloudId,
    pageId,
    localId,
    spaceKey,
    moduleKey,
    environmentId,
    locale: str(c.locale) ?? 'en',
  };
}
