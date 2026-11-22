// The shells' types generated from the core's view types (crates/gp-core/schema): what is checked in is what the
// generator writes from the schema checked in, so no one edits the generated file by hand. That the schema follows
// the Rust types is crates/gp-core/schema/generate.sh's to keep (it needs cargo, which this test does not run).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../', import.meta.url));

describe('generated view types', () => {
  it("are the Swift the generator writes from the core's schema", () => {
    const fresh = execFileSync('node', ['crates/gp-core/schema/generate.mjs', 'crates/gp-core/schema/views.json', 'swift'], { cwd: root, encoding: 'utf8' });

    expect(readFileSync(`${root}apps/mac/Sources/GPMac/ViewTypes.swift`, 'utf8')).toBe(fresh);
  });
});
