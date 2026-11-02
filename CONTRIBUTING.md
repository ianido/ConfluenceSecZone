# Contributing

Thanks for helping. Every change reaches `main` through a pull request that the maintainer ([@ianido](https://github.com/ianido))
reviews and approves. Nobody, including the maintainer, pushes directly to `main`.

## How to contribute

1. **Open an issue first** for anything beyond a typo. Use the bug or feature template. Security problems go through
   the private form in [SECURITY.md](SECURITY.md), never a public issue.
2. **Fork** the repository (external contributors) or create a branch (collaborators).
3. **Create a branch** that follows the naming standard below. Issue numbers are optional in `feat`, `fix`, `hotfix`
   and `refactor` branch names.
4. **Set up and verify** locally (Node 24, npm 10+):

   ```bash
   npm ci
   npm run verify       # lint, typecheck, tests, build, manifest checks
   npm run test:e2e     # when you touch the UI
   npm run check:branch # validates your branch name
   ```

5. **Commit with signed commits** (GitHub shows "Verified"). Keep commits focused; the PR is squash-merged, so its
   title becomes the commit message on `main`. Write it in the imperative, for example `Add audit export placeholder`.
6. **Open a pull request** against `main` and fill in the template. Mark it as a draft until CI is green.
7. **Respond to review.** Pushing new commits dismisses earlier approvals, and every review conversation must be
   resolved before merge.

## Branch names

Allowed names (enforced by the `branch-name` CI check, which is a required check):

| Pattern                                                       | Use                          | Example                    |
| ------------------------------------------------------------- | ---------------------------- | -------------------------- |
| `main`, `dev`                                                 | Long-lived branches          |                            |
| `feat/<description>`                                          | New behaviour                | `feat/add-audit-export`    |
| `fix/<description>`                                           | Bug fix                      | `fix/null-check`           |
| `hotfix/<description>`                                        | Urgent production fix        | `hotfix/export-leak`       |
| `refactor/<description>`                                      | No behaviour change          | `refactor/split-service`   |
| `release/<description>`                                       | Release preparation          | `release/1.2.0`            |
| `chore/`, `docs/`, `test/`, `ci/`, `build/` + `<description>` | Maintenance, no issue needed | `docs/readme-contributing` |

Issue numbers may optionally prefix the description in `feat`, `fix`, `hotfix` and `refactor` names (for example,
`feat/12-audit-export`). `<description>` starts with a letter or digit and then uses letters, digits, `.`, `_` or `-`.
The exact regular expression lives in `scripts/branch-name-pattern.mjs`:

```
^(main|dev|((feat|fix|hotfix|refactor)\/[a-zA-Z0-9][a-zA-Z0-9._-]*)|(release|chore|docs|test|ci|build)\/[a-zA-Z0-9][a-zA-Z0-9._-]*)\n?$
```

Dependabot branches are exempt because Dependabot cannot rename them.

## What a pull request must satisfy

- All required checks pass: `verify`, `ui-e2e`, `secrets-scan`, `codeql`, `branch-name`.
- At least one approval from a code owner (see [.github/CODEOWNERS](.github/CODEOWNERS)), given after your last push.
- The branch is up to date with `main`, history stays linear, and the PR is squash-merged.
- No new Forge scope, module, egress or storage entity without a written justification
  (see [docs/marketplace/SCOPES_RATIONALE.md](docs/marketplace/SCOPES_RATIONALE.md)). Such changes need a major version.
- No secrets, tokens, customer data or personal data anywhere, including tests, screenshots and logs.
- Tests for the behaviour you change, and updated docs and [CHANGELOG.md](CHANGELOG.md) when behaviour or setup changes.

The maintainer may ask for changes, close a PR that does not fit the project's direction, or decline to merge it.

## Forge app credentials

Never commit tokens. To try the app on your own Atlassian site, follow [docs/SETUP.md](docs/SETUP.md): you register
your own app with `forge register`, which replaces `app.id` in your working copy. Do not send that change in a PR.

## License of contributions

By submitting a contribution you agree that it is licensed under the repository's [MIT license](LICENSE).
Please follow the [code of conduct](CODE_OF_CONDUCT.md).
