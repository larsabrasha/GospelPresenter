// Names that say what a thing is, in one style per package, so a file is found by guessing its name.
import { describe, expect, it } from 'vitest';
import { fileName, FILES } from './source.ts';

const PASCAL = /^[A-Z][A-Za-z0-9]*$/;
const CAMEL = /^[a-z][A-Za-z0-9]*$/;
const KEBAB = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const ONE_WORD = /^[a-z][a-z0-9]*$/;

/** The name without `.test.ts`, `.spec.ts`, `.ts` or `.tsx`. */
const stem = (path: string) => fileName(path).replace(/\.(test|spec)\.tsx?$|\.tsx?$/, '');

/**
 * The web app names a component's file after it (PascalCase .tsx) and other modules in camelCase, as React code does;
 * the server, the desktop host and the packages use kebab-case, as Node code does.
 */
function wellNamed(path: string): boolean {
  const name = stem(path);
  if (!path.startsWith('apps/web/')) return KEBAB.test(name);
  return path.endsWith('.tsx') ? PASCAL.test(name) || ONE_WORD.test(name) : CAMEL.test(name);
}

describe('names', () => {
  it("name every file in its package's style", () => {
    expect(FILES.filter((f) => !wellNamed(f.path)).map((f) => f.path)).toEqual([]);
  });

  it('end every unit test in .test.ts and every e2e test in .spec.ts', () => {
    const misnamed = FILES.filter((f) => f.kind === 'test').filter((f) => {
      const e2e = f.path.includes('/e2e/');
      const name = fileName(f.path);
      return e2e ? /\.test\.tsx?$/.test(name) : /\.spec\.tsx?$/.test(name);
    });

    expect(misnamed.map((f) => f.path)).toEqual([]);
  });

  it('give no field or method a leading underscore', () => {
    const underscored = FILES.flatMap((f) =>
      f.lines.flatMap((line, i) => (/(\bthis\.|\b(private|protected|public|readonly|static)\s+)_[A-Za-z]/.test(line) ? [`${f.path}:${i + 1}`] : [])),
    );

    expect(underscored).toEqual([]);
  });
});
