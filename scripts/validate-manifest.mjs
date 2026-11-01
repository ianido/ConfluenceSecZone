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
