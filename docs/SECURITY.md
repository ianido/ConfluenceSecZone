# Security

Scope: Secure Sections for Confluence (Forge, Custom UI, KVS). Read docs/PLATFORM_FINDINGS.md first for the
platform facts this model rests on.

## 1. Security claims and honest status

| Claim                                                                                                        | Status                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A user with page access but no section grant never receives section content.                                 | Verified OFFLINE against test doubles; **REAL-SITE NOT EXECUTED**. They may see the public title, classification and a few administrator names (FR-18/19), never content.         |
| Identity, tenant, page and macro come only from the Forge resolver context.                                  | Verified by code structure and OFFLINE tests; depends on Atlassian's documented guarantee (finding 2.1)                                                                           |
| Copying a page or macro cannot expose the original content.                                                  | Verified OFFLINE; real copy behaviour (S1) **NOT EXECUTED**                                                                                                                       |
| The last administrator cannot be removed, even concurrently.                                                 | Verified OFFLINE with the in-memory store, which has atomic transactions by construction. Depends on Forge `transact` conditions behaving as documented (S4, S5) **NOT EXECUTED** |
| Content is stored only in Forge storage and never in page body, macro config, URL, logs, or browser storage. | Verified OFFLINE (tests + bundle guard + lint rules)                                                                                                                              |
| Exports never contain protected content.                                                                     | Page export is a static placeholder; **which export paths call it is NOT EXECUTED (S8)**. The My sections CSV is audit metadata only (FR-28), verified OFFLINE.                   |
| Audit log is tamper-**evident**, not immutable.                                                              | See 6                                                                                                                                                                             |
| A secret field hides its value from other viewers.                                                           | **Not claimed.** The value is in the document. VIEW and storage readers can read it. The UI audits the label only (FR-24, FR-27).                                                 |
| Watermark, auto-lock and copy/print hiding stop a viewer from reading or copying.                            | **Not claimed.** They are deterrence returned with a READY view that still contains the document (FR-27, ADR-0010).                                                               |

We do not claim the product is production ready. See docs/FINAL_REPORT.md.

## 2. Assets, actors, assumptions

Assets: confidential section content and revisions; the ACL; the audit trail; the binding records.

Actors: (A) page viewer/editor without grant (the primary adversary); (B) section VIEW/MODIFY holder trying to
escalate; (C) a user who lost access; (D) Confluence site admin (trusted for recovery only); (E) a malicious
page editor who edits macro storage directly via the page API; (F) a network/browser attacker tampering with
client values; (G) a supply-chain attacker.

Assumptions (each is a documented platform guarantee or a spike): resolver `context` is unalterable (V); KVS is
installation-isolated (V); `transact` is atomic with conditions (V, behaviour spiked); `permission/check`
(self) reflects site, space and restriction rules (V).

## 3. STRIDE

