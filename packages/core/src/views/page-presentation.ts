// The presentation page's view (ADR 0008; ported back from crates/gp-core/src/presentation_page.rs;
// apps/web/src/pages/presentation-editor): what the page reads, as the web's reads gave it — the presentation, its
// theme, its items and their slides, the songs and arrangements the items use, and the overlays.
import type { RunSql } from './sql.ts';
import { argsObj, asStr, idOf } from './serde.ts';
import { type Fields, marks, PRESENTATION, select, SONG } from './lists-rows.ts';
import { overlaysView } from './lists-media.ts';
import { themeOf } from './lists-settings.ts';
import { itemsSlides } from './slides-items.ts';
import { itemsOf, slideItem } from './page-live.ts';

/** `SongArrangement`. */
const ARRANGEMENT: Fields = [
  ['id', 'str'],
  ['songId', 'str'],
  ['name', 'opt'],
  ['partIds', 'str'],
  ['sort', 'num'],
];

/**
 * `presentationPageView` {id}: {presentation (null when there is none), theme, items, slides by item id, songs,
 * arrangements, overlays}.
 */
export async function presentationPageView(args: unknown, sql: RunSql) {
  const pid = idOf(argsObj(args), 'id');
  const items = await itemsOf(sql, pid);
  const songIds = [...new Set(items.filter((i) => i.type === 'song').map((i) => i.sourceId))];
  const shown = await itemsSlides(items.map(slideItem), sql);
  const slides = Object.fromEntries(items.map((i, k) => [asStr(i.id) ?? '', shown[k]]));
  const [presentation] = await select(sql, PRESENTATION, 'presentations WHERE id = ?', [pid]);
  const theme = await themeOf(sql, presentation ? asStr(presentation.themeId) : null);
  const [songs, arrangements] = songIds.length
    ? [
        await select(sql, SONG, `songs WHERE id IN (${marks(songIds.length)})`, songIds),
        await select(sql, ARRANGEMENT, `song_arrangements WHERE song_id IN (${marks(songIds.length)}) ORDER BY sort, id`, songIds),
      ]
    : [[], []];
  return {
    presentation: presentation ?? null,
    theme,
    items,
    slides,
    songs,
    arrangements,
    overlays: await overlaysView({}, sql),
  };
}
