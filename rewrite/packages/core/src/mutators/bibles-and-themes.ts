import { count, eq } from 'drizzle-orm';
import { z } from 'zod';
import { BIBLE_LIMITS, bibleId } from '../bible.ts';
import { bibleBlobs, bibles, bibleTexts, orgSettings } from '../schema.ts';
import { id, limit, MutationError, requirePermission, type MutatorCtx, type Tx } from './base.ts';
import { requireTheme } from './presentations.ts';

// ------------------------------------------------------------------ bibles

/** Drops a stored text that no translation names any more. */
async function dropUnusedText(tx: Tx, hash: string) {
  const [used] = await tx.select({ id: bibles.id }).from(bibles).where(eq(bibles.contentHash, hash));
  if (used) return;
  await tx.delete(bibleBlobs).where(eq(bibleBlobs.hash, hash));
  await tx.delete(bibleTexts).where(eq(bibleTexts.hash, hash));
}

export const importBibleArgs = z.object({
  name: z.string().trim().min(1).max(200),
  abbreviation: z.string().trim().min(1).max(50),
  language: z.string().trim().max(20).nullable(),
  /** The text, uploaded first (`PUT /bibles/{hash}`) and stored where this runs. */
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
});
/**
 * Imports a translation, or replaces the one with the same abbreviation
 * (BIBLE-R5): its id comes from the abbreviation, so the row is kept and its
 * name, text and count change. At most 10, counted only for a new one. The
 * text must be stored here already: on the server the upload put it there, on
 * the importing device the import did. The verse count is the text's own.
 */
export async function importBible(tx: Tx, a: z.output<typeof importBibleArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageBibles'); // D24
  const [text] = await tx.select({ verseCount: bibleBlobs.verseCount }).from(bibleBlobs).where(eq(bibleBlobs.hash, a.contentHash));
  if (!text) throw new MutationError('bible-text-missing', 'the text of this translation has not been uploaded');
  const bid = bibleId(a.abbreviation);
  const [existing] = await tx.select({ contentHash: bibles.contentHash }).from(bibles).where(eq(bibles.id, bid));
  if (!existing) {
    const [n] = await tx.select({ n: count() }).from(bibles);
    limit((n?.n ?? 0) >= BIBLE_LIMITS.bibles, 'Bibles');
  }
  const row = { name: a.name, abbreviation: a.abbreviation, language: a.language, verseCount: text.verseCount, contentHash: a.contentHash };
  if (existing) await tx.update(bibles).set(row).where(eq(bibles.id, bid));
  else await tx.insert(bibles).values({ id: bid, ...row });
  if (existing && existing.contentHash !== a.contentHash) await dropUnusedText(tx, existing.contentHash);
}

export const deleteBibleArgs = z.object({ id });
/** Deletes a translation (BIBLE-R7): no trash, and items made from it keep their text. A no-op if it is gone. */
export async function deleteBible(tx: Tx, a: z.output<typeof deleteBibleArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageBibles'); // D24
  const [b] = await tx.select({ contentHash: bibles.contentHash }).from(bibles).where(eq(bibles.id, a.id));
  if (!b) return;
  await tx.delete(bibles).where(eq(bibles.id, a.id));
  await dropUnusedText(tx, b.contentHash);
}

// ------------------------------------------------------------------ themes

export const DEFAULT_THEME_SETTING = 'defaultThemeId';

export const setDefaultThemeArgs = z.object({ themeId: id });
/** The organisation's default theme (THEME-R4): presentations without their own follow it at once (THEME-R6). */
export async function setDefaultTheme(tx: Tx, a: z.output<typeof setDefaultThemeArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageThemes');
  requireTheme(a.themeId);
  await tx
    .insert(orgSettings)
    .values({ id: DEFAULT_THEME_SETTING, value: a.themeId })
    .onConflictDoUpdate({ target: orgSettings.id, set: { value: a.themeId } });
}
