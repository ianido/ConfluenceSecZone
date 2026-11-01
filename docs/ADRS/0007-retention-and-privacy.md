# ADR-0007: Retention and privacy

Status: accepted

- Defaults: keep up to 50 revisions and at most 365 days (the head revision is never removed), audit entries
  730 days, soft-deleted sections purged after 30 days. A daily trigger prunes in bounded, resumable batches
  (25 sections per run, stored cursor).
- The only personal identifier stored is the Atlassian `accountId`. Content is user-generated and may contain
  anything the author typed.
- The Privacy API (`report:personal-data`) is polled with a 7-day floor. Closed accounts are anonymised to
  `erased:<hash prefix>` in grants, audit actors, revision authors and owner fields; audit entries that
  mention the account are flagged `erased`; chain **linkage** is still verified but the content hash of a flagged
  entry is not recomputed, so verification stays OK (`privacy.test.ts`). Consequence: tampering with an entry that
  already carries the `erased` flag is not detectable by hash (linkage still is). A last administrator is pseudonymised,
  not deleted, so the section stays recoverable.
- Export of one user's data on request is feasible (accountIds are indexed in grants, audit, revisions) but is a
  manual operator procedure documented in docs/OPERATIONS.md; there is no self-service export.