| ID  | Threat                                                             | Mitigation                                                                                                                                                                                                                                   | Evidence                                                                                |
| --- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| S-1 | Spoofing: client passes another `accountId`/page/localId/sectionId | Identity only from `req.context`; payload is read only for operation parameters; `parseResolverContext` fails closed; smuggled fields are ignored                                                                                            | `security-matrix.test.ts` ("identity spoofing"), `lifecycle.test.ts` (malicious params) |
| S-2 | Spoofing: anonymous or deactivated account                         | Context without a valid `accountId` is rejected before any lookup; inactive accounts cannot be granted                                                                                                                                       | `authz.test.ts`, `permissions.test.ts`                                                  |
| T-1 | Tampering: edit stored content/ACL out of band                     | Content has sha256 and strict schema re-validation on read: failure shows CORRUPTED, never renders; audit hash chain + head hash detect edits and tail deletion                                                                              | `content.test.ts`                                                                       |
| T-2 | Tampering: macro config or localId manipulation                    | No macro config is used; `localId` is only half of the binding key; binding identity is cross-checked against the context                                                                                                                    | `lifecycle.test.ts`                                                                     |
| T-3 | Tampering: lost update / race on ACL or content                    | `rev` compare-and-set in `transact`; `aclVersion` and `headVersion` expected-version checks; retry budget of 4 then CONFLICT                                                                                                                 | `permissions.test.ts`, `content.test.ts`                                                |
| T-4 | Hostile rich text (XSS, javascript: links, HTML)                   | Allowlist validator (shared) used by editor, server, and renderer; text-only React rendering; no `dangerouslySetInnerHTML`; link schemes limited to http/https/mailto; images are data URLs of png/jpeg/gif/webp only; Playwright paste test | `editor-schema.test.ts`, `e2e/ui.spec.ts`                                               |
| R-1 | Repudiation                                                        | Audit of create, edit, restore, grant changes, owner changes, binding, copy, delete, recovery, denied access (1 per user/day)                                                                                                                | `content.test.ts`, `permissions.test.ts`                                                |
| I-1 | Information disclosure: IDOR via section id                        | No resolver accepts a section id as authority. `bindHere`/`copyHere` accept an opaque reference but require ADMINISTER/VIEW and return a uniform DENIED for "unknown" vs "not allowed"                                                       | `lifecycle.test.ts`                                                                     |
| I-2 | Disclosure via page edit rights                                    | Page edit is never sufficient to read; denied users get a generic DENIED                                                                                                                                                                     | `security-matrix.test.ts` (every resolver)                                              |
| I-3 | Disclosure via errors, logs, audit, keys                           | Errors are codes; logger records name and error class only; audit stores metadata only (revision tags, request reasons and secret values stay out of the audit payload); keys are ids                                                        | `security-matrix.test.ts` (leak test), `content.test.ts`, `protection.test.ts`          |
| I-4 | Disclosure via copy page/export/notification/search                | Copy: unconfigured placeholder; export: static ADF; no macro parameters so nothing is indexed from page storage. Notifications/search/AI indexing: **NOT EXECUTED (S8)**                                                                     | `lifecycle.test.ts`, `export.test.ts`                                                   |
| I-5 | Disclosure through browser                                         | No storage APIs, no URL state, no external requests (bundle guard), `no-referrer` meta                                                                                                                                                       | `scripts/bundle-guard.mjs`, ESLint                                                      |
| I-6 | Cross-tenant                                                       | KVS is installation scoped by the platform; records also carry `cloudId` and a mismatch is NO_ACCESS                                                                                                                                         | `lifecycle.test.ts`                                                                     |
| D-1 | DoS: oversize or deep documents                                    | Limits: 150 KB JSON, depth 24, 5000 nodes, text 20k; caps on grants/bindings; paginated lists                                                                                                                                                | `editor-schema.test.ts`, `security-matrix.test.ts`                                      |
| D-2 | DoS: hostile payload shapes                                        | Payload not an object, huge strings, deep JSON, `__proto__` keys: survive on every resolver                                                                                                                                                  | `security-matrix.test.ts`                                                               |
| D-3 | DoS: audit flood by denied users                                   | Denied access is audited at most once per user per day per section                                                                                                                                                                           | `authz.test.ts`                                                                         |
| D-4 | DoS: platform throttling                                           | Store/gateway failures map to UNAVAILABLE with retry in UI; never to content                                                                                                                                                                 | `authz.test.ts`                                                                         |
| E-1 | Elevation: MODIFY self-grants                                      | ADMINISTER required for ACL mutation, re-checked inside the transaction retry                                                                                                                                                                | `permissions.test.ts`                                                                   |
| E-2 | Elevation: group grant abuse                                       | Group membership resolved server-side; incomplete resolution never widens access; deleted groups lose access                                                                                                                                 | `authz.test.ts`                                                                         |
| E-3 | Elevation: orphaned section grabbed by anyone                      | Recovery needs Confluence site admin, no active admin, typed confirmation, permanent audit                                                                                                                                                   | `permissions.test.ts`                                                                   |
| E-4 | Elevation: `asApp` confusion                                       | `asUser` self-check precedes any `asApp` call; `asApp` returns only directory data                                                                                                                                                           | `forge-gateway.ts` (design); S7                                                         |
| G-1 | Supply chain                                                       | Lockfile, `npm audit` in CI, dependabot, pinned ProseMirror (see 7)                                                                                                                                                                          | CI                                                                                      |

## 4. Verification matrix (playbook PROMPT 09 list)

`O` = offline test exists and passes. `R` = needs a real Confluence site: **NOT EXECUTED**, procedure in
docs/QA_MATRIX.md.

| Area                                       | Offline                                                    | Real site                                  |
| ------------------------------------------ | ---------------------------------------------------------- | ------------------------------------------ |
| IDOR                                       | O (`lifecycle`, `security-matrix`)                         | R (QA-04)                                  |
| Client context tampering                   | O (`security-matrix` spoofing, missing/malformed context)  | R (QA-05: edit bridge context in DevTools) |
| Resolver authorization (all 37 functions)  | O (`security-matrix`, per function, three caller classes)  | R                                          |
| Cross-installation isolation               | O (cloudId stamp)                                          | R (two sites, QA-14)                       |
| Page restrictions                          | O (fake)                                                   | R (QA-06)                                  |
| Group removal / deleted group              | O                                                          | R (QA-07)                                  |
| Privileged admins (site admin cannot read) | O                                                          | R (QA-12)                                  |
| Token/session expiry                       | n/a for resolver context; UI handles errors as UNAVAILABLE | R (QA-15)                                  |
| Edit without page edit permission          | O                                                          | R                                          |
| Stored XSS                                 | O (validator, jsdom, Chromium paste)                       | R (Forge iframe sandbox/CSP)               |
| Reflected XSS                              | O (no URL/query state is read)                             | R                                          |
| Macro config manipulation                  | O (config unused)                                          | R (QA-05)                                  |
| Copied/duplicated pages                    | O                                                          | R (QA-08, S1)                              |
| Unpublish / draft / page history           | not modelled                                               | R (QA-10, S1, S3)                          |
| Export/PDF/email/notification/index        | O (placeholder only)                                       | R (QA-09, S8)                              |
| Browser cache                              | O (no storage use; headers are platform controlled)        | R (QA-16)                                  |
| ACL race conditions                        | O (in-memory atomic store)                                 | R (S5)                                     |
| Final-admin rule                           | O (race tests)                                             | R                                          |
| Orphan recovery                            | O                                                          | R (QA-12)                                  |
| Oversized payloads / malformed JSON        | O                                                          | R (platform payload limits)                |
| Denial of service / quotas                 | O (bounded work)                                           | R (QA-17 load)                             |

