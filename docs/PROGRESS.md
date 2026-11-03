# Progress log

Test counts at last full run (2026-11-01 UTC): backend project 10 files / 210 tests PASS; macro-ui project 3 files / 21 tests PASS;
Playwright 6 tests PASS (UI harness, not Forge). `npm run verify` exit 0. `npm run audit:deps` exit 0 (6 moderate remain).
Not executed: `forge lint` (B-001), all real-site spikes (B-002).

Honest labelling: "OFFLINE" = against the in-memory store and fake Confluence; these prove our logic, not Forge behaviour.

---

## PROMPT 00: Operating contract

Objective: read the playbook, set conventions. Decisions: npm workspaces, TypeScript strict, ports/adapters so the domain is testable offline,
branch `cursor/secure-sections-forge-build-18af`, never push to protected branches or deploy. Commit: `cc5aab5` (first code commit). Next: P01.

## PROMPT 01: Research, architecture, threat model

- Files: docs/PLATFORM_FINDINGS.md, REQUIREMENTS.md, ARCHITECTURE.md, SECURITY.md, ADRS/0001-0008.
- Decisions: KVS transactions over SQL (ADR-0001); binding protocol based on the documented non-uniqueness of `localId` (ADR-0002).
- Commands: official docs read via web fetch/search (URLs in PLATFORM_FINDINGS). Unverified: spikes S1-S8.
- Security issues found: missing `report:personal-data` scope; vulnerable ProseMirror (both fixed, see below).
- Commit: `9ece1ee` and this documentation commit. Next: P02.

## PROMPT 02: Forge skeleton and quality

- Files: package.json, tsconfig*.json, eslint.config.js, .prettierrc.json, vitest.config.ts, manifest.yml, scripts/validate-manifest.mjs, scripts/bundle-guard.mjs, .github/workflows/ci.yml, .github/dependabot.yml, docs/SETUP.md.
- Decisions: placeholder app id (never committed real id); ESLint bans `dangerouslySetInnerHTML`, `localStorage`, `eval`, `new Function`; offline manifest validation substitutes `forge lint`.
- Commands: `npm run lint`, `typecheck`, `test`, `build`, `validate:manifest`: PASS. `npx forge lint`: FAILED "Not logged in" (B-001).
- Commit: `cc5aab5`, `f3bb023`, `9ece1ee`, CI in this documentation commit. Next: P03.

## PROMPT 03: Storage and consistency

- Files: src/ports/store.ts, src/adapters/kvs-store.ts, src/testing/memory-store.ts, src/domain/model.ts.
- Decisions: single entity `ssdoc`; `expectRev` compare-and-set; 25-op limit enforced in the port; retries (4) then CONFLICT.
- Outcome: contract and race tests PASS OFFLINE. Unverified: live KVS semantics (S4, S5, B-003).
- Commit: `cc5aab5`. Next: P04.

## PROMPT 04: Identity, page access and RBAC

- Files: src/domain/context.ts, authz.ts, src/adapters/forge-gateway.ts, src/resolvers.ts.
- Decisions: identity only from `req.context`; `asUser` self permission check before any `asApp`; fail closed; highest role wins; page edit AND role to write (ADR-0003).
- Outcome: `authz.test.ts` table-driven (grants, groups, revocation, API errors) PASS OFFLINE. Unverified: S2, S3, S7.
- Commit: `cc5aab5`. Next: P05.

## PROMPT 05: Section lifecycle and binding

- Files: src/domain/service.ts (create/bind/copy/delete), lifecycle.test.ts.
- Outcome: copied page, hijack attempt, two macros per page, malicious params, concurrent creation, orphan recovery PASS OFFLINE.
- Unverified: `localId` behaviour on drafts/publish/copy (S1).
- Commit: `cc5aab5`. Next: P06.

## PROMPT 06: Viewer and editor

