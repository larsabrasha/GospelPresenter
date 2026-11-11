// The shipped code writes no console.log: a leftover from debugging. What a program should say goes through its log.
import { describe, expect, it } from 'vitest';
import { FILES } from './source.ts';

/** A command-line entry point: it prints where the server listens. */
const PRINTS = new Set(['apps/desktop/src/serve.ts']);

describe('logging', () => {
  it('leaves no console.log in the shipped code', () => {
    const logs = FILES.filter((f) => f.kind === 'source' && !PRINTS.has(f.path)).flatMap((f) => f.lines.flatMap((line, i) => (/\bconsole\.log\(/.test(line) ? [`${f.path}:${i + 1}`] : [])));

    expect(logs).toEqual([]);
  });

  it('exempts only files that exist', () => {
    expect([...PRINTS].filter((path) => !FILES.some((f) => f.path === path))).toEqual([]);
  });
});
