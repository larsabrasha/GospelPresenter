import { and, asc, eq, max, ne } from 'drizzle-orm';
import { z } from 'zod';
import { labelDefaults, labelId, labelKey } from '../labels.ts';
import { labels, songParts } from '../schema.ts';
import { id, limit, MutationError, requirePermission, type MutatorCtx, type Tx } from './base.ts';

// Part labels (spec 02 "Part label", `/admin/labels`, SONG-R45–R47). A label is
// found by its text, case and spacing aside, so a renamed label is still the one
// a song names by text; two labels may not share a text.

/** At most this many labels (the current app has a limit and no number for it). */
export const LABEL_LIMIT = 200;

const labelText = z.string().trim().min(1).max(50);
const color = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/)
  .transform((c) => c.toLowerCase());

async function allLabels(tx: Tx) {
  return tx.select().from(labels).orderBy(asc(labels.sort), asc(labels.text));
}

/** The id for a new label of `text`: `labelId(text)`, or with a number when a renamed label holds that. */
function freeLabelId(text: string, taken: Set<string>): string {
  const first = labelId(text);
  let lid = first;
  for (let n = 2; taken.has(lid); n++) lid = `${first}:${n}`;
  return lid;
}

async function nextSort(tx: Tx): Promise<number> {
  const [m] = await tx.select({ m: max(labels.sort) }).from(labels);
  return m?.m == null ? 0 : m.m + 1;
}

/**
 * The label with `text`, made when there is none (a song's part, an import:
 * SONG-R43): appended to the order, in the default label's colour or grey.
 */
export async function ensureLabel(tx: Tx, text: string | null | undefined): Promise<string | null> {
  if (!text?.trim()) return null;
  const key = labelKey(text);
  // Most labels still have the id their text gives; only a renamed one needs the scan.
  const [direct] = await tx.select({ id: labels.id, text: labels.text }).from(labels).where(eq(labels.id, labelId(text)));
  if (direct && labelKey(direct.text) === key) return direct.id;
  const all = await allLabels(tx);
  const found = all.find((l) => labelKey(l.text) === key);
  if (found) return found.id;
  const lid = freeLabelId(text, new Set(all.map((l) => l.id)));
  await tx
    .insert(labels)
    .values({ id: lid, text: text.trim(), color: labelDefaults(text).color, sort: await nextSort(tx) })
    .onConflictDoNothing();
  return lid;
}

function refuseTaken(all: { id: string; text: string }[], text: string, self: string | null) {
  if (all.some((l) => l.id !== self && labelKey(l.text) === labelKey(text))) throw new MutationError('label-exists', 'another label has this text');
}

export const createLabelArgs = z.object({ text: labelText, color });
/** A label made on the labels page (SONG-R45): appended to the order; refused when another has the text (SONG-A29). */
export async function createLabel(tx: Tx, a: z.output<typeof createLabelArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageSongs');
  const all = await allLabels(tx);
  refuseTaken(all, a.text, null);
  limit(all.length >= LABEL_LIMIT, 'labels');
  await tx
    .insert(labels)
    .values({ id: freeLabelId(a.text, new Set(all.map((l) => l.id))), text: a.text, color: a.color, sort: await nextSort(tx) })
    .onConflictDoNothing();
}

export const updateLabelArgs = z.object({ id, text: labelText.optional(), color: color.optional() });
/** A label's new text or colour; every part with it shows the new ones. Refused when another label has the text. */
export async function updateLabel(tx: Tx, a: z.output<typeof updateLabelArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageSongs');
  const all = await allLabels(tx);
  if (!all.some((l) => l.id === a.id)) return; // deleted meanwhile
  if (a.text !== undefined) refuseTaken(all, a.text, a.id);
  const set: { text?: string; color?: string } = {};
  if (a.text !== undefined) set.text = a.text;
  if (a.color !== undefined) set.color = a.color;
  if (Object.keys(set).length) await tx.update(labels).set(set).where(eq(labels.id, a.id));
}

/** Writes 0..n-1 as the labels' sort, touching only rows that change. */
async function renumber(tx: Tx, order: string[]) {
  for (const [i, lid] of order.entries()) {
    await tx
      .update(labels)
      .set({ sort: i })
      .where(and(eq(labels.id, lid), ne(labels.sort, i)));
  }
}

export const deleteLabelArgs = z.object({ id });
/** Deletes a label: the parts with it become unlabelled (SONG-R46), the rest are numbered again (SONG-R45). */
export async function deleteLabel(tx: Tx, a: z.output<typeof deleteLabelArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageSongs');
  await tx.update(songParts).set({ labelId: null }).where(eq(songParts.labelId, a.id));
  await tx.delete(labels).where(eq(labels.id, a.id));
  await renumber(
    tx,
    (await allLabels(tx)).map((l) => l.id),
  );
}

export const moveLabelArgs = z.object({ id, toIndex: z.number().int().min(0) });
/** Moves a label to an index in the order as it is where this runs (SONG-R45). */
export async function moveLabel(tx: Tx, a: z.output<typeof moveLabelArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageSongs');
  const order = (await allLabels(tx)).map((l) => l.id);
  if (!order.includes(a.id)) return;
  const rest = order.filter((x) => x !== a.id);
  rest.splice(Math.min(a.toIndex, rest.length), 0, a.id);
  await renumber(tx, rest);
}