- Files: static/macro-ui/src/*, packages/shared/src/editor-schema.ts, `editor-schema.test.ts`, `Editor.test.tsx`, `App.test.tsx`.
- Decisions: Tiptap behind a shared allowlist validator (ADR-0008); text-only renderer; Save/Cancel with guard; conflict UX.
- Outcome: 46 validator cases, UI state tests with axe (jsdom) PASS; screenshots generated.
- Security issue: `prosemirror-view@1.41.5` in tree (GHSA-c8x8-7fp4-3x9w) and duplicate ProseMirror copy caused an editor crash in Chromium; fixed (pin + overrides) and guarded in the build.
- Commits: `f3bb023`, `9b6daa8`, `89b0f6c`. Next: P07.

## PROMPT 07: Permission administration

- Files: Panels.tsx (PermissionsPanel), service.ts (upsert/revoke/owner/recover), permissions.test.ts.
- Outcome: escalation, group inheritance, final-admin race tests, recovery tests PASS OFFLINE. Unverified: S5, S7.
- Commit: `cc5aab5`, `f3bb023`. Next: P08.

## PROMPT 08: Revisions, audit, retention

- Files: service.ts, audit.ts, retention.ts, privacy.ts, tests.
- Decisions: hash chain is tamper-evident not immutable (ADR-0005); retention defaults (ADR-0007).
- Security issue found: privacy sweep would report daily; fixed with 7-day floor and test (commit `034db5a`).
- Outcome: retention, privacy, audit tests PASS OFFLINE. Next: P09.

## PROMPT 09: Advanced security verification

- Files: tests/security-matrix.test.ts (68 cases), docs/SECURITY.md (STRIDE and verification matrix), docs/QA_MATRIX.md (adversarial checklist).
- Outcome offline: every resolver function tested for non-granted editor, no-page-access user, malformed context; spoofed identity fields; hostile payload shapes; leak checks on logs/audit/keys; fail-closed on outages. All PASS.
- Real-site items: NOT EXECUTED (listed). No critical test waived.
- Commit: `9b6daa8`, docs commit. Next: P10.

## PROMPT 10: UX, onboarding, i18n, diagnostics

- Files: i18n.ts (en/es, parity test), App.tsx wizard, Help/Diagnostics panels, styles.css (dark mode, focus rings), docs/USER_GUIDE.md, ADMIN_GUIDE.md.
- Outcome: i18n parity test PASS; axe in jsdom and Chromium (with colour contrast) PASS; Spanish screenshot captured.
- Commits: `f3bb023`, `a9aea86`. Next: P11.

## PROMPT 11: Integration/QA matrix, CI, operations

- Files: docs/QA_MATRIX.md, OPERATIONS.md, DEPLOYMENT.md, CI workflow, Playwright harness (`static/macro-ui/vite.harness.config.ts`, `e2e/`).
- Outcome: Playwright 6 tests PASS (UI + real handlers + in-memory). Real-site tests NOT EXECUTED with exact steps documented.
- Commit: `a9aea86` and docs commit. Next: P12.

## PROMPT 12: Marketplace package and final gate

- Files: docs/marketplace/* (LISTING, SCREENSHOT_PLAN, PRIVACY_POLICY_DRAFT, EULA_DRAFT, SUPPORT_POLICY, VULNERABILITY_DISCLOSURE, LICENSING_STRATEGY, SCOPES_RATIONALE, DATA_HANDLING), CHANGELOG.md, RELEASE_NOTES.md, docs/FINAL_REPORT.md.
- Not done (not authorised): no deployment, no listing, no licensing enabled.
- Final recommendation: **INTERNAL TEST** (see docs/FINAL_REPORT.md).

## UX pack (title, requests, expiry, history)

- Commits: `6672e3a` (meta + editor), `b8bd560` (access requests), `42a36d2` (expiry / last access), `ed59843` (history diff), plus this docs commit.
- Tests at last run: 18 files / 321 PASS. Wiki not updated (T-WIKI-1) until the UI is deployed and exercised.