## 5. Authorization rules (normative)

1. Roles: VIEW < MODIFY < ADMINISTER. Effective role = highest of direct and group grants. No deny rules.
2. VIEW: read content. MODIFY: VIEW + write content, read history, restore. ADMINISTER: MODIFY + ACL,
   audit, delete, share reference, owner change, rebind.
3. Writing content additionally requires Confluence **page edit** for the invoking user. A MODIFY holder who
   cannot edit the page sees an explanation and a read-only view. ADMINISTER without page edit can manage the
   ACL but cannot edit content. Deleting requires page edit as well.
4. Reading requires page **view** for the invoking user in addition to a grant.
5. Every operation re-resolves access; there is no authorization cache and no session state.
6. Denials are generic. Only `getSection` distinguishes UI states, and only for users who may view the page.

## 6. Audit trail: tamper-evidence limits

Each audit entry stores `hash = sha256(prevHash | canonical(entry))`; the section stores the head hash. This
detects modification, reordering, and deletion of the newest entry. It is **not immutable**: Forge storage
offers no write-once guarantee, an actor with direct storage access (the app developer through a bad deploy, or
a platform operator) could rewrite the chain _and_ the head. Retention deliberately prunes old entries, in which
case verification reports `PARTIAL`, not `BROKEN`. Privacy erasure flags affected entries `erased`; for those the
content hash is not recomputed (linkage still is), so an entry that was legitimately erased can later be altered
without hash detection. This is the price of honouring account closure without breaking the chain. For stronger guarantees an export to an external WORM log
would be needed, which this product intentionally does not offer (no egress).

## 7. Dependencies

- **GHSA-c8x8-7fp4-3x9w** (prosemirror-view paste XSS, fixed in 1.42.3): the first dependency tree contained
  `prosemirror-view@1.41.5` (hoisted through `@forge/bridge` -> `@atlaskit/*`) next to Tiptap's fixed copy.
  Fixed by a direct dependency and `overrides` on `^1.42.9` and a regenerated lockfile. This also removed a
  second copy of ProseMirror from the bundle (944 KB -> 775 KB), which the Playwright test surfaced as a
  runtime "multiple versions of prosemirror-model" crash. `scripts/bundle-guard.mjs` now fails the build when more
  than one `prosemirror-model` copy is bundled.
- `npm audit --omit=dev --audit-level=high` passes (6 moderate advisories remain in `glob`/`minimatch` pulled by
  `@forge/*` packages; not exploitable in our usage, tracked in docs/BLOCKERS.md B-005).
- `npm audit` including dev dependencies reports critical/high findings only inside `@forge/cli` (developer tool,
  not shipped). Tracked as B-005.

## 8. Accepted trade-offs and residual risks

1. **Site-admin recovery** can designate a new administrator (including the admin themselves) for a section with
   no active administrator. This is the explicit "separate, strongly verified authority" required to avoid
   permanently orphaned data. It never happens silently: permanent audit entry, typed confirmation, only when no
   administrator is active. Organisations that forbid this must treat site-admin accounts accordingly (docs/ADRS/0006).
2. **Copying**: someone with VIEW can copy the content into a section they administer. This is inherent: a
   reader can always copy what they can read. The audit records both sides.
3. **Disclosure that a protected section exists** on a page the user can view is unavoidable (the macro renders
   a "protected" card).
4. **Page edit rights can delete the macro** (and therefore orphan the binding) or move it. Section data is
   retained and recoverable by an administrator rebinding it (`bindHere`) or by recovery.
5. **Confluence page history** stores the macro node (no secrets) but not content; restoring an old page version
   restores the macro node, which re-binds by (`pageId`,`localId`) to the current content.
6. KVS and Confluence behaviours listed as spikes S1 to S8 are assumptions until executed.
7. **Secret fields** are a writing convenience. The value is stored with the document. Do not treat the mask
   in the editor as confidentiality from other viewers or from storage readers.
8. **Watermark, auto-lock and print/select hiding** run in the browser. A person who can call `getSection`
   receives the document. Screenshot, devtools and a second client are outside this control.
9. **My sections, the byline and the CSV** return titles, classifications, roles and audit metadata. They are
   still personal data (who acted, which section). They do not return document bodies or request reasons.

## 9. Reporting vulnerabilities

See docs/marketplace/VULNERABILITY_DISCLOSURE.md.
