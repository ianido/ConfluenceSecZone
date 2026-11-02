#!/usr/bin/env bash
# Applies the repository protection policy (docs/REPOSITORY_PROTECTION.md) with the GitHub CLI.
# Run it yourself as a repository admin: `gh auth login` first. Safe to re-run (rulesets are updated by name).
# Usage: scripts/apply-repo-protection.sh [--dry-run] [owner/repo]
set -u

DRY=0
if [ "${1:-}" = "--dry-run" ]; then DRY=1; shift; fi
REPO="${1:-ianido/ConfluenceSecZone}"
DIR="$(cd "$(dirname "$0")/.." && pwd)/.github/rulesets"
FAILED=0

run() {
  local label="$1"; shift
  if [ "$DRY" = 1 ]; then echo "[dry-run] $label: gh $*"; return 0; fi
  if out=$(gh "$@" 2>&1); then echo "OK    $label"; else echo "FAIL  $label: $(echo "$out" | head -n 2 | tr '\n' ' ')"; FAILED=1; fi
}

apply_ruleset() {
  local file="$1" name id=""
  name=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["name"])' "$file")
  if [ "$DRY" = 0 ]; then
    id=$(gh api "repos/$REPO/rulesets" --jq ".[] | select(.name==\"$name\") | .id" 2>/dev/null || true)
  fi
  if [ -n "$id" ]; then
    run "ruleset $name (update)" api -X PUT "repos/$REPO/rulesets/$id" --input "$file"
  else
    run "ruleset $name (create)" api -X POST "repos/$REPO/rulesets" --input "$file"
  fi
}

apply_ruleset "$DIR/protect-main.json"
apply_ruleset "$DIR/protect-release-tags.json"

run "merge settings: squash only" api -X PATCH "repos/$REPO" \
  -F allow_squash_merge=true -F allow_merge_commit=false -F allow_rebase_merge=false -F allow_auto_merge=false

run "secret scanning + push protection + dependabot security updates" api -X PATCH "repos/$REPO" \
  --input - <<'JSON'
{"security_and_analysis":{"secret_scanning":{"status":"enabled"},"secret_scanning_push_protection":{"status":"enabled"},"dependabot_security_updates":{"status":"enabled"}}}
JSON

run "dependabot alerts" api -X PUT "repos/$REPO/vulnerability-alerts"
run "private vulnerability reporting" api -X PUT "repos/$REPO/private-vulnerability-reporting"
run "workflow token read-only, no PR approval by Actions" api -X PUT "repos/$REPO/actions/permissions/workflow" \
  -f default_workflow_permissions=read -F can_approve_pull_request_reviews=false
run "fork PR workflows need approval (all outside contributors)" api -X PUT \
  "repos/$REPO/actions/permissions/fork-pr-contributor-approval" -f approval_policy=all_external_contributors

echo
echo "Manual steps that cannot be scripted: two-factor authentication and a signing key on your account."
[ "$FAILED" = 0 ] || { echo "Some steps failed (see above). Check your admin permission and re-run."; exit 1; }
