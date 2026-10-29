import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { presentationItems, presentations } from '../schema.ts';
import { id, LIMITS, MutationError, name, optionalText, requirePermission, type MutatorCtx, type Tx } from './base.ts';
import { purgeRows, setDeletedAt } from './presentations.ts';

// ------------------------------------------------------------------ templates (spec 03 "Template")

/** A day of the week, 0 = Sunday … 6 = Saturday (spec 03 `ScheduledDayOfWeek`). */
const weekday = z.number().int().min(0).max(6).nullable();
/** A time of day, `HH:MM`. */
const time = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
  .nullable();
/** spec 03: `EventLocation` ≤ 100. */
const location = optionalText(100);

/**
 * The items to copy, each with the id its copy gets: the caller makes the ids
 * and names the items it saw, so the copy holds what the user copied and
 * every device makes the same rows.
 */
const copiedItems = z.array(z.object({ from: id, id })).max(LIMITS.itemsPerPresentation);

/**
 * Copies the named items of one presentation or template into another, in
 * their order there (PRES-R30, R31); an item removed meanwhile is left out.
 * A song keeps its arrangement and a slide deck its pages (D10): the pages
 * are content-addressed, so the copy names the same pictures and owns them
 * as much as the original does.
 */
async function copyItems(tx: Tx, fromId: string, toId: string, copies: z.output<typeof copiedItems>) {
  const newIds = new Map(copies.map((c) => [c.from, c.id]));
  const items = await tx
    .select()
    .from(presentationItems)
    .where(eq(presentationItems.presentationId, fromId))
    .orderBy(asc(presentationItems.sort), asc(presentationItems.id));
  let sort = 0;
  for (const item of items) {
    const itemId = newIds.get(item.id);
    if (!itemId) continue; // added after the user copied: not part of the copy
    await tx.insert(presentationItems).values({
      ...item,
      id: itemId,
      presentationId: toId,
      sort: sort++,
      // A deck has no table of its own: its source is the item itself (`addSlides`).
      sourceId: item.type === 'slides' ? itemId : item.sourceId,
    });
  }
}

async function exists(tx: Tx, presentationId: string): Promise<boolean> {
  const [p] = await tx.select({ id: presentations.id }).from(presentations).where(eq(presentations.id, presentationId));
  return !!p;
}

export const createTemplateArgs = z.object({ id, name, weekday: weekday.optional(), time: time.optional(), location: location.optional() });
/** "Skapa mall" on the templates page (spec 03 screen 3): an empty template. */
export async function createTemplate(tx: Tx, a: z.output<typeof createTemplateArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageTemplates');
  await tx
    .insert(presentations)
    .values({ id: a.id, name: a.name, isTemplate: true, weekday: a.weekday ?? null, time: a.time ?? null, location: a.location ?? null })
    .onConflictDoNothing();
}

export const updateTemplateArgs = z.object({ id, name: name.optional(), weekday: weekday.optional(), time: time.optional(), location: location.optional() });
/** The template's details dialog (spec 03 2a): sets the fields it names; null clears one. */
export async function updateTemplate(tx: Tx, a: z.output<typeof updateTemplateArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageTemplates');
  const { id: templateId, ...fields } = a;
  const set = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
  if (Object.keys(set).length) {
    await tx
      .update(presentations)
      .set(set)
      .where(and(eq(presentations.id, templateId), eq(presentations.isTemplate, true)));
  }
}

export const saveAsTemplateArgs = z.object({ id, presentationId: id, name, items: copiedItems });
/**
 * "Spara som mall" (PRES-R31): a new template with the presentation's items
 * and theme, and no weekly slot. Its slide decks go along (D10).
 */
export async function saveAsTemplate(tx: Tx, a: z.output<typeof saveAsTemplateArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageTemplates');
  if (await exists(tx, a.id)) return; // a replay of a save that already landed
  const [source] = await tx.select({ themeId: presentations.themeId }).from(presentations).where(eq(presentations.id, a.presentationId));
  if (!source) throw new MutationError('not-found', 'presentation not found');
  await tx.insert(presentations).values({ id: a.id, name: a.name, isTemplate: true, themeId: source.themeId });
  await copyItems(tx, a.presentationId, a.id, a.items);
}

export const createFromTemplateArgs = z.object({
  id,
  templateId: id,
  name,
  eventDate: z.iso.date().nullable().optional(),
  items: copiedItems,
  /** When it was made: the template's "last used" (PRES-R30). */
  at: z.number().int(),
});
/**
 * A new presentation from a template (PRES-R30): its items, in order, and
 * its theme. A template in the trash cannot be used (PRES-R23).
 */
export async function createFromTemplate(tx: Tx, a: z.output<typeof createFromTemplateArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManagePresentations');
  requirePermission(ctx, 'ViewTemplates'); // PRES-R5
  if (await exists(tx, a.id)) return;
  const [template] = await tx
    .select({ themeId: presentations.themeId, deletedAt: presentations.deletedAt })
    .from(presentations)
    .where(and(eq(presentations.id, a.templateId), eq(presentations.isTemplate, true)));
  if (!template || template.deletedAt !== null) throw new MutationError('not-found', 'Template not found.');
  await tx.insert(presentations).values({ id: a.id, name: a.name, eventDate: a.eventDate ?? null, themeId: template.themeId });
  await copyItems(tx, a.templateId, a.id, a.items);
  await tx.update(presentations).set({ lastUsedAt: a.at }).where(eq(presentations.id, a.templateId));
}

export const trashTemplateArgs = z.object({ id, at: z.number().int() });
export async function trashTemplate(tx: Tx, a: z.output<typeof trashTemplateArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageTemplates');
  await setDeletedAt(tx, a.id, true, a.at);
}

export const restoreTemplateArgs = z.object({ id });
export async function restoreTemplate(tx: Tx, a: z.output<typeof restoreTemplateArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageTemplates');
  await setDeletedAt(tx, a.id, true, null);
}

export const purgeTemplateArgs = z.object({ id });
/** Permanent delete: only of a template in the trash where this runs. Presentations made from it keep their copies. */
export async function purgeTemplate(tx: Tx, a: z.output<typeof purgeTemplateArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageTemplates');
  await purgeRows(tx, a.id, true);
}
