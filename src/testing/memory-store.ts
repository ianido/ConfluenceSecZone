import {
  MAX_TX_OPS,
  StoreConflictError,
  StoreUnavailableError,
  type Doc,
  type EntityName,
  type ListQuery,
  type ListResult,
  type Store,
  type TxOp,
} from '../ports/store';

interface Row {
  entity: EntityName;
  key: string;
  rev: number;
  value: unknown;
  partition: string;
  range: string;
}

/**
 * In-memory reference implementation of the Store contract. Transactions are applied atomically
 * after validating every condition. Each public operation yields to the event loop first so
 * concurrent callers genuinely interleave (needed for race-condition tests).
 * This is a contract-test double, NOT evidence that Forge KVS behaves the same way.
 */
export class MemoryStore implements Store {
  private rows = new Map<string, Row>();
  failNextTransact: Error | null = null;
  failReads = false;
  transactCount = 0;
  /** Optional hook invoked between validation and apply for fault-injection tests. */
  beforeApply: (() => void) | null = null;

  private id(entity: EntityName, key: string): string {
    return `${entity}\u0000${key}`;
  }

  async get<T>(entity: EntityName, key: string): Promise<Doc<T> | undefined> {
    await Promise.resolve();
    if (this.failReads) throw new StoreUnavailableError();
    const r = this.rows.get(this.id(entity, key));
    return r ? { entity, key, rev: r.rev, value: structuredClone(r.value) as T } : undefined;
  }

  async list<T>(q: ListQuery): Promise<ListResult<T>> {
    await Promise.resolve();
    if (this.failReads) throw new StoreUnavailableError();
    let rows = [...this.rows.values()].filter(
      (r) =>
        r.entity === q.entity &&
        r.partition === q.partition &&
        (q.rangeBeginsWith === undefined || r.range.startsWith(q.rangeBeginsWith)),
    );
    rows.sort((a, b) => (a.range < b.range ? -1 : a.range > b.range ? 1 : 0));
    if (q.order === 'DESC') rows.reverse();
    if (q.cursor) {
      const c = q.cursor;
      rows = rows.filter((r) => (q.order === 'ASC' ? r.range > c : r.range < c));
    }
    const page = rows.slice(0, q.limit);
    const more = rows.length > q.limit;
    const last = page[page.length - 1];
    return {
      items: page.map((r) => ({
        entity: r.entity,
        key: r.key,
        rev: r.rev,
        value: structuredClone(r.value) as T,
      })),
      nextCursor: more && last ? last.range : null,
    };
  }

  async transact(ops: TxOp[]): Promise<void> {
    await Promise.resolve();
    if (this.failNextTransact) {
      const e = this.failNextTransact;
      this.failNextTransact = null;
      throw e;
    }
    if (ops.length === 0 || ops.length > MAX_TX_OPS) throw new Error('bad transaction size');
    const keys = new Set<string>();
    for (const op of ops) {
      const id = this.id(op.entity, op.key);
      if (keys.has(id)) throw new Error('duplicate key in transaction');
      keys.add(id);
      const cur = this.rows.get(id);
      switch (op.kind) {
        case 'create':
          if (cur) throw new StoreConflictError();
          break;
        case 'put':
          if (!cur || cur.rev !== op.expectRev) throw new StoreConflictError();
          break;
        case 'delete':
          if (op.expectRev !== undefined && (!cur || cur.rev !== op.expectRev))
            throw new StoreConflictError();
          break;
        case 'check':
          if (op.expectRev === 'absent' ? cur : !cur || cur.rev !== op.expectRev)
            throw new StoreConflictError();
          break;
      }
    }
    this.beforeApply?.();
    this.transactCount += 1;
    for (const op of ops) {
      const id = this.id(op.entity, op.key);
      const cur = this.rows.get(id);
      if (op.kind === 'create') {
        this.rows.set(id, {
          entity: op.entity,
          key: op.key,
          rev: 1,
          value: structuredClone(op.value),
          partition: op.index.partition,
          range: op.index.range,
        });
      } else if (op.kind === 'put' && cur) {
        this.rows.set(id, {
          ...cur,
          rev: cur.rev + 1,
          value: structuredClone(op.value),
          partition: op.index.partition,
          range: op.index.range,
        });
      } else if (op.kind === 'delete') {
        this.rows.delete(id);
      }
    }
  }

  /** Test helper: direct tamper access to simulate storage corruption. */
  tamper(entity: EntityName, key: string, mutate: (value: unknown) => unknown): void {
    const r = this.rows.get(this.id(entity, key));
    if (!r) throw new Error('missing row');
    r.value = mutate(structuredClone(r.value));
  }

  dump(entity?: EntityName): Row[] {
    return [...this.rows.values()].filter((r) => !entity || r.entity === entity);
  }
}
