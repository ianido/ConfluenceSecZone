# Secure Sections for Confluence

A Forge-only Confluence Cloud macro for confidential rich-text sections with their own permissions
(VIEW < MODIFY < ADMINISTER), independent of page permissions. Data stays in Forge-hosted storage; no external servers.

**Status: internal test candidate. Not production ready.** Real-site verification is pending, see
[docs/FINAL_REPORT.md](docs/FINAL_REPORT.md) and [docs/BLOCKERS.md](docs/BLOCKERS.md).

```bash
npm ci
npm run verify       # lint, typecheck, tests, build, manifest checks
npm run test:e2e     # UI tests in Chromium against an in-memory harness (not Forge)
```

Start with [docs/SETUP.md](docs/SETUP.md). Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Security model and
verification matrix: [docs/SECURITY.md](docs/SECURITY.md). Platform facts and open spikes:
[docs/PLATFORM_FINDINGS.md](docs/PLATFORM_FINDINGS.md). QA checklist: [docs/QA_MATRIX.md](docs/QA_MATRIX.md).

The repository intentionally contains a placeholder Forge app id and no credentials.
