// Part of `pnpm lint`: mutators never replace a row. INSERT OR REPLACE (or
// REPLACE INTO) deletes the row it conflicts with without firing the delete
// triggers, so the client's undo log keeps no pre-image of it and a rebase
// would lose the row (packages/core/src/sync-sql.ts). Upserts are fine.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Every .ts file under packages/core/src/mutators/, so a new domain file is checked too.
const dir = fileURLToPath(new URL('../packages/core/src/mutators/', import.meta.url));
const files =
  process.argv.length > 2
    ? process.argv.slice(2)
    : readdirSync(dir, { recursive: true })
        .filter((f) => f.endsWith('.ts'))
        .map((f) => join(dir, f));
if (!files.length) {
  console.error(`no mutator files found in ${dir}`);
  process.exit(1);
}
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
