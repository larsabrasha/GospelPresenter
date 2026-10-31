// The repository's own code as these tests read it: every tracked or new file under apps/ and packages/ (not
// ignored), as text. Nothing is built or imported, so the tests take a fraction of a second.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../..', import.meta.url));

export type Kind = 'source' | 'test';

export interface SourceFile {
  /** From the rewrite's root, e.g. `apps/web/src/i18n.ts`. */
  path: string;
  /** The workspace package, e.g. `apps/web`. */
  pkg: string;
  /** Code that ships, or a unit or e2e test with its helpers. */
  kind: Kind;
  lines: string[];
}

const CODE = /\.(ts|tsx)$/;

function kindOf(path: string): Kind | null {
  const inPackage = path.split('/').slice(2);
  if (inPackage[0] === 'src') return 'source';
  if (inPackage[0] === 'test' || inPackage[0] === 'e2e') return 'test';
  return null; // configs and scripts
}

/** The lines as `wc -l` counts them: a file's last newline ends its last line rather than starting another. */
const linesOf = (text: string) => (text.endsWith('\n') ? text.slice(0, -1) : text).split('\n');

/** Tracked or new files under `paths`, not ignored. */
const tracked = (...paths: string[]) => execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z', ...paths], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean);

function list(): SourceFile[] {
  return tracked('apps', 'packages')
    .filter((path) => CODE.test(path) && !path.endsWith('.d.ts') && !path.includes('/dist/'))
    .flatMap((path) => {
      const kind = kindOf(path);
      return kind ? [{ path, pkg: path.split('/').slice(0, 2).join('/'), kind, lines: linesOf(readFileSync(`${ROOT}/${path}`, 'utf8')) }] : [];
    });
}

/** Read once for all the tests in a file. */
export const FILES: SourceFile[] = list();

export const fileName = (path: string) => path.slice(path.lastIndexOf('/') + 1);

/** The rewrite's own documents (README, AGENTS, GAPS and docs/), by path, as text. */
export const DOCS: { path: string; text: string }[] = tracked('docs', 'README.md', 'AGENTS.md', 'GAPS.md')
  .filter((path) => path.endsWith('.md'))
  .map((path) => ({ path, text: readFileSync(`${ROOT}/${path}`, 'utf8') }));

/** The behaviour spec at the repo's root (`../spec`), all of it as one text. */
export const SPEC: string = readdirSync(`${ROOT}/../spec`)
  .filter((name) => name.endsWith('.md'))
  .map((name) => readFileSync(`${ROOT}/../spec/${name}`, 'utf8'))
  .join('\n');
