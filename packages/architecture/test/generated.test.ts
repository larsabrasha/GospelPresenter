// The shells' types generated from the core's view types (crates/gp-core/schema): what is checked in is what the
// generator writes from the schema checked in, so no one edits the generated file by hand. That the schema follows
// the Rust types is crates/gp-core/schema/generate.sh's to keep (it needs cargo, which this test does not run).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../', import.meta.url));

/** Each language the generator writes, and where its output is checked in. */
const OUTPUTS = [
  ['swift', 'apps/mac/Sources/Shell/ViewTypes.swift'],
  ['csharp', 'crates/gp-core/schema/csharp/ViewTypes.cs'],
  ['typescript', 'packages/rust-core/src/view-types.ts'],
] as const;

describe('generated view types', () => {
  for (const [lang, path] of OUTPUTS) {
    it(`are the ${lang} the generator writes from the core's schema`, () => {
      const fresh = execFileSync('node', ['crates/gp-core/schema/generate.mjs', 'crates/gp-core/schema/views.json', lang], { cwd: root, encoding: 'utf8' });

      expect(readFileSync(`${root}${path}`, 'utf8')).toBe(fresh);
    });
  }
});
