# Secure Sections for Confluence — Autonomous AI Development Playbook

Version: 1.0 | Target: Confluence Cloud | Hosting: 100% Atlassian Forge

## How to use

1. Create an empty Git repository and launch a coding agent in its working directory with repository and terminal access.
2. Paste **PROMPT 00** as the initial instruction. It directs the agent to execute the remaining phases from this file, consecutively, without routine approval gates.
3. Give the agent permission to edit files, execute tests, install dependencies and create local commits, according to your environment's security controls. Don't grant credentials beyond what the task needs.
4. To deploy to your Confluence developer site, provision Atlassian developer authentication and a test site through the platform's official workflow. Never paste API tokens into the prompt or repository.
5. After any interruption, use **PROMPT RESUME**. The agent should recover from the repository, not depend on chat memory.
6. Marketplace listing, commercial configuration, permission grants, and publication are approval gates. The agent prepares everything but must not silently publish, incur spending, or change production installations.

## Global engineering contract (applies to every phase)

- Product: Secure Sections for Confluence, a Forge-based Confluence Cloud macro that holds independently permissioned confidential rich-text content within pages.
- Stack: TypeScript strict mode, supported Node.js 24 runtime, React Custom UI, Forge functions/resolvers, official Confluence APIs, Forge-hosted storage only, Tiptap if compatible, Vitest, Playwright where possible, GitHub Actions.
- No Forge Remote, Connect, C#, hosted server, external database, analytics SDK, CDN requirement, or external storage.
- Security: default deny; identity from server-trusted Forge resolver context; never authorize based on `view.getContext()` or client input; validate page access and app RBAC on each operation; tenant and section/page binding; server-side group resolution; no plaintext confidential content in page body, macro config, properties, browser URL, logs, exception telemetry, indexes, export or search metadata.
- Permissions: VIEW, MODIFY includes VIEW, ADMINISTER includes MODIFY and manages users/groups and administrators. The sole or final administrator cannot be deleted without a safe recovery flow. Page-level Confluence rights still apply.
- Support multiple independent sections per page; denied users receive no secret data, even when they can edit the parent page.
- Use official documentation as source of truth; don't invent SDK methods. Record verified URLs, relevant dates, limitations, and proofs of concept in docs/PLATFORM_FINDINGS.md.
- Forge SQL is preferred, but validate current functionality and quotas first. Do not assume full SQL foreign-key/transaction behavior. If it cannot enforce a critical invariant, use Forge KVS/Custom Entity Store conditional operations or a documented safe alternative. Do not claim transactions or strict immutability without evidence.
- Proper accessibility, responsiveness, error states, empty states, keyboard controls and actionable messages.
- No destructive operations on unrelated files. Use a dedicated repository and development site. No publishing, production changes, spending, or enabling new paid services without explicit human authorization.
- No fake tests or mocks substituted for end-to-end proof. Label untested integrations honestly.
- For each phase: implement, run lint + typecheck + unit tests + build + forge lint if available, fix failures, commit passing results, record evidence and next steps in docs/PROGRESS.md. Keep changes reviewable.
- If blocked by credentials, unavailable test site, external approvals or platform capability, implement everything that can be verified offline, add a reproducible checklist, and continue to independent phases. Never claim unverified deployment or production readiness.

---

# PROMPT 00 — Autonomous orchestrator (paste this first)

You are an autonomous principal engineer, security architect, UX engineer, QA engineer and technical writer. You have access to this repository and the playbook `Secure_Sections_AI_Autonomous_Prompts.md`. Your mission is to implement the entire **Secure Sections for Confluence** project, end-to-end, without asking routine clarifying questions or pausing between milestones.

Execute PROMPT 01 through PROMPT 12 sequentially. Before starting, inspect the repository and read the Global engineering contract. Make reasonable technical choices, document them in ADRs, and keep going. If a phase exposes an unresolved security problem, do not bypass it; isolate it, create a failing test or precise reproduction, and resolve it before treating the relevant feature as complete. Revisit earlier phases if necessary.

After each phase, update docs/PROGRESS.md with: objective, files changed, decisions, commands run, exact pass/fail outcomes, unverified assumptions, security issues, commit hash and next phase. Keep docs/TASKS.md with checkboxes and docs/BLOCKERS.md with severity and reproduction. Commit working changes to the current development branch; do not force push, rewrite history, merge to a protected branch, or publish externally.

