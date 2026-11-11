// Part of `pnpm lint`: classes the UI never uses, in any source file under apps/ and packages/ (tracked or
// new, not ignored). oxlint has no rule for text inside class strings, so this is a plain search.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const forbidden = [[/\bcursor-not-allowed\b/, 'cursor-not-allowed: use cursor-default (AGENTS.md, "UI rules")']];
const source = /\.(tsx?|jsx?|mjs|cjs|css|html)$/;

const listed = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z', 'apps', 'packages'], {
  cwd: root,
  encoding: 'utf8',
});
if (listed.status !== 0) {
  console.error(`git ls-files failed: ${listed.stderr}`);
  process.exit(1);
}

let failed = false;
for (const file of listed.stdout.split('\0').filter((f) => source.test(f))) {
  let text;
  try {
    text = readFileSync(`${root}/${file}`, 'utf8');
  } catch {
    continue; // listed but deleted in the working tree
  }
  text.split('\n').forEach((line, i) => {
    for (const [re, what] of forbidden) {
      if (re.test(line)) {
        console.error(`${file}:${i + 1}: ${what}`);
        failed = true;
      }
    }
  });
}
if (failed) process.exit(1);
