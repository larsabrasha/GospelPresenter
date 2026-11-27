// The host draws a PowerPoint deck's pages (docs/powerpoint-deckcraft.md, step 1): crates/gp-pptx's program, built
// beside the bundle (build.mjs), run once a deck on a folder of its own; what it wrote is read and the folder removed.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { PptxPages } from '@gp/server/node';

/** Longer than any deck the probe drew (1.2 s for 21 slides), and short enough that a hung one gives up. */
const TIMEOUT_MS = 120_000;
/** What the program says when the file is not a deck it can read, and when it has more pages than taken. */
const NOT_A_DECK = 2;
const TOO_MANY_PAGES = 3;

const program = `gp-pptx${process.platform === 'win32' ? '.exe' : ''}`;

/**
 * A file built beside the bundle (dist/, in development and the e2e tests), or among a package's resources (two up
 * from app.asar's dist/, where the web app is too); null when neither has it.
 */
export function besideBundle(here: string, name: string): string | null {
  return [join(here, name), join(here, '..', '..', name)].find((p) => existsSync(p)) ?? null;
}

/** The program, where `besideBundle` finds it; without it, decks come in as PDF only. */
export const pptxProgram = (here: string): string | null => besideBundle(here, program);

/**
 * Draws decks one at a time: the program uses the processor fully, and the church computer may be presenting while a
 * phone imports a deck.
 */
export function pptxPages(programPath: string): PptxPages {
  let queue: Promise<unknown> = Promise.resolve();
  const draw: PptxPages = async (pptx, max) => {
    const dir = await mkdtemp(join(tmpdir(), 'gp-pptx-'));
    try {
      const deck = join(dir, 'deck.pptx');
      await writeFile(deck, pptx);
      let stdout: string;
      try {
        ({ stdout } = await promisify(execFile)(programPath, [deck, dir, String(max)], { timeout: TIMEOUT_MS, maxBuffer: 1024 * 1024 }));
      } catch (e) {
        const code = (e as { code?: unknown }).code;
        if (code === NOT_A_DECK) return 'invalid';
        if (code === TOO_MANY_PAGES) return 'pages';
        throw e;
      }
      const drawn = JSON.parse(stdout) as { charts: boolean; pages: { full: string; thumb: string }[] };
      const pages = await Promise.all(drawn.pages.map(async (p) => ({ full: new Uint8Array(await readFile(join(dir, p.full))), thumb: new Uint8Array(await readFile(join(dir, p.thumb))) })));
      return { charts: drawn.charts, pages };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };
  return (pptx, max) => {
    const run = queue.then(() => draw(pptx, max));
    queue = run.catch(() => undefined);
    return run;
  };
}
