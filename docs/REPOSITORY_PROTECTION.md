# Repository protection policy

Policies normally applied to a public repository that accepts pull requests, and where each one lives. Items marked
**Repo files** are versioned here; items marked **GitHub settings** cannot be stored in the repository and must be
applied once by an admin (steps at the end).

## Policy list

| #   | Policy                                                               | Why                                                                                           | Where                                                          |
| --- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 1   | Changes to `main` and `dev` only through a pull request              | No direct pushes, everything is reviewable                                                    | `.github/rulesets/protect-main.json`                           |
| 2   | At least 1 approval, from a code owner                               | The maintainer approves every contribution                                                    | `protect-main.json` + `.github/CODEOWNERS`                     |
| 3   | New pushes dismiss approvals; last pusher cannot self-approve        | An approved PR cannot be changed afterwards unnoticed                                         | `protect-main.json`                                            |
| 4   | All review conversations resolved before merge                       | Feedback is not lost                                                                          | `protect-main.json`                                            |
| 5   | Required status checks, branch up to date with `main`                | Nothing broken or untested lands: `verify`, `ui-e2e`, `secrets-scan`, `codeql`, `branch-name` | `protect-main-integrity.json`, `.github/workflows/`            |
| 6   | No force pushes, no branch deletion on `main` and `dev`              | History cannot be rewritten or removed                                                        | `protect-main-integrity.json`                                  |
| 7   | Linear history, squash merge only                                    | One reviewed commit per change, easy revert                                                   | `protect-main.json` + `protect-main-integrity.json`            |
| 8   | Signed commits                                                       | Authorship is verifiable                                                                      | Existing `default-rules` ruleset                               |
| 9   | Release tags `v*` cannot be created, moved or deleted by others      | Published versions stay immutable                                                             | `.github/rulesets/protect-release-tags.json`                   |
| 10  | Branch naming standard (regex)                                       | Traceable work, consistent history                                                            | `branch-name.yml` check (+ optional `branch-naming.json`)      |
| 11  | Code owners for security-sensitive paths                             | Manifest, scopes, domain, adapters, CI and dependencies always get owner review               | `.github/CODEOWNERS`                                           |
| 12  | Secret scanning and push protection                                  | Stops committed tokens                                                                        | GitHub settings + `secrets-scan` job                           |
| 13  | Dependabot alerts and version updates                                | Known-vulnerable dependencies are flagged and updated                                         | GitHub settings + `.github/dependabot.yml`                     |
| 14  | Code scanning (CodeQL)                                               | Static analysis on every PR                                                                   | `codeql` job                                                   |
| 15  | Private vulnerability reporting                                      | Security reports do not become public issues                                                  | GitHub settings + `SECURITY.md`                                |
| 16  | Workflows from first-time fork contributors need approval            | Fork PRs cannot burn CI or probe secrets without a look                                       | GitHub settings                                                |
| 17  | Workflow token read-only by default; workflows declare permissions   | Limits damage from a compromised workflow or action                                           | GitHub settings + `permissions:` in workflows                  |
| 18  | Contribution guide, PR and issue templates, code of conduct, license | Sets expectations, filters low-quality contributions                                          | `CONTRIBUTING.md`, `.github/`, `CODE_OF_CONDUCT.md`, `LICENSE` |
| 19  | Two-factor authentication on the owner account                       | A stolen password cannot bypass every rule above                                              | GitHub account settings                                        |
| 20  | Do not store secrets in the repo; app id is an identifier only       | Forge tokens stay out of history                                                              | `secrets-scan`, `docs/SETUP.md`                                |

Recommended later: pin third-party actions to commit SHAs, `SECURITY` advisories for releases, and a `dev`
integration branch if releases need staging (the rules already cover `dev`).

## Owner bypass

A single maintainer cannot approve their own pull request. `protect-main.json` therefore lets the **repository admin
role bypass only through a pull request** (`bypass_mode: pull_request`): the owner still opens a PR and merges it, but
is not blocked by the "1 approval" rule. A bypass applies to every rule of the ruleset it is listed in, so the
rulesets are split on purpose: `protect-main.json` holds only the review rules (bypassable), while
`protect-main-integrity.json` holds required status checks, no force push, no deletion and linear history, with
**no bypass**. The owner can skip the approval, but never a failing or missing CI check. Contributors have no bypass.
If you add another maintainer, remove the bypass entry so every PR needs a second person.

## Branch naming

The standard is the regular expression in [CONTRIBUTING.md](../CONTRIBUTING.md#branch-names). GitHub's native
"restrict branch names" rule with a regex is only available on GitHub Enterprise Cloud organizations, so on a personal
public repository it is enforced by the `branch-name` workflow (a required status check on pull requests, run with `pull_request_target` so the version on `main` is the one that executes and a PR cannot edit or replace it; the same
workflow also fails pushes to wrongly named branches, which a ruleset could not block). If you ever move to an
Enterprise organization, import `.github/rulesets/branch-naming.json` to block such branches at push time (it excludes `dependabot/**`).

Known consequences:

- Dependabot branches (`dependabot/...`) are exempt in the workflow because they cannot be renamed.
- Branches created by automation with other prefixes (for example `cursor/...`) fail the check. Rename them (for
  example `feat/12-...`) or open the PR from a correctly named branch.

## Signed commits and the existing `default-rules` ruleset

The `default-rules` ruleset already requires signed commits and blocks deletion on every branch. Consequences:
unsigned commits are rejected on push; a merge commit or rebase merge of unsigned commits is rejected, which is one reason
`protect-main` allows squash merge only (GitHub signs the squash commit); and merged branches cannot be
auto-deleted while the deletion rule covers all branches. If that is too strict, restrict `default-rules` to
`main` and `dev` or remove the deletion rule.

## Applying the settings

Fastest: as a repository admin run `gh auth login` and then `scripts/apply-repo-protection.sh` (add `--dry-run` to preview).
It imports both rulesets and sets merge, secret scanning, Dependabot, private vulnerability reporting and Actions
settings; it prints OK or FAIL per step and can be re-run. The manual UI steps below are the equivalent.

### Manual steps (GitHub UI, admin)

Rulesets and repository settings are not applied by merging this PR. Do this once:

1. **Rulesets**: Settings, Rules, Rulesets, New ruleset, Import a ruleset. Import `protect-main.json`,
   `protect-main-integrity.json` and `protect-release-tags.json`. Merge the pull request that adds the `branch-name` workflow first, otherwise the
   required `branch-name` check does not exist yet (the first run of a workflow makes its check selectable).
2. **Code security** (Settings, Code security): enable Private vulnerability reporting, Dependency graph,
   Dependabot alerts and security updates, Secret scanning and Push protection, and code scanning (CodeQL is already
   configured in the CI workflow).
3. **Actions** (Settings, Actions, General): Fork pull request workflows: require approval for all outside
   collaborators (or first-time contributors at least); Workflow permissions: read repository contents only; leave
   "Allow GitHub Actions to create and approve pull requests" off.
4. **General**: Pull Requests: allow only squash merging, enable "Always suggest updating pull request branches" and
   "Automatically delete head branches" (see the note above), keep Issues enabled and Discussions optional; Features:
   enable the security policy and community files shown on the Community Standards page.
5. **Account**: enable two-factor authentication and add a signing key (GPG, SSH or S/MIME) so your own commits show
   as verified.
