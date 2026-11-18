// The export zip's rows through the core (crates/gp-core/src/legacy.rs; docs/import-from-1x.md), for the web, the server
// and 1.x's export alike. The rows go as JSON text and the rewritten ones come back as JSON text, so an object's keys
// keep JavaScript's order and each page the core rewrites is the text JSON.stringify would write. Rows that are not
// objects, or a table the upgrade reads that is not a list of them, are refused with `invalid-rows`.
import type { CustomPage, LegacyRows, Picture } from '@gp/core';
import type { RustCore } from './index.ts';

/** A zip's rows of `format` as this format has them (`legacyUpgradeView`). */
export function upgradeLegacyRows(core: RustCore, format: number, rows: unknown): LegacyRows {
  return JSON.parse(core.pure<string>('legacyUpgradeView', { format, rows: JSON.stringify(rows) })) as LegacyRows;
}

/** The first row the server would refuse, named by its table and id, or null (`legacyRowsProblemView`). */
export function legacyRowsProblem(core: RustCore, rows: LegacyRows): string | null {
  return core.pure<string | null>('legacyRowsProblemView', { rows: JSON.stringify(rows) });
}

/** The blobs the rows name, each with the row that names it ("images {id}"), and which of them are videos (`legacyBlobsView`). */
export function legacyBlobs(core: RustCore, rows: LegacyRows): { named: [hash: string, row: string][]; videos: Set<string> } {
  const { named, videos } = core.pure<{ named: [string, string][]; videos: string[] }>('legacyBlobsView', { rows: JSON.stringify(rows) });
  return { named, videos: new Set(videos) };
}

/** A 1.x overlay as a page, drawn as 1.x drew it: its picture over the stage, its text at the top left (`legacyOverlayPageView`). */
export function legacyOverlayPage(core: RustCore, content: string | null, picture: Picture | null): CustomPage {
  return JSON.parse(core.pure<string>('legacyOverlayPageView', { content, picture })) as CustomPage;
}
