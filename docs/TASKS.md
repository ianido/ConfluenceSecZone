# Tasks

`[x]` done and evidenced in docs/PROGRESS.md. `[ ]` open. Items marked (HUMAN) need people or credentials.

## Phase checklist

- [x] P00 Operating contract and repo conventions
- [x] P01 Research, architecture, threat model (docs: PLATFORM_FINDINGS, REQUIREMENTS, ARCHITECTURE, SECURITY, ADRS)
- [x] P02 Forge skeleton and quality (manifest, workspaces, ESLint, Prettier, strict TS, CI, dependabot) ; `forge lint` blocked (B-001)
- [x] P03 Storage and consistency (Store port, KVS adapter, memory store, transactions, optimistic concurrency)
- [x] P04 Identity, page access and RBAC
- [x] P05 Section lifecycle and binding
- [x] P06 Viewer and rich-text editor
- [x] P07 Permission administration
- [x] P08 Revisions, audit, retention, privacy
- [x] P09 Security verification and matrix (offline part); real-site part open (B-002..B-004)
- [x] P10 UX, onboarding, i18n (en/es), diagnostics
- [x] P11 QA matrix, CI, operations, deployment, rollback (documents); real-site execution open
- [x] P12 Marketplace package (drafts) and final gate (docs/FINAL_REPORT.md)

## Open work

### Release blockers (see docs/BLOCKERS.md)

- [ ] (HUMAN) Provision dev site, run spikes S1-S8 and QA matrix B/C
- [ ] (HUMAN) `forge login` + `forge lint` + `forge deploy -e development`
- [ ] (HUMAN) Legal review of privacy policy and EULA; choose licensing model
- [ ] (HUMAN) Independent security review (PROMPT AUDIT)

### Engineering backlog

- [ ] T-OPS-1 Retention sweep pacing for very large estates (batch size or hourly trigger)
- [ ] T-OPS-2 Admin UI for retention settings (currently a meta record)
- [ ] T-REL-1 Schema migration framework and upgrade tests once schema 2 exists
- [ ] T-REL-2 Third-party notices file generated from the lockfile
- [ ] T-SEC-1 Replace `read:content-details:confluence` if `forge lint`/S7 shows it is unnecessary
- [ ] T-SEC-2 Optional: admin export of one account's personal data (supported operation)
- [ ] T-UX-1 Capture final screenshots on a real site
- [ ] T-QA-1 Load test with 200 sections, 500 grants, 150 KB documents (QA-17)
