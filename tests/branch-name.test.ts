import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM script without type declarations
import { BRANCH_NAME_PATTERN, BRANCH_NAME_REGEX } from '../scripts/branch-name-pattern.mjs';

const valid = [
  'main',
  'dev',
  'feat/add-audit-export',
  'feat/12-add-audit-export',
  'fix/null-check',
  'fix/7-null-check',
  'fix/abc-123',
  'hotfix/301-leak.in-export',
  'refactor/9-split_service',
  'release/1.2.0',
  'chore/update-deps',
  'docs/readme-contributing',
  'test/e2e-keyboard',
  'ci/cache-npm',
  'build/vite-8',
];

const invalid = [
  'master',
  'feat/-12-x',
  'feature/12-x',
  'Feat/12-x',
  'chore/',
  'chore/-x',
  'docs/with space',
  'release/1.2.0/extra',
  'cursor/secure-sections-forge-build-18af',
  'dependabot/npm_and_yarn/vite-8',
  'main/extra',
  '',
];

describe('branch naming standard', () => {
  it.each(valid)('accepts %s', (name) => {
    expect(BRANCH_NAME_REGEX.test(name)).toBe(true);
  });

  it.each(invalid)('rejects %j', (name) => {
    expect(BRANCH_NAME_REGEX.test(name)).toBe(false);
  });

  it('is the same pattern the branch-name workflow enforces', () => {
    const workflow = readFileSync('.github/workflows/branch-name.yml', 'utf8');
    expect(workflow).toContain(BRANCH_NAME_PATTERN);
  });

  it('matches the pattern in the documented ruleset', () => {
    const ruleset = JSON.parse(readFileSync('.github/rulesets/branch-naming.json', 'utf8')) as {
      rules: { parameters: { pattern: string } }[];
    };
    expect(ruleset.rules[0]?.parameters.pattern).toBe(BRANCH_NAME_PATTERN);
  });
});