You are authorized to run local project commands and tests and to edit this repository. You are NOT authorized by this prompt to purchase services, reveal secrets, deploy to production, install on unrelated tenants, or submit a Marketplace listing. For protected operations prepare commands and explicit human handoff steps. If Forge development credentials and a designated dev site are already available, run normal development deployment and tests where safely authorized; otherwise document the exact steps and proceed with offline implementation.

Do not stop after planning. Continue implementing until all phases are complete or blocked on genuinely external prerequisites. At completion produce docs/FINAL_REPORT.md with features, demo instructions, test evidence, security properties actually verified, known limitations, and readiness gate status. Do not claim the product is production-ready if any critical security or functional test remains unverified.

Begin PROMPT 01 now.

# PROMPT 01 — Research, architecture and threat model

Verify current official Atlassian documentation for Forge macro, Custom UI, resolver context security, Forge SQL/KVS, Confluence pages and restrictions, users/groups, identity, page copies/edits, lifecycle, export, Marketplace and licensing. Create docs/PLATFORM_FINDINGS.md with links and verified facts. Create docs/REQUIREMENTS.md (functional/nonfunctional and measurable acceptance criteria), docs/ARCHITECTURE.md, docs/SECURITY.md (STRIDE-style threats), docs/ADRS/ and a prioritized task plan. Investigate whether macro localId is stable across drafts, save, copies and reinsertions; explicitly design a robust section binding protocol and refuse insecure assumptions. Specify UX behavior for deleted pages, copied pages, inaccessible group lookup, revoked users, missing owner and uninstall. Provide a data-flow diagram in Mermaid. Define exact trusted context sources, permissions and scopes. Identify proof-of-concept spikes that must pass before implementing sensitive functionality. Build initial monorepo and repository conventions. Then proceed to PROMPT 02.

# PROMPT 02 — Forge skeleton and repository quality

Create a complete TypeScript monorepo with Forge manifest, Custom UI React app, Forge resolvers/functions, shared typed API contracts, test projects and documentation. Use the supported Node 24 runtime and current official dependency versions. Use pnpm or npm workspaces consistently. Implement a basic macro with empty/denied/error/loading states and a safe bridge to resolver. Add ESLint, Prettier, TypeScript strict, scripts for lint/typecheck/test/build, .gitignore, dependabot or dependency update guidance, a minimal GitHub Actions CI without deployment credentials. Verify `forge lint` when available. Add setup and local dev documentation. Never hardcode Atlassian app IDs or secrets: document required provisioning steps. Proceed to PROMPT 03.

# PROMPT 03 — Storage, schema and consistency

Implement Forge-hosted storage adapters for sections, bindings, ACLs, content versions and audit. Prefer Forge SQL after verifying limitations: row/response sizes, quotas, transactions/constraints, schema deployments and concurrent updates. Use installation-local isolation. Tables/entities: sections, section_bindings, permission_grants, content_revisions, audit_events, schema_migrations; optional outbox only if provably supported. Include IDs, page ID, space ID, macro/local ID where trustworthy, creator/owner, timestamps, soft deletion, schema version, optimistic concurrency tokens. No secrets inside macro configs. Use appropriate parameterization, indices, bounded queries, paginated audit reads and race-safe initialization/ACL updates. Document how unsupported SQL constraints are enforced at application level. Run storage integration tests where possible and deterministic fake-adapter contract tests. Proceed to PROMPT 04.

# PROMPT 04 — Identity, page access and RBAC

Implement a single centralized server-side authorization service. Derive user and installation identity from authenticated Forge resolver context, never from UI-provided context. Verify user permission to view the actual Confluence page through official APIs with the correct asUser semantics where supported; investigate edge cases for anonymous users, restrictions, changes and privileged app access. Resolve Atlassian users and groups server-side, with minimal scopes and safe error handling. VIEW < MODIFY < ADMINISTER. Combine direct grants and group grants using highest role; no deny overrides unless explicitly designed and tested. Require EDIT entitlement at section level for writing and enforce necessary Confluence page rights separately; document how this interacts with a user having section MODIFY but not page edit rights. Implement protection against cross-tenant, cross-page and cross-section IDOR. Expose typed resolver methods; return generic denial responses. Create table-driven authorization tests, including permission revocation and API errors. Proceed to PROMPT 05.

