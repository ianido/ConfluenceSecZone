import { Filter, FilterConditions, ForgeKvsAPIError, Sort, WhereConditions, kvs } from '@forge/kvs';
import {
  StoreConflictError,
  StoreUnavailableError,
  type Doc,
  type EntityName,
  type ListQuery,
  type ListResult,
  type Store,
  type TxOp,
} from '../ports/store.js';

export const ENTITY = 'ssdoc';
export const INDEX = 'by-partition';

interface Stored {
  rev: number;
  p: string;
  r: string;
  payload: unknown;
}

const KEY_RE = /^[a-zA-Z0-9:._\s\-#]+$/;

function storageKey(entity: EntityName, key: string): string {
  const k = `${entity}:${key}`;
  if (k.length > 500 || !KEY_RE.test(k)) throw new Error('invalid storage key');
  return k;
}

function revFilter(expect: number | 'absent') {
  const f = new Filter<Stored>();
  return expect === 'absent'
    ? f.and('rev', FilterConditions.notExists())
    : f.and('rev', FilterConditions.equalTo(expect));
}

function mapError(e: unknown): Error {
  if (e instanceof ForgeKvsAPIError) {
    const s = e.responseDetails.status;
    if (s === 429 || s >= 500) return new StoreUnavailableError();
    if (s >= 400) return new StoreConflictError();
  }
  return new StoreUnavailableError();
}

/**
 * Production adapter over Forge KVS / Custom Entity Store.
 * STATUS: written against @forge/kvs type definitions and documentation. It has NOT been executed
 * against a live Forge installation in this repository's CI (see docs/QA_MATRIX.md, spikes S4/S5).
 * Required manifest entity: see manifest.yml `storage.entities`.
 */
export class KvsStore implements Store {
  async get<T>(entity: EntityName, key: string): Promise<Doc<T> | undefined> {
    try {
      const v = await kvs.entity<Stored>(ENTITY).get(storageKey(entity, key));
      if (!v) return undefined;
      return { entity, key, rev: v.rev, value: v.payload as T };
    } catch (e) {
      throw mapError(e);
    }
  }

  async list<T>(q: ListQuery): Promise<ListResult<T>> {
    try {
      let builder = kvs
        .entity<Stored>(ENTITY)
        .query()
        .index(INDEX, { partition: [`${q.entity}|${q.partition}`] });
      if (q.rangeBeginsWith !== undefined) {
        builder = builder.where(WhereConditions.beginsWith(q.rangeBeginsWith));
      }
      builder = builder.sort(q.order === 'ASC' ? Sort.ASC : Sort.DESC).limit(q.limit);
      if (q.cursor) builder = builder.cursor(q.cursor);
      const res = await builder.getMany();
      return {
        items: res.results.map((r) => ({
          entity: q.entity,
          key: stripPrefix(r.key, q.entity),
          rev: r.value.rev,
          value: r.value.payload as T,
        })),
        nextCursor: res.nextCursor ?? null,
      };
    } catch (e) {
      throw mapError(e);
    }
  }

  async transact(ops: TxOp[]): Promise<void> {
    try {
      const tx = kvs.transact();
      for (const op of ops) {
        const key = storageKey(op.entity, op.key);
        switch (op.kind) {
          case 'create':
            tx.set<Stored>(key, stored(1, op.entity, op.index, op.value), {
              entityName: ENTITY,
              conditions: revFilter('absent'),
            });
            break;
          case 'put':
            tx.set<Stored>(key, stored(op.expectRev + 1, op.entity, op.index, op.value), {
              entityName: ENTITY,
              conditions: revFilter(op.expectRev),
            });
            break;
          case 'delete':
            tx.delete<Stored>(
              key,
              op.expectRev === undefined
                ? { entityName: ENTITY }
                : { entityName: ENTITY, conditions: revFilter(op.expectRev) },
            );
            break;
          case 'check':
            tx.check<Stored>(key, { entityName: ENTITY, conditions: revFilter(op.expectRev) });
            break;
        }
      }
      await tx.execute();
    } catch (e) {
      throw mapError(e);
    }
  }
}

function stored(
  rev: number,
  entity: EntityName,
  index: { partition: string; range: string },
  v: unknown,
): Stored {
  return { rev: rev, p: `${entity}|${index.partition}`, r: index.range, payload: v };
}

function stripPrefix(key: string, entity: EntityName): string {
  const prefix = `${entity}:`;
  return key.startsWith(prefix) ? key.slice(prefix.length) : key;
}
