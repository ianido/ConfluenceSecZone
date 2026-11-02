# ADR-0001: Forge Custom Entity Store with transactions instead of Forge SQL

Status: accepted

## Context

The security invariants need atomic multi-record conditional writes: save content = revision + section head +
audit; remove administrator = ACL update guarded by the remaining administrators; bind = binding record +
section update + audit. The playbook prefers Forge SQL if its limitations allow it.

## Evidence

- Forge SQL: "Transactions are not yet supported", one statement per query, no foreign keys
  (https://developer.atlassian.com/platform/forge/storage-reference/sql/ ; staff confirmation Sep 2025 in the community thread).
- KVS/Custom Entity Store: `kvs.transact()` with `set`/`delete`/`check` and attribute conditions, all-or-nothing, 25 ops, 4 MB
  (https://developer.atlassian.com/platform/forge/storage-reference/entities-transactions/).

## Decision

Use one custom entity `ssdoc` (rev, p, r, payload; index by-partition) behind a `Store` port. The port exposes
`get`, `list` (partition + range pagination) and `transact` with `create`/`put`/`delete`/`check` operations and
`expectRev` compare-and-set. Unsupported constraints (uniqueness, foreign keys) are enforced in the domain layer
and by transactional conditions.

## Consequences

- One entity keeps within the 20 entity / 7 index limits; all logical tables share the index.
- Value limit 240 KiB bounds a revision (documents are capped at 150 KB).
- `FAIL_IF_EXISTS`-style creates and `rev` conditions are relied on: behaviour is spike S4/S5 (NOT EXECUTED).
- Migration to SQL later is possible behind the same port; there is no SQL schema to migrate today.
