import { createHash } from 'node:crypto';
import type { AuditAction } from '@secure-sections/shared';
import { GENESIS_HASH, SCHEMA_VERSION, type AuditDoc, type AuditMeta } from './model';

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
    .join(',')}}`;
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function chainHash(
  prev: string,
  e: { at: string; action: string; actor: string; meta: AuditMeta },
): string {
  return sha256(
    `${prev}|${canonical({ at: e.at, action: e.action, actor: e.actor, meta: e.meta })}`,
  );
}

export interface AuditInput {
  sectionId: string;
  action: AuditAction;
  actor: string;
  meta?: AuditMeta;
  at: string;
  rand: string;
}

const SAFE_META_KEY = /^[a-zA-Z][a-zA-Z0-9_]{0,31}$/;

export function sanitizeMeta(meta: AuditMeta | undefined): AuditMeta {
  const out: AuditMeta = {};
  if (!meta) return out;
  for (const [k, v] of Object.entries(meta)) {
    if (!SAFE_META_KEY.test(k)) continue;
    out[k] = typeof v === 'string' ? v.slice(0, 200) : v;
  }
  return out;
}

/** Builds a chained audit entry. Content bodies must never be passed in `meta`. */
export function buildChainedAudit(prevHead: string, input: AuditInput): AuditDoc {
  const meta = sanitizeMeta(input.meta);
  const id = `${input.at}#${input.rand}`;
  return {
    schema: SCHEMA_VERSION,
    sectionId: input.sectionId,
    id,
    at: input.at,
    action: input.action,
    actor: input.actor,
    meta,
    chained: true,
    prev: prevHead,
    hash: chainHash(prevHead, { at: input.at, action: input.action, actor: input.actor, meta }),
  };
}

export function buildUnchainedAudit(input: AuditInput, id: string): AuditDoc {
  return {
    schema: SCHEMA_VERSION,
    sectionId: input.sectionId,
    id,
    at: input.at,
    action: input.action,
    actor: input.actor,
    meta: sanitizeMeta(input.meta),
    chained: false,
    prev: GENESIS_HASH,
    hash: GENESIS_HASH,
  };
}

export type ChainStatus = 'OK' | 'BROKEN' | 'PARTIAL';

/**
 * Verify a newest-first page of audit entries. Tamper-EVIDENT only: the app and its storage
 * provider can still rewrite history coherently (see docs/SECURITY.md).
 * `head` is the section's current auditHead; only compared when `isFirstPage`.
 */
export function verifyChain(
  entries: AuditDoc[],
  opts: { head: string; isFirstPage: boolean; isLastPage: boolean },
): ChainStatus {
  const chained = entries.filter((e) => e.chained);
  if (chained.length === 0) return 'OK';
  const first = chained[0];
  if (opts.isFirstPage && first && first.hash !== opts.head) return 'BROKEN';
  for (let i = 0; i < chained.length; i += 1) {
    const e = chained[i];
    if (!e) continue;
    if (!e.erased) {
      const expect = chainHash(e.prev, {
        at: e.at,
        action: e.action,
        actor: e.actor,
        meta: e.meta,
      });
      if (expect !== e.hash) return 'BROKEN';
    }
    const older = chained[i + 1];
    if (older && older.hash !== e.prev) return 'BROKEN';
  }
  const oldest = chained[chained.length - 1];
  if (opts.isLastPage && oldest && oldest.prev !== GENESIS_HASH) return 'PARTIAL';
  return 'OK';
}
