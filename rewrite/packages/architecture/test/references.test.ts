// What the code and docs point at exists: a rule of the spec cited by its id, and a file named by its path.
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DOCS, FILES, ROOT, SPEC } from './source.ts';

/** Every text the tests read, by path. */
const TEXTS = [...FILES.map((f) => ({ path: f.path, text: f.lines.join('\n') })), ...DOCS];

describe('references', () => {
  it("cite only the spec's own rule and test ids (LIVE-R43, ORG-A19, E13)", () => {
    const cited = TEXTS.flatMap(({ path, text }) => [...text.matchAll(/\b([A-Z]{2,6}-[ARE]\d+)\b/g)].map((m) => ({ path, id: m[1]! })));
    const unknown = cited.filter(({ id }) => !new RegExp(`\\b${id}\\b`).test(SPEC));

    expect([...new Set(unknown.map((u) => `${u.path}: ${u.id}`))]).toEqual([]);
  });

  it('name only files that exist, by their path from the rewrite', () => {
    const named = TEXTS.flatMap(({ path, text }) => [...text.matchAll(/`((?:apps|packages|docs|scripts)\/[\w./-]+\.(?:ts|tsx|md|mjs|json|toml))`/g)].map((m) => ({ path, file: m[1]! })));
    const missing = named.filter(({ file }) => !existsSync(`${ROOT}/${file}`));

    expect([...new Set(missing.map((m) => `${m.path}: ${m.file}`))]).toEqual([]);
  });
});
