import { count, eq } from 'drizzle-orm';
import { z } from 'zod';
import { orgSettings, presentations, themes } from '../schema.ts';
import { isBuiltInTheme, THEME_LIMITS, themeBlobs, themeDefinitionSchema } from '../themes.ts';
import { id, limit, MutationError, requireBlobs, requirePermission, type MutatorCtx, type Tx } from './base.ts';

// ------------------------------------------------------------------ themes of the organisation's own (docs/themes.md)

export const DEFAULT_THEME_SETTING = 'defaultThemeId';

/** A theme the organisation can use, built in or its own; anything else is "Theme not found." (PRES-R6, THEME-R4). */
export async function requireTheme(tx: Tx, themeId: string) {
  if (isBuiltInTheme(themeId)) return;
  const [own] = await tx.select({ id: themes.id }).from(themes).where(eq(themes.id, themeId));
  if (!own) throw new MutationError('theme-not-found', 'Theme not found.');
}

/** A built-in theme is the product's: nobody changes or deletes it. */
function requireOwn(themeId: string) {
  if (isBuiltInTheme(themeId)) throw new MutationError('forbidden', 'a built-in theme cannot be changed');
}

const themeName = z.string().trim().min(1).max(THEME_LIMITS.name);

export const createThemeArgs = z.object({ id, name: themeName, definition: themeDefinitionSchema, at: z.number().int() });
/** A new theme, at most THEME_LIMITS.themes of them; it goes after the others. Its pictures must be uploaded first. */
export async function createTheme(tx: Tx, a: z.output<typeof createThemeArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageThemes');
  requireOwn(a.id);
  const [existing] = await tx.select({ id: themes.id }).from(themes).where(eq(themes.id, a.id));
  if (existing) return; // a replay of a create that already landed
  const [n] = await tx.select({ n: count() }).from(themes);
  limit((n?.n ?? 0) >= THEME_LIMITS.themes, 'themes');
  await requireBlobs(tx, themeBlobs(a.definition));
  await tx.insert(themes).values({ id: a.id, name: a.name, definition: JSON.stringify(a.definition), sort: a.at, updatedAt: a.at });
}

export const updateThemeArgs = z.object({ id, name: themeName.optional(), definition: themeDefinitionSchema.optional(), at: z.number().int() });
/** Its name, its definition, or both; the definition is written whole, so the last of two devices' saves wins it. */
export async function updateTheme(tx: Tx, a: z.output<typeof updateThemeArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageThemes');
  requireOwn(a.id);
  if (a.definition) await requireBlobs(tx, themeBlobs(a.definition));
  const set = { updatedAt: a.at, ...(a.name !== undefined ? { name: a.name } : {}), ...(a.definition !== undefined ? { definition: JSON.stringify(a.definition) } : {}) };
  await tx.update(themes).set(set).where(eq(themes.id, a.id));
}

export const deleteThemeArgs = z.object({ id });
/**
 * For good, with no trash: the presentations and templates that showed it follow the organisation's default again,
 * and a default that was it is cleared, so they show the dark theme. A no-op if it is gone.
 */
export async function deleteTheme(tx: Tx, a: z.output<typeof deleteThemeArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageThemes');
  requireOwn(a.id);
  await tx.update(presentations).set({ themeId: null }).where(eq(presentations.themeId, a.id));
  const [setting] = await tx.select({ value: orgSettings.value }).from(orgSettings).where(eq(orgSettings.id, DEFAULT_THEME_SETTING));
  if (setting?.value === a.id) await tx.delete(orgSettings).where(eq(orgSettings.id, DEFAULT_THEME_SETTING));
  await tx.delete(themes).where(eq(themes.id, a.id));
}

export const setDefaultThemeArgs = z.object({ themeId: id });
/** The organisation's default theme (THEME-R4): presentations without their own follow it at once (THEME-R6). */
export async function setDefaultTheme(tx: Tx, a: z.output<typeof setDefaultThemeArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageThemes');
  await requireTheme(tx, a.themeId);
  await tx
    .insert(orgSettings)
    .values({ id: DEFAULT_THEME_SETTING, value: a.themeId })
    .onConflictDoUpdate({ target: orgSettings.id, set: { value: a.themeId } });
}
