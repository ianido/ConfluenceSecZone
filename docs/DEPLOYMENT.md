# Deployment, upgrade and rollback

**Human approval required.** This repository's automation never deploys. Nothing here has been executed against
Forge because no credentials or development site were available (docs/BLOCKERS.md B-001, B-002).

## Environments

| Environment | Purpose                                     | Who may deploy                               |
| ----------- | ------------------------------------------- | -------------------------------------------- |
| development | Developer testing on a dedicated dev site   | Developer with Forge login                   |
| staging     | Pre-release checks on a dedicated site      | Release owner                                |
| production  | Customers (only after Marketplace approval) | Release owner with explicit written approval |

## Pre-deploy checklist

1. `npm ci && npm run verify && npm run test:e2e && npm run audit:deps` all green on the commit to release.
2. `forge lint` clean (needs `forge login`).
3. Review `manifest.yml` diff: **any new scope, module, egress or storage entity changes require a major version
   and admin re-consent**. This product's policy check (`npm run validate:manifest`) enumerates allowed scopes.
4. docs/QA_MATRIX.md sections B and C executed on the target environment, results attached to the release.
5. Changelog and release notes updated.

## Deploy (development)

```bash
npm run build
forge deploy -e development
forge install --upgrade -e development -p Confluence -s <dev-site>.atlassian.net   # only when scopes changed
```

## Upgrade path and migrations

- Records carry `schema` (currently 1). Readers must tolerate older versions; writers write the newest.
- Additive changes (new optional fields, new meta keys) deploy as a minor version with no migration.
- Breaking storage changes require: a read path for the old shape, a resumable migration in `maintenance`
  (cursor stored in `meta`), a feature flag record in `meta`, and a rollback-safe window of two releases before
  the old read path is removed.
- Declaring additional entities, attributes or indexes in the manifest requires a deploy and may require major
  version consent. We keep a single entity `ssdoc` precisely to avoid this.
- **Migration tests**: not yet implemented because there is only schema 1 (T-REL-1).

## Rollback strategy

| Situation                                     | Action                                                                                                                                                                                                        |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bad UI or resolver logic, no storage change   | `forge deploy` the previous tag in the same environment; Forge versions the deployment. Verify with QA-01 to QA-03.                                                                                           |
| Bad deploy with storage writes of a new shape | Previous version must still read the new shape (additive rule); if not, ship a forward fix, do not delete data.                                                                                               |
| Security bug                                  | Ship a fix; if exposure is possible, treat as an incident (disclosure policy) and notify affected customers through Marketplace channels. Because the app cannot disable itself, a fast patch is the control. |
| Scope or manifest regression                  | Cannot be rolled back without consent flows; revert to the last major version's manifest and deploy; admins may be asked to re-consent.                                                                       |

Data is never deleted by a rollback. There is no destructive migration.

## Production gate (all required)

- QA matrix B and C executed with no leaks and results archived.
- Security review by a person other than the author (PROMPT AUDIT in the playbook is recommended).
- Marketplace listing approved (docs/marketplace/LISTING.md) and legal documents approved (DRAFTS today).
- Written approval from the release owner.
