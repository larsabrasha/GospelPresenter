// Code written once: the same lines in two places drift apart when one of them is fixed. Blank lines, comments,
// imports, lines of only brackets and lone closing tags are left out, and the rest compared with their indentation
// trimmed.
import { describe, expect, it } from 'vitest';
import { FILES } from './source.ts';

/** This many such lines in a row, the same in two places, are a copy. */
const RUN = 8;

const trivial = (line: string) => line.length <= 3 || /^(\/\/|\/\*|\*|import\s)/.test(line) || /^[\s})\]>;,(]*$/.test(line) || /^<\/[\w.]+>$/.test(line);

/** Every run of RUN lines in the shipped code, keyed by its text, with where each one starts. */
function runs(): Map<string, string[]> {
  const seen = new Map<string, string[]>();
  for (const f of FILES.filter((x) => x.kind === 'source')) {
    const kept = f.lines.map((text, i) => ({ text: text.trim(), at: i + 1 })).filter((l) => !trivial(l.text));
    let lastEnd = -1; // a file's own runs count once per stretch, not once per overlapping window
    for (let i = 0; i + RUN <= kept.length; i++) {
      const key = kept
        .slice(i, i + RUN)
        .map((l) => l.text)
        .join('\n');
      const where = seen.get(key) ?? [];
      if (where.some((w) => w.startsWith(`${f.path}:`)) && i < lastEnd) continue;
      seen.set(key, [...where, `${f.path}:${kept[i]!.at}`]);
      lastEnd = i + RUN;
    }
  }
  return seen;
}

describe('duplication', () => {
  it(`has no ${RUN} lines in a row in two places in the shipped code`, () => {
    const copies = [...runs().values()].filter((where) => where.length > 1).map((where) => where.join(' = '));
    // One line per first copy of a stretch, so a long copy shows as a few lines, not dozens.
    const firstOfStretch = copies.filter((c, i) => {
      const prev = copies[i - 1]?.split(' = ')[0]?.split(':')[0];
      return i === 0 || prev !== c.split(' = ')[0]!.split(':')[0];
    });

    expect(firstOfStretch).toEqual([]);
  });
});
