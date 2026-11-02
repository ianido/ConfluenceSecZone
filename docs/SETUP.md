# Setup and local development

## Prerequisites

- Node.js 24 (`.nvmrc`; the package accepts >= 22.12 for local tooling, the Forge runtime is `nodejs24.x`).
- npm 10+ (workspaces). No pnpm.
- For deployment only: an Atlassian developer account, Forge CLI (`npm i -g @forge/cli`, a dev dependency is also installed locally) and a **dedicated Confluence Cloud development site**.

## Install and verify (no credentials needed)

```bash
npm ci
npm run verify          # lint + prettier, typecheck (all workspaces), unit/integration/security tests, build, manifest checks
npm run test:e2e        # UI tests in headless Chromium against the in-memory harness (first run: npx playwright install chromium)
npm run audit:deps      # production dependency audit
```

What each script does:

| Script                      | Purpose                                                                                                                |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `npm run lint`              | ESLint (strict TS, jsx-a11y, react-hooks, banned APIs) and `prettier --check`                                          |
| `npm run typecheck`         | `tsc` for backend, shared, macro-ui and e2e                                                                            |
| `npm test`                  | builds shared, runs Vitest projects `backend` (domain, resolvers, security matrix, shared) and `macro-ui` (jsdom, axe) |
| `npm run build`             | shared + UI production build + bundle guard (no eval, storage APIs, external URLs, duplicate ProseMirror)              |
| `npm run validate:manifest` | Forge manifest schema (`@forge/manifest`) and repository policy checks. Not a replacement for `forge lint`             |
| `npm run forge:lint`        | `forge lint`: requires `forge login` (passed on 2026-11-01)                                                            |

## Local development without Confluence

`npm run dev -w @secure-sections/macro-ui` starts the production entry (needs the Forge bridge, so it only renders states inside Confluence). To iterate on the UI use the harness:

```bash
npx vite --config static/macro-ui/vite.harness.config.ts
# open http://localhost:5199/?actor=alice            (alice: author, bob: page editor without grant, erin: page viewer)
# ?actor=bob&locale=es  ?page=2002&local=<uuid> to simulate a copied macro
# http://localhost:5199/__reset resets the in-memory world
```

The harness runs the real resolver handlers and domain service in the Vite process on an in-memory store and a fake Confluence. It is for development and UI tests only; it is not Forge and not security evidence about Forge.

## Provisioning your own Forge app (human steps)

`manifest.yml` carries the app id registered for this project (Aviva Credito Dev Developer Space). The id is an identifier, not a credential, but another developer deploying from this repository must run `forge register` in their own account, which replaces it. Never commit any token.

1. `forge login` (Atlassian account email + API token created at https://id.atlassian.com/manage-profile/security/api-tokens; the token is entered interactively or via `FORGE_EMAIL`/`FORGE_API_TOKEN` environment variables, never in files).
2. `forge register "Secure Sections (dev)"`: this rewrites `app.id` in `manifest.yml` in your working copy. Do not commit that change to the shared repository.
3. `npm run build`
4. `forge lint`
5. `forge deploy -e development`
6. `forge install -e development -p Confluence -s <your-dev-site>.atlassian.net` and approve the scopes listed in docs/marketplace/SCOPES_RATIONALE.md.
7. `forge tunnel` is optional for backend debugging (UI changes need `npm run build` + `forge deploy`).
8. Run the QA matrix (docs/QA_MATRIX.md), starting with the real-site spikes S1 to S8.

Never install on a production or customer site for testing.
