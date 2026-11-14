// Each package's public API as a file in the repo (as tldraw keeps an API report): a change to what a package
// exports shows in the diff, to be read on purpose. After a deliberate change: `pnpm --filter @gp/architecture test -u`.
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from './source.ts';

/** The packages others import, with the entry each `exports` field names. */
const PACKAGES = ['packages/core', 'packages/rust-core', 'packages/sync', 'apps/server'];

const DECLARED = /^export\s+(?:declare\s+)?(?:async\s+)?(function\*?|const|let|class|abstract class|interface|type|enum)\s+(\w+)/gm;
const LISTED = /^export\s+(type\s+)?\{([^}]*)\}(?:\s+from\s+'([^']+)')?/gm;
const ALL = /^export\s+\*\s+(?:as\s+(\w+)\s+)?from\s+'([^']+)'/gm;

/** What a module exports, `name (kind)`, following `export * from` into the modules it names. */
function exportsOf(path: string, seen = new Set<string>()): string[] {
  if (seen.has(path)) return [];
  seen.add(path);
  const text = readFileSync(`${ROOT}/${path}`, 'utf8');
  const out = [...text.matchAll(DECLARED)].map((m) => `${m[2]} (${/interface|type/.test(m[1]!) ? 'type' : m[1]!.replace('abstract ', '').replace('*', '')})`);
  for (const m of text.matchAll(LISTED)) {
    for (const part of m[2]!.split(',').map((p) => p.trim()).filter(Boolean)) {
      const type = !!m[1] || part.startsWith('type ');
      const name = part.replace(/^type\s+/, '').split(/\s+as\s+/).at(-1)!;
      out.push(`${name} (${type ? 'type' : 're-export'})`);
    }
  }
  for (const m of text.matchAll(ALL)) {
    out.push(...(m[1] ? [`${m[1]} (namespace)`] : exportsOf(posix.join(posix.dirname(path), m[2]!), seen)));
  }
  return out;
}

/** The code entries of a package's `exports`, by the name others import (not a built file such as the Rust core's WASM). */
function entries(pkg: string): [string, string][] {
  const json = JSON.parse(readFileSync(`${ROOT}/${pkg}/package.json`, 'utf8')) as { name: string; exports: Record<string, string> };
  return Object.entries(json.exports)
    .filter(([, file]) => file.endsWith('.ts'))
    .map(([key, file]) => [posix.join(json.name, key), posix.join(pkg, file)]);
}

describe('public API', () => {
  it.each(PACKAGES)('of %s matches its report', async (pkg) => {
    const report = entries(pkg)
      .map(([name, file]) => [`## ${name}`, ...[...new Set(exportsOf(file))].toSorted()].join('\n'))
      .join('\n\n');

    await expect(`${report}\n`).toMatchFileSnapshot(`../api/${pkg.split('/')[1]}.api.md`);
  });
});
