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

The repository contains the registered Forge app id of the Aviva Credito Dev app (an identifier, not a credential) and no tokens. Run `forge register` in your own account to deploy your own copy.

## Contributing

Contributions are welcome through pull requests only. Nothing is pushed directly to `main`: every change needs a
passing CI, a signed history and an approval from the maintainer.

1. Open an issue (bug or feature template). Security problems: see [SECURITY.md](SECURITY.md).
2. Fork, then create a branch named `feat/<description>`, `fix/<description>`,
   `hotfix/<description>` or `refactor/<description>` (or `chore/`, `docs/`, `test/`, `ci/`, `build/`,
   `release/` plus a description).
3. Run `npm ci && npm run verify` (and `npm run check:branch`).
4. Open a pull request against `main`, fill in the template and address review comments.

Full guide and the branch name regular expression: [CONTRIBUTING.md](CONTRIBUTING.md). Repository protection rules and
how they are applied: [docs/REPOSITORY_PROTECTION.md](docs/REPOSITORY_PROTECTION.md). Please follow the
[code of conduct](CODE_OF_CONDUCT.md).
