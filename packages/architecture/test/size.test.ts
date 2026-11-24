// Files short enough to read whole: a long file is split by what its parts do.
import { describe, expect, it } from 'vitest';
import { FILES, type Kind } from './source.ts';

const MAX_LINES: Record<Kind, number> = { source: 500, test: 800 };

/** Tables, not logic: every UI text in two languages, and every icon's SVG paths. */
const TABLES = new Set(['apps/web/src/i18n.ts', 'apps/web/src/ui/icons.tsx']);

const tooLong = (kind: Kind) =>
  FILES.filter((f) => f.kind === kind && !TABLES.has(f.path) && f.lines.length > MAX_LINES[kind]).map((f) => `${f.path}: ${f.lines.length} lines`);

describe('file length', () => {
  it(`keeps every source file within ${MAX_LINES.source} lines`, () => {
    expect(tooLong('source')).toEqual([]);
  });

  it(`keeps every test file within ${MAX_LINES.test} lines`, () => {
    expect(tooLong('test')).toEqual([]);
  });

  it('exempts only tables that exist', () => {
    expect([...TABLES].filter((path) => !FILES.some((f) => f.path === path))).toEqual([]);
  });
});
