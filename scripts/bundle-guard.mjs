import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../static/macro-ui/dist', import.meta.url).pathname;
const banned = [
  { re: /\blocalStorage\b/, why: 'localStorage use' },
  { re: /\bsessionStorage\b/, why: 'sessionStorage use' },
  { re: /\bnew Function\(/, why: 'new Function()' },
  {
    re: /https?:\/\/(?!www\.w3\.org|developer\.atlassian\.com|github\.com|reactjs\.org|react\.dev|tiptap\.dev|prosemirror)[a-z0-9.-]+\.(?:com|io|net)\/[^"'\s]*\.(?:js|css)/i,
    why: 'external script/style URL',
  },
];
const walk = (d) =>
  readdirSync(d).flatMap((f) => {
    const p = join(d, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

const problems = [];
for (const f of walk(root).filter((p) => /\.(js|css|html)$/.test(p))) {
  const txt = readFileSync(f, 'utf8');
  for (const { re, why } of banned) if (re.test(txt)) problems.push(`${f}: ${why}`);
}
// Two copies of prosemirror-model in one bundle break the editor at runtime ("multiple versions").
const js = walk(root).filter((p) => p.endsWith('.js'));
const modelCopies = js.reduce(
  (n, f) =>
    n + (readFileSync(f, 'utf8').match(/multiple versions of prosemirror-model/g) ?? []).length,
  0,
);
if (modelCopies !== 1)
  problems.push(`expected exactly 1 prosemirror-model copy in bundle, found ${modelCopies}`);

if (problems.length) {
  console.error('Bundle guard FAILED:\n' + problems.join('\n'));
  process.exit(1);
}
console.log('Bundle guard OK');
