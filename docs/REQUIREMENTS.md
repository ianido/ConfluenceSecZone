# Requirements

Product: **Secure Sections for Confluence**, a Forge-only macro that stores confidential rich text in a
section with its own ACL (VIEW < MODIFY < ADMINISTER), independent of page permissions.

Out of scope by decision: Forge Remote, Connect, any hosted server, external database, analytics SDK,
CDN-hosted assets, external storage.

## Functional requirements

IDs are referenced from docs/SECURITY.md and docs/QA_MATRIX.md. "Evidence" names the automated test or the
manual step that proves the criterion. `OFFLINE` = verified against test doubles (in-memory store and fake
Confluence); `REAL-SITE` = needs a Confluence Cloud site and is `NOT EXECUTED` until a human runs it.

| ID | Requirement | Acceptance criterion (measurable) | Evidence |
|----|-------------|------------------------------------|----------|
| FR-01 | Insert a macro and set up a secure section. | Creator becomes first ADMINISTER; creation is idempotent; concurrent creation by two users yields exactly one section. Requires page edit rights. | `src/domain/lifecycle.test.ts` (OFFLINE); QA-01 (REAL-SITE) |
| FR-02 | View protected content only with a grant. | A page viewer/editor without a grant receives no content bytes (response, logs, storage keys). | `tests/security-matrix.test.ts`, `authz.test.ts` (OFFLINE); QA-03 |
| FR-03 | Rich-text editing: paragraphs, headings (h1-h4), bold/italic/strike/code, links, bullet/ordered lists, quotes, code blocks, tables, rules. | Only allowlisted nodes/marks/attrs persist; unsafe URL schemes rejected. | `editor-schema.test.ts` (46 cases), Playwright hostile-paste test (OFFLINE, UI-level) |
| FR-04 | Save/Cancel with unsaved-change guard; no autosave. | Cancel with unsaved edits asks for confirmation; `beforeunload` guard active while dirty. | `Editor.test.tsx` |
| FR-05 | Optimistic concurrency. | Concurrent edit returns CONFLICT with latest version; user chooses reload or overwrite; nothing is silently overwritten. | `content.test.ts`, `Editor.test.tsx` |
| FR-06 | Revision history and restore. | Each save creates a version with author and time; restore creates a new version; MODIFY+ may read history; VIEW may not. | `content.test.ts` |
| FR-07 | Permission manager (ADMINISTER only): search people/groups, add, change, remove, show effective access. | Every mutation re-validates ADMINISTER server-side; stale ACL version conflicts; identical grants are idempotent. | `permissions.test.ts` |
| FR-08 | Final administrator protection. | Removing or downgrading the last effective administrator is refused, also under concurrent removal. | `permissions.test.ts` race tests |
| FR-09 | Break-glass recovery. | Only Confluence site administrators, only when no active administrator exists, typed confirmation, permanent audit entry; never returns content. | `permissions.test.ts` (OFFLINE); QA-12 (REAL-SITE) |
| FR-10 | Audit trail of security-relevant events. | create, edit, restore, grant, update, revoke, owner change, bind, copy, delete, recovery, denied access (max 1 per user/day) recorded without content. Hash chain detects tamper. | `content.test.ts` audit tests |
| FR-11 | Copy/duplicate policy. | A copied macro (same `localId`, different page) renders **unconfigured**, never the original content. Explicit "copy content" requires VIEW on the source and creates an independent section. | `lifecycle.test.ts` |
| FR-12 | Delete section. | Soft delete with grace period, then purge with revisions, audit and bindings. | `retention.test.ts` |
| FR-13 | Retention and privacy. | Revisions and audit pruned by configured age/count; closed Atlassian accounts anonymised after Privacy API report; 7-day reporting cycle. | `retention.test.ts`, `privacy.test.ts` |
| FR-14 | Exports never contain protected content. | `adfExport` returns a static placeholder and never reads storage. | Unit check (OFFLINE); QA-09 (REAL-SITE) |
| FR-15 | Internationalisation. | English baseline, Spanish translation; key parity enforced. | `i18n` tests, Playwright es locale |
| FR-16 | Admin diagnostics. | Site administrators see schema version, counts, health checks; never content or ACL details. | `permissions.test.ts` diagnostics |
| FR-17 | Distinct UX states. | Loading, unconfigured, denied, revoked, corrupted, unavailable, ready. | `App.test.tsx`, Playwright |

## Non-functional requirements

| ID | Requirement | Acceptance criterion | Evidence |
|----|-------------|----------------------|----------|
| NFR-01 | Default deny and fail closed. | Any API, storage or parsing failure yields UNAVAILABLE/DENIED, never content. | `authz.test.ts`, `security-matrix.test.ts` |
| NFR-02 | Identity only from the trusted Forge context. | No code path reads user, page, macro or section identity from `req.payload` or the bridge `getContext`. | `resolvers.ts` design; `security-matrix.test.ts` smuggling tests; ESLint ban list |
| NFR-03 | Tenant/page/section binding on every read and write. | Records stamped with another `cloudId` are never served; binding mismatch yields NO_ACCESS. | `lifecycle.test.ts` |
| NFR-04 | No secrets in page body, macro config, URLs, logs, telemetry, indexes, exports or browser storage. | Manifest declares no macro parameters; logger drops content; storage keys contain only ids; ESLint bans `localStorage`/`sessionStorage`; bundle guard enforces absence in `dist`. | `content.test.ts`, `scripts/bundle-guard.mjs` |
| NFR-05 | Forge-hosted only. | Manifest has no `remotes`, no `external.fetch`, no `connect`; runtime `nodejs24.x`; `Runs on Atlassian` eligibility is the target. | `scripts/validate-manifest.mjs`; Marketplace badge check is REAL-SITE |
| NFR-06 | Bounded work. | Document <= 150 KB JSON, depth <= 24, <= 5000 nodes, <= 500 grants, <= 20 bindings/section, <= 100 bindings/page, paginated audit/revisions, retention sweep bounded to 25 sections per run. | schema and lifecycle tests |
| NFR-07 | Accessibility. | axe-core finds no violations in each UI state (jsdom and Chromium); keyboard operable tabs and dialogs. | `App.test.tsx`, `e2e/ui.spec.ts` |
| NFR-08 | Supply chain. | `npm audit --omit=dev --audit-level=high` clean; CI runs lint, typecheck, tests, build, audit, manifest validation without deployment credentials. | CI workflow |
| NFR-09 | Strict TypeScript and lint cleanliness. | `npm run verify` exits 0. | CI |
| NFR-10 | Performance. | A getSection costs at most: 1 permission check + 2 to 4 KVS reads (+1 group lookup when group grants exist). | docs/OPERATIONS.md (analytical; no load test run) |

## Explicit UX behaviours required by the playbook

| Situation | Behaviour |
|-----------|-----------|
| Deleted page | Page deletion makes the macro unreachable. Section data stays until an administrator deletes it or retention purges it; no automatic purge on page deletion (we cannot observe it). |
| Copied page | Unconfigured placeholder with copy warning; no reference to the original. |
| Group lookup failure | Group-only grantees see "Temporarily unavailable" (not a false denial); direct grantees are unaffected. |
| Revoked user | Next request shows "Your access was removed"; no stale content is retained after reload. |
| Missing owner | Ownership is reassigned to a remaining administrator; if no active administrator remains, site-admin recovery applies. |
| Uninstall | Forge removes app data per Atlassian's retention; see docs/marketplace/DATA_HANDLING.md. The macro disappears from pages; confidential content is not written to the page. |

## Prioritised plan

See docs/TASKS.md.
