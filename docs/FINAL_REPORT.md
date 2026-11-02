# Final report

Date: 2026-11-01 (UTC). Branch: `cursor/secure-sections-forge-build-18af`. Playbook: Secure_Sections_AI_Autonomous_Prompts.md, PROMPT 00 to 12.

## Release recommendation: **INTERNAL TEST**

The product is complete enough to deploy to a **dedicated Forge development site** and be tested by humans. It is **NOT**
a Marketplace candidate and **must not be described as production ready**: several security properties are verified only
against test doubles and real-site verification is still mostly pending (B-002 to B-004). Update 2026-11-01: `forge lint` passed, the app was deployed and installed on a development environment, and export and site search were reported OK by the maintainer.

## What was built

- Forge app: macro `secure-section-macro` (Custom UI), resolver, `adfExport` placeholder, daily maintenance trigger, Custom Entity Store entity.
- Domain: server-side authorization (page access + section roles), binding protocol for copied/duplicated macros, optimistic concurrency, versioned content with restore, hash-chained audit, final-administrator rule, break-glass recovery, retention, privacy anonymisation.
- UI: React 19 + Tiptap 3 editor, text-only renderer, setup wizard, permission manager, history, activity, help, diagnostics; English and Spanish; light/dark; keyboard accessible.
- Quality: strict TypeScript, ESLint (a11y, banned APIs), Prettier, Vitest (jsdom for UI), Playwright, bundle guard, offline manifest validation with policy checks, CI workflow without deploy credentials, dependabot.
- Documentation: docs/ (platform findings, requirements, architecture, security, ADRs, QA matrix, operations, deployment/rollback, admin and user guides, progress, tasks, blockers) and drafts for the Marketplace package.

## Evidence (executed)

| Check                                                                                           | Result                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run lint` (ESLint + Prettier)                                                              | PASS                                                                                                                                                                                                                                 |
| `npm run typecheck` (backend, shared, UI, e2e)                                                  | PASS                                                                                                                                                                                                                                 |
| Vitest backend project                                                                          | 210 tests PASS (10 files)                                                                                                                                                                                                            |
| Vitest macro-ui project (jsdom, axe)                                                            | 21 tests PASS (3 files)                                                                                                                                                                                                              |
| Playwright (Chromium, real handlers, in-memory store, axe incl. contrast)                       | 6 tests PASS                                                                                                                                                                                                                         |
| `npm run build` (shared, UI, bundle guard: no eval/storage/external URLs/duplicate ProseMirror) | PASS                                                                                                                                                                                                                                 |
| `npm run validate:manifest` (schema + policy)                                                   | PASS                                                                                                                                                                                                                                 |
| `npm run audit:deps` (production, high)                                                         | PASS; 6 moderate advisories remain                                                                                                                                                                                                   |
| `forge lint`                                                                                    | PASS on 2026-11-01 ("No issues found")                                                                                                                                                                                               |
| Forge deploy / install / real-site tests                                                        | Deploy (development, v2.0.0) and install on a Confluence Cloud site: done 2026-11-01. Export and site search: reported OK by the maintainer (no evidence stored). Spikes S1 to S7, QA section C and the rest of S8: **NOT EXECUTED** |

## Security properties: what is actually verified

Verified OFFLINE (our logic against an in-memory atomic store and a scripted Confluence double):

- Denied users, including page editors, never receive content from any of the 19 resolver functions; malformed or missing trusted context fails closed; spoofed identity fields in payloads are ignored; hostile payload shapes do not crash or leak.
- Copied pages/macros render unconfigured; a new macro cannot hijack an existing section; two macros on one page are independent; cross-tenant stamped data is refused; tampered/corrupt content is never rendered.
- Final-administrator rule holds under simulated concurrency; ACL updates are optimistic and idempotent; role escalation is blocked.
- Content validation rejects scripts, unsafe URLs, unknown nodes and oversize/deep documents; renderer is text-only; pasted hostile HTML is neutralised in real Chromium.
- No plaintext content in logs, audit, revision metadata or storage keys; no browser storage use.
- Retention, soft delete/purge, privacy anonymisation, 7-day reporting floor.

**NOT verified (needs a real site):** actual KVS transaction/condition semantics and concurrency (S4, S5); `localId`/`content.id` stability and copy behaviour (S1, S2, S3); scopes versus endpoints (S7); notifications, page history, space export and AI search (S8; export and site search were later reported OK by the maintainer on 2026-11-01); Forge iframe/CSP editor behaviour (S6); cross-site isolation; performance and cost at scale.

## Defects found and fixed during the build

1. Vulnerable ProseMirror (`GHSA-c8x8-7fp4-3x9w`) plus a duplicated ProseMirror copy that crashed editing: pinned and guarded.
2. Missing `report:personal-data` scope for the Privacy API: added and policy-checked.
3. Privacy reporting cadence violating the 7-day cycle: floor enforced.
4. Axe/lint findings (ARIA misuse, jsdom layout gaps) fixed.

## Known limitations

See docs/SECURITY.md section 8 and docs/BLOCKERS.md. Highlights: site-admin recovery trade-off; audit is tamper-evident, not immutable; no
backup/restore API for KVS; retention pacing for very large estates; no admin retention UI; legal documents are drafts; licensing undecided.

## Remaining human approvals and actions (in order)

1. Provision a Forge development site and users/groups; `forge login` (never paste tokens into the repo or chat); `forge register` in your own account.
2. `npm ci && npm run verify && forge lint`; fix anything `forge lint` reports (especially scopes).
3. `forge deploy -e development` and `forge install` on the dev site; execute docs/QA_MATRIX.md sections B (S1 to S8) then C. Any leak is a blocker; record results.
4. Independent adversarial review (PROMPT AUDIT) after step 3.
5. Legal review of privacy policy and EULA; decide licensing; set real support and security contacts.
6. Only then consider staging, Marketplace submission and production. None of this was done or authorised here.

## Demo instructions (offline)

```bash
npm ci && npm run build:shared
npx vite --config static/macro-ui/vite.harness.config.ts
# http://localhost:5199/?actor=alice   -> set up, edit, share with "Bob"
# http://localhost:5199/?actor=bob     -> denied until granted
# http://localhost:5199/__reset        -> reset the in-memory world
```

This demo is not Forge and proves nothing about Forge behaviour.
