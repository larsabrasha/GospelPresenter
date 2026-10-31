// Each package uses only the ones below it: core, then sync, then the server and the web app, then the desktop host
// that embeds the server. Shipped code never reaches into another package by a relative path.
import { posix } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FILES } from './source.ts';

const MAY_USE: Record<string, string[]> = {
  'packages/core': [],
  'packages/sync': ['@gp/core'],
  'apps/server': ['@gp/core', '@gp/sync'],
  'apps/web': ['@gp/core', '@gp/sync'],
  'apps/desktop': ['@gp/core', '@gp/sync', '@gp/server'],
};

const IMPORT = /^\s*(?:import|export)\b[^'"]*?from\s+'([^']+)'/;

const imports = (pkg: string) =>
  FILES.filter((f) => f.pkg === pkg && f.kind === 'source').flatMap((f) =>
    f.lines.flatMap((line, i) => {
      const spec = IMPORT.exec(line)?.[1];
      return spec ? [{ at: `${f.path}:${i + 1}`, file: f.path, spec }] : [];
    }),
  );

describe('package boundaries', () => {
  it.each(Object.keys(MAY_USE))('lets %s import only the packages below it', (pkg) => {
    const workspace = (spec: string) => /^@gp\/[a-z]+/.exec(spec)?.[0];
    const refused = imports(pkg).filter(({ spec }) => {
      const used = workspace(spec);
      return used !== undefined && !MAY_USE[pkg]!.includes(used);
    });

    expect(refused.map((r) => `${r.at} ${r.spec}`)).toEqual([]);
  });

  it.each(Object.keys(MAY_USE))('keeps the relative imports of %s inside it', (pkg) => {
    const outside = imports(pkg).filter(({ file, spec }) => spec.startsWith('.') && !posix.join(posix.dirname(file), spec).startsWith(`${pkg}/`));

    expect(outside.map((r) => `${r.at} ${r.spec}`)).toEqual([]);
  });

  it('keeps Node out of the code that runs in a browser', () => {
    // sync's SQLite for Node: node:sqlite for the Electron main process, and wa-sqlite in memory for the tests.
    const NODE_ONLY = new Set(['packages/sync/src/client/node-sqlite-db.ts', 'packages/sync/src/client/wa-sqlite-db.ts']);
    const browser = ['packages/core', 'packages/sync', 'apps/web'].flatMap(imports).filter(({ file, spec }) => spec.startsWith('node:') && !NODE_ONLY.has(file));

    expect(browser.map((r) => `${r.at} ${r.spec}`)).toEqual([]);
  });
});
