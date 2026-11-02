/**
 * Storage port. The domain only depends on this interface, which models exactly the guarantees
 * the production adapter (Forge KVS / Custom Entity Store `transact()`) is expected to provide:
 *  - atomic multi-document transactions with per-document conditions (max 25 operations),
 *  - optimistic concurrency through a per-document revision counter (`rev`),
 *  - indexed, paginated listing by (partition, range).
 */

export type EntityName = 'section' | 'binding' | 'revision' | 'audit' | 'meta';

export interface Doc<T> {
  entity: EntityName;
  key: string;
  /** Store-managed monotonically increasing write counter (1 on create). */
  rev: number;
  value: T;
}

export interface DocKeyIndex {
  /** Partition and range used by the single listing index. */
  partition: string;
  range: string;
}

export type TxOp =
  | { kind: 'create'; entity: EntityName; key: string; value: unknown; index: DocKeyIndex }
  | {
      kind: 'put';
      entity: EntityName;
      key: string;
      value: unknown;
      index: DocKeyIndex;
      expectRev: number;
    }
  | { kind: 'delete'; entity: EntityName; key: string; expectRev?: number }
  | { kind: 'check'; entity: EntityName; key: string; expectRev: number | 'absent' };

export interface ListQuery {
  entity: EntityName;
  partition: string;
  rangeBeginsWith?: string;
  order: 'ASC' | 'DESC';
  limit: number;
  cursor?: string | null;
}

export interface ListResult<T> {
  items: Doc<T>[];
  nextCursor: string | null;
}

export class StoreConflictError extends Error {
  constructor(message = 'Storage condition failed') {
    super(message);
    this.name = 'StoreConflictError';
  }
}

export class StoreUnavailableError extends Error {
  constructor(message = 'Storage unavailable') {
    super(message);
    this.name = 'StoreUnavailableError';
  }
}

export const MAX_TX_OPS = 25;

export interface Store {
  get<T>(entity: EntityName, key: string): Promise<Doc<T> | undefined>;
  list<T>(query: ListQuery): Promise<ListResult<T>>;
  /** Atomic. Throws StoreConflictError if any condition fails (nothing is written). */
  transact(ops: TxOp[]): Promise<void>;
}
