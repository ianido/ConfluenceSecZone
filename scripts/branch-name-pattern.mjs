// Single source of truth for the branch naming standard. The workflow
// .github/workflows/branch-name.yml embeds the same pattern (checked by tests/branch-name.test.ts).
export const BRANCH_NAME_PATTERN = String.raw`^(main|dev|((feat|fix|hotfix|refactor)\/[a-zA-Z0-9][a-zA-Z0-9._-]*)|(release|chore|docs|test|ci|build)\/[a-zA-Z0-9][a-zA-Z0-9._-]*)\n?$`;

export const BRANCH_NAME_REGEX = new RegExp(BRANCH_NAME_PATTERN);
