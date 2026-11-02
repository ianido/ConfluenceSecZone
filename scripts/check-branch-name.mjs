import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BRANCH_NAME_REGEX, BRANCH_NAME_PATTERN } from './branch-name-pattern.mjs';

export function checkBranchName(name) {
  return BRANCH_NAME_REGEX.test(name);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const name =
    process.argv[2] ??
    execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim();
  if (checkBranchName(name)) {
    console.log(`Branch name OK: ${name}`);
  } else {
    console.error(
      `Invalid branch name: "${name}"\n` +
        'Allowed: main | dev | (feat|fix|hotfix|refactor)/<issue-number>-<description> | (release|chore|docs|test|ci|build)/<description>\n' +
        `Pattern: ${BRANCH_NAME_PATTERN}`,
    );
    process.exit(1);
  }
}
