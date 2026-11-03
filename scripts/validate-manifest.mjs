// Offline manifest validation using Forge's own schema validators (@forge/manifest).
// This is NOT a replacement for `forge lint` (which needs `forge login`); see docs/QA_MATRIX.md.
import { validate } from '@forge/manifest';

const result = await validate();
if (!result.success) {
  console.error('Manifest validation FAILED');
  for (const e of result.errors ?? []) console.error(`- [${e.level ?? 'error'}] ${e.message}`);
  process.exit(1);
}
for (const w of result.warnings ?? []) console.warn(`warning: ${w.message}`);
console.log('Manifest validation passed (offline schema validators).');

// Product policy checks (repository-specific, on top of the schema): Forge-only, minimal surface.
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

const m = parse(readFileSync(new URL('../manifest.yml', import.meta.url), 'utf8'));
const problems = [];
if (m.app?.runtime?.name !== 'nodejs24.x') problems.push('runtime must be nodejs24.x');
if (m.remotes) problems.push('remotes (Forge Remote) are not allowed');
if (m.permissions?.external) problems.push('external egress permissions are not allowed');
if (m.connectModules || m.app?.connect) problems.push('Connect modules are not allowed');
if (m.permissions?.content) problems.push('CSP/content permissions must not be loosened');
for (const mac of m.modules?.macro ?? []) {
  if (mac.config || mac.parameters)
    problems.push(`macro ${mac.key} must not declare config/parameters`);
}
const scopes = new Set(m.permissions?.scopes ?? []);
const allowed = new Set([
  'storage:app',
  'report:personal-data',
  'read:confluence-content.permission',
  'read:confluence-user',
  'read:confluence-groups',
  'read:content-details:confluence',
  'read:content.restriction:confluence',
]);
for (const s of scopes)
  if (!allowed.has(s))
    problems.push(`unexpected scope ${s} (see docs/marketplace/SCOPES_RATIONALE.md)`);
if (
  !/^ari:cloud:ecosystem::app\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
    m.app?.id ?? '',
  )
) {
  problems.push('app.id must be a well-formed Forge app ARI (ari:cloud:ecosystem::app/<uuid>)');
}
if (problems.length) {
  console.error('Manifest policy FAILED:\n- ' + problems.join('\n- '));
  process.exit(1);
}
console.log('Manifest policy checks passed.');
