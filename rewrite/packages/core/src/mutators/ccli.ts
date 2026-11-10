import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ccliEntries, orgSettings } from '../schema.ts';
import { id, requirePermission, type MutatorCtx, type Tx } from './base.ts';

// The CCLI report (spec 02 "CCLI", SONG-R48–R53, decided on 2026-10-31): the window that presents
// counts a song shown for 10 s and records it here, so a session is counted once whatever else
// watches it (SONG-R51); the admins mark the entries reported.

/** The organisation setting that switches collection on (`"true"`); no row, or anything else, is off (SONG-R49). */
export const CCLI_COLLECTION_SETTING = 'ccliCollection';

/** An entry's id: one per song, day and presentation (SONG-R50), so the same showing again adds nothing. */
export const ccliEntryId = (songId: string, date: string, presentationId: string) => `${songId}|${date}|${presentationId}`;

async function ccliCollectionOn(tx: Tx): Promise<boolean> {
  const [s] = await tx.select({ value: orgSettings.value }).from(orgSettings).where(eq(orgSettings.id, CCLI_COLLECTION_SETTING));
  return s?.value === 'true';
}

export const setCcliCollectionArgs = z.object({ on: z.boolean() });
/** "Aktivera CCLI-datainsamling", an organisation setting for admins (SONG-R4 as decided on 2026-10-31). */
export async function setCcliCollection(tx: Tx, a: z.output<typeof setCcliCollectionArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageOrganizationSettings');
  const value = a.on ? 'true' : 'false';
  await tx.insert(orgSettings).values({ id: CCLI_COLLECTION_SETTING, value }).onConflictDoUpdate({ target: orgSettings.id, set: { value } });
}

export const recordCcliUseArgs = z.object({
  songId: id,
  songName: z.string().max(200),
  ccli: z.string().trim().max(20),
  presentationId: id,
  presentationName: z.string().max(200),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
/**
 * A song with a CCLI number that was shown live for 10 s (SONG-R48): recorded only while collection is on
 * where this runs (SONG-R49), once per song, day and presentation (SONG-R50), with the names and number
 * as they were shown. Anyone who presents may record; only admins see the report.
 */
export async function recordCcliUse(tx: Tx, a: z.output<typeof recordCcliUseArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManagePresentations');
  if (!a.ccli || !(await ccliCollectionOn(tx))) return;
  await tx
    .insert(ccliEntries)
    .values({
      id: ccliEntryId(a.songId, a.date, a.presentationId),
      songId: a.songId,
      songName: a.songName,
      ccli: a.ccli,
      presentationId: a.presentationId,
      presentationName: a.presentationName,
      date: a.date,
      reportedAt: null,
    })
    .onConflictDoNothing();
}

export const setCcliReportedArgs = z.object({ ids: z.array(z.string().min(1).max(400)).min(1).max(500), reported: z.boolean(), at: z.number().int() });
/** A card's "Rapporterad": marks its entries reported at `at`, or not reported (SONG-A36). */
export async function setCcliReported(tx: Tx, a: z.output<typeof setCcliReportedArgs>, ctx: MutatorCtx) {
  requirePermission(ctx, 'ManageCcliReport');
  // The ids as one JSON value: a Durable Object binds at most 100 values a statement, and a card may have more.
  await tx
    .update(ccliEntries)
    .set({ reportedAt: a.reported ? a.at : null })
    .where(sql`${ccliEntries.id} IN (SELECT value FROM json_each(${JSON.stringify(a.ids)}))`);
}