# PROMPT 05 — Section lifecycle and macro binding

Build a secure create/view/bind lifecycle for macros. Investigate draft creation, published pages, reloading, macro duplication within one page, copy to different page/space, import, export, move, page deletion, restore and section owner changes. Never assume client-supplied section ID proves authority. Ensure newly inserted macros cannot hijack existing content; existing IDs are bound to verified page/macro identity, with safe duplicate behavior and explicit copy policy. Until a copy operation is authorized, render an unconfigured placeholder rather than referencing original secret content. Implement idempotent creation, stable state transitions, failure recovery, stale/orphan cleanup with retention and no accidental data deletion. Add scenario tests, including two same-page instances and malicious parameter substitution. Proceed to PROMPT 06.

# PROMPT 06 — Protected viewer and rich-text editor

Build polished responsive React UI for inserting and reading protected content with distinct loading, empty, denied, corrupted, revoked, unconfigured and unavailable states. Implement a Tiptap rich-text editor if compatible with Forge Custom UI security rules; use an approved alternative otherwise and document it. Start with paragraphs, headings, lists, links, bold/italic, quotes, code blocks and tables if stable. Disallow arbitrary HTML and unsafe URL schemes; render with strict sanitization and Content Security Policy constraints. Do not persist secret content in Confluence page body, browser localStorage, URLs or analytics. Autosave only if safe; otherwise provide Save/Cancel with unsaved-change guard. Implement secure server reads/writes and concurrent edit conflict UX. Provide keyboard support, accessibility tests and screenshot tests where feasible. Proceed to PROMPT 07.

# PROMPT 07 — Permission administration

Implement an ADMINISTER-only permission manager within the macro: search Atlassian users/groups using the official APIs and granted scopes, distinguish principals, add/update/remove grants and view effective roles. Show granular VIEW, MODIFY, ADMINISTER assignments. Server revalidates ADMINISTER for every mutation and validates principal identity and tenant relevance. Prevent removal of the final administrator with race-resistant enforcement, and design an explicit administrative recovery process with separate, strongly verified authority. Add confirmation for risky changes and visible success/failure states. Expose permission change history without leaking secret content to unauthorized users. Test impersonation, role escalation, group inheritance, race conditions and revoked access. Proceed to PROMPT 08.

# PROMPT 08 — Revision history, auditing and retention

Implement versioned content updates with author, timestamp and optimistic version checks. Authorized editors may inspect and restore prior content versions; restores create a new version. Define who can see audit vs content revisions and enforce separately. Record metadata for create, edit, restore, grant, revoke, owner change, denied access where appropriate, and delete. Never log content bodies, raw tokens or excessive personal data. Do not falsely call logs immutable if the underlying storage cannot guarantee immutability; document audit tamper-resistance limitations. Establish configurable retention, privacy deletion/export feasibility and restoration procedures. Test conflict resolution, history access and data cleanup. Proceed to PROMPT 09.

# PROMPT 09 — Advanced security verification

Create comprehensive security tests and a threat-model verification matrix. Cover IDOR; client context tampering; resolver authorization; cross-installation isolation; page restrictions; group removal; privileged admins; token/session expiry; edit without page edit permission; stored/reflected XSS; macro config manipulation; copied or duplicated pages; unpublish/draft history; export/PDF/email/notification/index leakage; browser cache; race conditions on ACL grants; final-admin rule; orphan recovery; oversized payloads; malformed editor JSON; denial of service and quotas. Distinguish tests possible offline from those requiring real Confluence. Write a reproducible adversarial test checklist for a site admin and users from at least three different groups. No critical security tests may be waived merely to hit a milestone. Fix bugs and update docs/SECURITY.md. Proceed to PROMPT 10.

# PROMPT 10 — User experience, onboarding and administration

Refine UI to feel native in Confluence: insertion instructions, first-use wizard, keyboard accessibility, effective permission explanation, safe copy warning, permission request guidance (without granting access), help and troubleshooting. Provide an installation configuration guide for site admins, minimal permission/scopes rationale, uninstall/data retention disclosure and an optional admin diagnostics screen that never exposes secrets. Responsive and dark/light modes. Internationalization infrastructure with English baseline and Spanish translation. Error copy must be actionable and not reveal protected content. Add realistic seeded fixtures containing no real secrets. Proceed to PROMPT 11.

