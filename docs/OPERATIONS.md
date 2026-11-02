# Operations

Everything here is **analytical** (derived from documented limits and the code). No load test was run on Forge;
numbers must be confirmed with QA-17 and the Forge usage dashboard.

## Runtime topology

| Piece                             | Where                                                          | Notes                                                          |
| --------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------- |
| Resolver function `index.handler` | Forge `nodejs24.x`, 512 MB default                             | One invocation per UI operation                                |
| `adfExport`                       | Forge function                                                 | No storage access, constant output                             |
| `maintenance`                     | scheduled trigger `day`                                        | Retention sweep then privacy sweep, both bounded and resumable |
| Storage                           | Custom Entity Store (`ssdoc`), `ugc` and `pii` classifications | Installation-scoped                                            |
| Egress                            | none                                                           | No `permissions.external`; target is "Runs on Atlassian"       |

## Cost and limits model

Forge billing is consumption-based since 2026-01-01 (https://developer.atlassian.com/platform/forge/platform-quotas-and-limits/). Use the Developer Console cost estimator
for prices; this section only estimates **units**.

Per user operation (typical, document 5 KB):

| Operation                         | Confluence calls                                 | KVS reads                           | KVS writes                               |
| --------------------------------- | ------------------------------------------------ | ----------------------------------- | ---------------------------------------- |
| View (`getSection`), direct grant | 1 permission check                               | 3 (binding, section, head revision) | 0                                        |
| View, with group grants           | + 1 membership lookup (+ group names for labels) | 3                                   | 0                                        |
| Save                              | 1 + 1 (page update check)                        | 2 to 3                              | 1 transaction (revision, section, audit) |
| Grant change                      | 1 + directory lookups                            | 1 to 2                              | 1 transaction                            |
| First denial of the day per user  | 1                                                | 2                                   | 1 (audit)                                |

KVS limits (https://developer.atlassian.com/platform/forge/limits-kvs-ce/): 1000 requests/s, 4000 read units/min, 4000 write units/min, 1 unit = 10 KB.

- A 5 KB revision costs 1 read unit; a **150 KB maximum revision costs 15**. At the maximum size a single
  installation could serve about 4000 / (14 + 2) ~ 250 views per minute before reading throttles. Typical
  documents are far below this.
- `TOO_MANY_REQUESTS` maps to UNAVAILABLE in the UI with a "Try again" button; nothing is ever shown without checks.
- Writes: one transaction per mutation counts as one write.

Storage per installation (upper bounds from the code limits):

| Item                                               | Typical                             | Worst case                                               |
| -------------------------------------------------- | ----------------------------------- | -------------------------------------------------------- |
| Section record (ACL up to 500 grants, 20 bindings) | 2 KB                                | ~120 KB (must stay under 240 KiB; grant cap keeps it so) |
| Revisions                                          | 5 KB x up to 50 = 250 KB            | 150 KB x 50 = 7.5 MB per section                         |
| Audit                                              | 0.3 KB per event, retained 730 days | bounded by activity                                      |

There is no hard storage quota documented for KVS in the pages reviewed; fair-use applies. 1000 sections x typical =
about 0.3 GB worst typical; stay under the documented fair-use expectations by lowering `revisionsKeep` for very large estates.

## Scheduled maintenance

- Retention: scans 25 sections per run (stored cursor), prunes revisions (never the head), audit older than the
  limit, purges soft-deleted sections after grace. A tenant with 10 000 sections completes a full pass in 400 days at
  default pacing. Increase frequency or the batch (`maxSections`) before shipping to large estates (tracked as
  T-OPS-1 in docs/TASKS.md).
- Privacy: reports accountIds in batches of 90 with a 7-day floor; erasure runs per section.

## Monitoring and alerting

- Use Forge Developer Console: invocation errors, latency, storage usage, cost.
- Log events (JSON, no content): `resolver.failure` (fn, kind, status), `privacy.sweep`, `retention.sweep`, `maintenance.failure`.
- Suggested alerts: error rate > 2% over 15 min, `maintenance.failure` any, storage growth > 2x week over week.

## Data residency and privacy

Data stays in Forge-hosted storage in the installation's region (Forge data residency follows the host product's
realm; confirm against https://developer.atlassian.com/platform/forge/runs-on-atlassian/ before claiming). No data leaves Atlassian infrastructure.
Content is end-user generated content (UGC); accountIds are PII. See docs/marketplace/DATA_HANDLING.md.

## Backup and recovery

- Forge KVS has no customer-visible backup/restore API in the pages reviewed. The product therefore has **no
  guaranteed point-in-time restore**. Mitigations: version history (restore any retained revision), soft delete with a
  30-day grace and administrator recovery, audit trail.
- Disaster recovery of the platform itself is Atlassian's responsibility (Marketplace support).
- Manual per-user data export on request: an operator with a development deployment of the same code can run the
  privacy sweep for a given accountId and export grants/audit rows. A supported admin export is not implemented.

## Routine procedures

| Procedure                        | Steps                                                                                                                                                                             |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Raise a section's retention      | Update the `retention` meta record (partial `RetentionConfig`, merged over defaults) via a one-off function on a reviewed branch (no UI yet). Documented gap T-OPS-2.             |
| Investigate a "CORRUPTED" report | Section content failed hash or schema validation. Do not render. Restore a previous revision (MODIFY) after confirming with the author. Check audit for tampering (chain status). |
| Orphaned section                 | Site admin runs recovery (docs/ADMIN_GUIDE.md).                                                                                                                                   |
| Incident                         | Follow docs/marketplace/VULNERABILITY_DISCLOSURE.md and the support policy; rotate nothing (the app stores no secrets).                                                           |
