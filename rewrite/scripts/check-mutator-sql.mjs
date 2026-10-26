// Part of `pnpm lint`: mutators never replace a row. INSERT OR REPLACE (or
// REPLACE INTO) deletes the row it conflicts with without firing the delete
// triggers, so the client's undo log keeps no pre-image of it and a rebase
// would lose the row (packages/core/src/sync-sql.ts). Upserts are fine.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const files = process.argv.length > 2 ? process.argv.slice(2) : [fileURLToPath(new URL('../packages/core/src/mutators.ts', import.meta.url))];
const forbidden = [
  [/\bOR\s+REPLACE\b/i, 'INSERT OR REPLACE'],
  [/\bREPLACE\s+INTO\b/i, 'REPLACE INTO'],
  [/\.onConflictReplace\b|\.orReplace\b/, 'a replacing insert'],
];

let failed = false;
for (const file of files) {
  // Comments may name what they forbid; code may not. Keeps line numbers.
  const code = readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '))
    .replace(/\/\/.*$/gm, '');
  code.split('\n').forEach((line, i) => {
    for (const [re, what] of forbidden) {
      if (re.test(line)) {
        console.error(`${file}:${i + 1}: ${what} in a mutator: use an upsert (onConflictDoUpdate) or select, then insert or update`);
        failed = true;
      }
    }
  });
}
if (failed) process.exit(1);
