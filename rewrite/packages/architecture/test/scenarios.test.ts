// docs/scenarios.md names the e2e tests that run each scenario of the app; this keeps it true: every test it names
// exists, every scenario names one, and every journey is in it.
import { describe, expect, it } from 'vitest';
import { DOCS, FILES } from './source.ts';

const TABLE = 'docs/scenarios.md';
const E2E = 'apps/desktop/e2e/';

/** A reference in the table: `file.spec.ts`: "the start of a test's title". */
const REFERENCE = /`([\w-]+\.spec\.ts)`: "((?:[^"\\]|\\.)*)"/g;
const TITLE = /^test(?:\.\w+)?\((['"])((?:\\.|(?!\1).)*)\1/gm;

const unescape = (s: string) => s.replace(/\\(.)/g, '$1');

/** The titles of the tests in an e2e spec. */
function titles(file: string): string[] {
  const f = FILES.find((x) => x.path === `${E2E}${file}`);
  return f ? [...f.lines.join('\n').matchAll(TITLE)].map((m) => unescape(m[2]!)) : [];
}

const rows = () =>
  DOCS.find((d) => d.path === TABLE)!
    .text.split('\n')
    .filter((line) => line.startsWith('| ') && !line.startsWith('| Scenario') && !line.startsWith('| ---'));

describe('the scenario table', () => {
  it('names only tests that exist, by their file and the start of their title', () => {
    const refs = rows().flatMap((row) => [...row.matchAll(REFERENCE)].map((m) => ({ file: m[1]!, start: unescape(m[2]!) })));
    const missing = refs.filter(({ file, start }) => !titles(file).some((t) => t.startsWith(start)));

    expect(refs.length).toBeGreaterThan(0);
    expect(missing.map((m) => `${m.file}: "${m.start}"`)).toEqual([]);
  });

  it('gives every scenario at least one test', () => {
    expect(rows().filter((row) => ![...row.matchAll(REFERENCE)].length)).toEqual([]);
  });

  it('lists every journey', () => {
    const table = DOCS.find((d) => d.path === TABLE)!.text;
    const unlisted = titles('journeys.spec.ts').filter((t) => ![...table.matchAll(REFERENCE)].some((m) => m[1] === 'journeys.spec.ts' && t.startsWith(unescape(m[2]!))));

    expect(unlisted).toEqual([]);
  });
});