# PROMPT 11 — Integration testing, operational readiness and CI

Build an end-to-end QA matrix with local tests and real Confluence test-site tests (where account/site available). Verify macros in page view, editor, copied page, permissions, audit, revisions, and different Atlassian groups. Set up CI for lint, typecheck, tests, dependency audit, static scans, generated build, and Forge lint if credentials/tool environment permit. Document Forge usage/cost estimations and current Forge SQL quotas, per-install storage bounds, query/rate performance, privacy/data residency constraints and backup/recovery. Test migration/upgrade path and realistic tenant datasets within quota. Produce docs/OPERATIONS.md, docs/DEPLOYMENT.md, docs/QA_MATRIX.md and a rollback strategy. For any test requiring unavailable authorization or site, mark `NOT EXECUTED` and provide exact commands and manual acceptance steps; don't claim success. Proceed to PROMPT 12.

# PROMPT 12 — Marketplace-ready package and final quality gate

Prepare all material required for eventual Atlassian Marketplace listing: name/tagline/feature descriptions, customer user guide, installation documentation, screenshots capture plan, support policy, privacy policy DRAFT, EULA DRAFT, data handling overview, requested scopes rationale, vulnerability disclosure process, changelog, release notes, licensing strategy including free vs paid decision and entitlement enforcement design. Verify current Marketplace and Forge listing policies; keep commercial claims factual and flag legal/business review items. Do not enable commercial licensing, distribute publicly or publish without explicit human approval. Run final unit/integration/security/quality checks and attempt Forge development deployment only if designated credentials/site permissions are present. Create docs/FINAL_REPORT.md with verified outcomes, blockers, remaining human approvals and release recommendation: NOT READY / INTERNAL TEST / MARKETPLACE CANDIDATE. Commit finished deliverables and summarize exact next actions.

# PROMPT RESUME — After any interruption

You are continuing the Secure Sections for Confluence autonomous build. Inspect repository status and read `Secure_Sections_AI_Autonomous_Prompts.md`, `docs/PROGRESS.md`, `docs/TASKS.md`, `docs/BLOCKERS.md`, `docs/SECURITY.md` and recent commits. Identify the earliest incomplete phase from PROMPT 01–12, verify current build/test status, and continue autonomously under the same global contract. Do not redo finished work unnecessarily. Never assume prior uncommitted actions completed, and never fabricate passing tests, deployment or external approval. Stop only at true external permission gates or unresolved security blockers; otherwise continue through all phases.

# PROMPT AUDIT — Independent second-agent security review (recommended)

Act as an independent adversarial AppSec reviewer. Review this entire Secure Sections for Confluence repository against its stated security claims and the latest official Atlassian Forge documentation. Assume attackers have page read/edit access but no protected-section grants, and can tamper with all client-side values and macro parameters. Prioritize cross-page copies, macro local IDs, resolver context trust, asApp/asUser permission confusion, group-resolution failures, broken object-level authorization, accidental leaks through Confluence APIs/exports, race conditions, SQL consistency, XSS, cache and history. For every finding provide severity, affected files, exploit preconditions, reproduction, verified impact, fix and regression test. Run applicable tests. Fail the review if the implementation lacks proof for a critical security property; do not mark as passed on code inspection alone.

# Human-gated tasks checklist

- Atlassian developer account + Forge authentication and ownership.
- Development/test Confluence Cloud site with users/groups and site-admin consent.
- Approval for scopes/permissions, any paid Forge consumption and external deployments.
- Human security testing with real users and copy/export scenarios.
- Privacy policy and legal review, vendor/Marketplace account setup and commercial pricing.
- Production distribution, listing submission and Marketplace approval.

## Primary official references

- https://developer.atlassian.com/platform/forge/function-reference/nodejs-runtime/
- https://developer.atlassian.com/platform/forge/manifest-reference/modules/macro/
- https://developer.atlassian.com/platform/forge/app-context-security/
- https://developer.atlassian.com/platform/forge/storage-reference/sql/
- https://developer.atlassian.com/platform/forge/storage-reference/sql-api/
- https://developer.atlassian.com/platform/forge/distribute-your-apps/
- https://developer.atlassian.com/platform/marketplace/listing-forge-apps/
- https://developer.atlassian.com/platform/forge/security/
