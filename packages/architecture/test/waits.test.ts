// Tests that wait for what they need, not for a time: a fixed wait is slow when generous and flaky when not. Where
// time itself must pass (a long press, nothing happening, a server's own clock), the line says why.
import { describe, expect, it } from 'vitest';
import { FILES } from './source.ts';

/** A sleep this long or longer needs its reason; shorter ones are a poll's ticks. */
const LONG_MS = 100;

/** Takes pictures, not a test: it waits for transitions to settle before each one. */
const PICTURES = 'apps/desktop/e2e/capture.spec.ts';

const testLines = () => FILES.filter((f) => f.kind === 'test').flatMap((f) => f.lines.map((line, i) => ({ at: `${f.path}:${i + 1}`, file: f.path, line })));

function fixedWaitMs(line: string): number | null {
  if (/\.waitForTimeout\(/.test(line)) return Infinity;
  const sleep = /setTimeout\((?:r|resolve), ([\d_]+)\)/.exec(line);
  return sleep ? Number(sleep[1]!.replaceAll('_', '')) : null;
}

describe('waiting in tests', () => {
  it('gives every fixed wait its reason on the same line', () => {
    const unexplained = testLines().filter(({ file, line }) => file !== PICTURES && (fixedWaitMs(line) ?? 0) >= LONG_MS && !line.includes('//'));

    expect(unexplained.map((l) => l.at)).toEqual([]);
  });

  it('runs no test alone with .only', () => {
    expect(testLines().filter(({ line }) => /\b(it|test|describe)\.only\(/.test(line)).map((l) => l.at)).toEqual([]);
  });
});
