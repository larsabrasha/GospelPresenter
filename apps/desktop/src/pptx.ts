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
/** What the program says when the file is not a deck it can read. */
const NOT_A_DECK = 2;

const program = `gp-pptx${process.platform === 'win32' ? '.exe' : ''}`;

/**
 * The program beside the bundle (dist/, in development and the e2e tests), or among a package's resources (two up
 * from app.asar's dist/, where the web app is too); null when neither has it, and decks then come in as PDF only.
 */
export function pptxProgram(here: string): string | null {
  return [join(here, program), join(here, '..', '..', program)].find((p) => existsSync(p)) ?? null;
}

export function pptxPages(programPath: string): PptxPages {
  return async (pptx) => {
    const dir = await mkdtemp(join(tmpdir(), 'gp-pptx-'));
    try {
      const deck = join(dir, 'deck.pptx');
      await writeFile(deck, pptx);
      let stdout: string;
      try {
        ({ stdout } = await promisify(execFile)(programPath, [deck, dir], { timeout: TIMEOUT_MS, maxBuffer: 1024 * 1024 }));
      } catch (e) {
        if ((e as { code?: unknown }).code === NOT_A_DECK) return null;
        throw e;
      }
      const drawn = JSON.parse(stdout) as { charts: boolean; pages: { full: string; thumb: string }[] };
      const pages = await Promise.all(drawn.pages.map(async (p) => ({ full: new Uint8Array(await readFile(join(dir, p.full))), thumb: new Uint8Array(await readFile(join(dir, p.thumb))) })));
      return { charts: drawn.charts, pages };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };
}
