// No modules that import each other, around any loop: one of them runs before the other has finished loading, and
// what it reads there is undefined. A type-only import is gone once compiled, so it makes no loop.
import { posix } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FILES, importsOf } from './source.ts';

/** Every shipped module and the modules it imports for values, by path. */
function graph(): Map<string, string[]> {
  const known = new Set(FILES.map((f) => f.path));
  return new Map(
    FILES.filter((f) => f.kind === 'source').map((f) => [
      f.path,
      importsOf(f)
        .filter((i) => !i.typeOnly && i.spec.startsWith('.'))
        .map((i) => posix.join(posix.dirname(f.path), i.spec))
        .filter((path) => known.has(path)),
    ]),
  );
}

/** The groups of modules that reach each other (Tarjan's strongly connected components), each with more than one, or one that imports itself. */
function loops(g: Map<string, string[]>): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const found: string[][] = [];
  const visit = (v: string) => {
    index.set(v, index.size);
    low.set(v, index.get(v)!);
    stack.push(v);
    onStack.add(v);
    for (const w of g.get(v) ?? []) {
      if (!index.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) low.set(v, Math.min(low.get(v)!, index.get(w)!));
    }
    if (low.get(v) !== index.get(v)) return;
    const group: string[] = [];
    let w: string;
    do {
      w = stack.pop()!;
      onStack.delete(w);
      group.push(w);
    } while (w !== v);
    if (group.length > 1 || g.get(v)?.includes(v)) found.push(group.toSorted());
  };
  for (const v of g.keys()) if (!index.has(v)) visit(v);
  return found;
}

describe('import cycles', () => {
  it('has no shipped module that imports itself around a loop', () => {
    expect(loops(graph()).map((group) => group.join(' ↔ '))).toEqual([]);
  });

  it('reads the imports that span lines and leaves out type-only ones', () => {
    const hub = graph().get('apps/server/src/live-hub.ts');

    expect(hub).toEqual(expect.arrayContaining(['apps/server/src/live-tables.ts', 'apps/server/src/live-viewers.ts']));
    expect(graph().get('apps/server/src/app.ts')).not.toContain('apps/server/src/live-viewers.ts'); // `import type { Viewer }`
  });

  it('finds a loop when there is one', () => {
    const g = new Map([
      ['a.ts', ['b.ts']],
      ['b.ts', ['c.ts']],
      ['c.ts', ['a.ts']],
      ['d.ts', ['a.ts']],
    ]);

    expect(loops(g)).toEqual([['a.ts', 'b.ts', 'c.ts']]);
  });
});
