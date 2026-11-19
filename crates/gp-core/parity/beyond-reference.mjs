// What the core does beyond the reference at 238d481b, written in the core first (Lars, 2026-11-17), for the checks to
// add to the reference so that the rest is still compared with it: schema 27 (crates/gp-core/src/schema.rs,
// FIELD_TIMES), the rows written whole keeping a time per field and the newest change of a field winning (SYNC-R23,
// docs/assumptions.md); a renamed slideshow's items taking its new name (docs/custom-slides.md); and a song's items
// keeping Original when its first arrangement is made (spec 02, SONG-R58); and a passage broken into slides where
// reading pauses (`bibleSlides`, BIBLE-A13). The checks bring the databases the
// reference makes to 27 as the core's migration does, and, where the reference's TS mutators write, add the rules as
// triggers (`coreRules`): the same outcomes and rows as the core's.

/** The tables and their fields with a time each, as the core's FIELD_TIMES. */
export const FIELD_TIMES = [
  ['custom_slides', ['name', 'pages']],
  ['overlays', ['title', 'content']],
  ['themes', ['name', 'definition']],
];

/** What migration 27 runs: a column per field, its time from the row's last change; and the version. */
export const fieldTimeMigration = () => [
  ...FIELD_TIMES.flatMap(([t, fields]) => [
    ...fields.map((f) => `ALTER TABLE ${t} ADD COLUMN ${f}_at INTEGER`),
    `UPDATE ${t} SET ${fields.map((f) => `${f}_at = updated_at`).join(', ')}`,
  ]),
  'UPDATE _schema SET version = 27',
];

/**
 * The core's `update_fields` and its inserts, as triggers, for a database the reference's TS mutators write: a field
 * set (`UPDATE OF`, whatever its value) older than its time is refused (`newer-change`, an error the runner reads as
 * the code); else its time is the change's (`updated_at`, which the TS mutators set to the change's `at`), and
 * `updated_at` only moves forward. A new row's fields take its time.
 */
const fieldTimeRule = () =>
  FIELD_TIMES.flatMap(([t, fields]) => [
    ...fields.flatMap((f) => [
      `CREATE TRIGGER ft_${t}_${f}_older BEFORE UPDATE OF ${f} ON ${t} WHEN OLD.${f}_at > NEW.updated_at BEGIN SELECT RAISE(ABORT, 'newer-change'); END`,
      `CREATE TRIGGER ft_${t}_${f}_time AFTER UPDATE OF ${f} ON ${t} BEGIN UPDATE ${t} SET ${f}_at = NEW.updated_at WHERE id = NEW.id; END`,
    ]),
    `CREATE TRIGGER ft_${t}_forward AFTER UPDATE OF updated_at ON ${t} WHEN OLD.updated_at > NEW.updated_at BEGIN UPDATE ${t} SET updated_at = OLD.updated_at WHERE id = NEW.id; END`,
    `CREATE TRIGGER ft_${t}_new AFTER INSERT ON ${t} BEGIN UPDATE ${t} SET ${fields.map((f) => `${f}_at = NEW.updated_at`).join(', ')} WHERE id = NEW.id; END`,
  ]);

/**
 * A renamed thing of the library (`UPDATE OF` its name): the items it is alone, in presentations and templates, take
 * the new name, as the core's `rename_items` does for slideshows, pictures, sounds and videos.
 */
const itemTitleRule = () =>
  [['custom_slides', 'name', 'custom'], ['images', 'file_name', 'image'], ['audios', 'file_name', 'audio'], ['videos', 'file_name', 'video']].map(
    ([table, column, kind]) => `CREATE TRIGGER br_${table}_item_titles AFTER UPDATE OF ${column} ON ${table} BEGIN
     UPDATE presentation_items SET title = NEW.${column} WHERE type = '${kind}' AND source_id = NEW.id AND content IS NULL AND title <> NEW.${column}; END`,
  );

/**
 * A song's first arrangement made (a new row, its only one): its items that named none showed its parts in their own
 * order and go on showing them as Original, `original`, as the core's `keep_original` (Lars, 2026-11-19). The
 * reference reads that id as no arrangement's, so all the parts in order, as the core does.
 */
const originalRule = () => [
  `CREATE TRIGGER br_song_arrangements_original AFTER INSERT ON song_arrangements
   WHEN (SELECT count(*) FROM song_arrangements WHERE song_id = NEW.song_id) = 1 BEGIN
     UPDATE presentation_items SET arrangement_id = 'original' WHERE type = 'song' AND source_id = NEW.song_id AND arrangement_id IS NULL; END`,
];

/** Every rule of the core's beyond the reference, as triggers for a database the reference's TS mutators write. */
export const coreRules = () => [...fieldTimeRule(), ...itemTitleRule(), ...originalRule()];

/** A refusal of the rule's triggers, read back as the core's code; else undefined. */
export const fieldTimeRefusal = (e) => ([e?.message, e?.cause?.message].some((m) => String(m ?? '').includes('newer-change')) ? 'newer-change' : undefined);

// ------------------------------------------------------------------ a passage's slides (crates/gp-core/src/bible.rs)

/** What a break costs, as the core's BREAK_*, UNEVEN and LONGEST. */
const BREAK = { verse: 0, within: 6, comma: 3, clause: 2, sentence: 1, fragment: 4 };
const UNEVEN = 20;
const LONGEST = 1.4;

/** A word's last mark before closing quotes and brackets: 3 ends a sentence, 2 a clause, 1 a comma's, 0 none. */
function mark(t) {
  const last = [...t.replace(/["'”’»)\]]+$/u, '')].at(-1);
  if (last && '.!?…'.includes(last)) return 3;
  if (last && ';:'.includes(last)) return 2;
  if (last && ',–—'.includes(last)) return 1;
  return 0;
}

/**
 * The core's split of a passage into slides (2.0, Lars 2026-11-19), from the reference's slides of it: their words in
 * order, a verse's number on its first, broken again where reading pauses, the cheapest breaks found word by word.
 */
export function bibleSlides(slides) {
  const words = slides.flat().flatMap(({ n, t }) => {
    const parts = t.split(' ').filter((p) => p);
    return parts.length ? parts.map((p, i) => ({ n: i === 0 ? n : null, t: p })) : [{ n, t: '' }];
  });
  if (!words.length) return [];
  const count = words.length;
  const lengths = words.map((w) => w.t.length + (w.n === null ? 0 : String(w.n).length + 1));
  const total = lengths.reduce((a, b) => a + b, 0) + count - 1;
  const target = total / Math.max(1, Math.ceil(total / 250));
  const marks = words.map((w) => mark(w.t));
  const back = [];
  for (let i = 0; i < count; i++) back[i] = i > 0 && marks[i - 1] < 3 ? back[i - 1] + 1 : 1;
  const ahead = [];
  for (let i = count - 1; i >= 0; i--) ahead[i] = marks[i] < 3 && i + 1 < count ? ahead[i + 1] + 1 : 1;
  const after = (k) => {
    if (k + 1 === count) return 0;
    const at = words[k + 1].n !== null ? BREAK.verse : [BREAK.within, BREAK.comma, BREAK.clause, BREAK.sentence][marks[k]];
    return at + (marks[k] < 3 && (back[k] <= 2 || ahead[k + 1] <= 2) ? BREAK.fragment : 0);
  };
  const best = Array(count + 1).fill(Infinity);
  const from = Array(count + 1).fill(0);
  best[0] = 0;
  for (let j = 0; j < count; j++) {
    let length = 0;
    for (let i = j; i >= 0; i--) {
      length += lengths[i] + (i < j ? 1 : 0);
      if (i < j && length > target * LONGEST) break;
      const apart = (length - target) / target;
      const cost = best[i] + UNEVEN * apart * apart + after(j);
      if (cost < best[j + 1]) {
        best[j + 1] = cost;
        from[j + 1] = i;
      }
    }
  }
  const ends = [];
  for (let j = count; j > 0; j = from[j]) ends.unshift(j);
  let start = 0;
  return ends.map((end) => {
    const segments = [];
    for (const w of words.slice(start, end)) {
      const last = segments.at(-1);
      if (last && w.n === null) last.t = last.t ? `${last.t} ${w.t}` : w.t;
      else segments.push({ n: w.n, t: w.t });
    }
    start = end;
    return segments;
  });
}

/** A Bible item's frozen content with its slides broken as the core breaks them; else the content as it was. */
export function bibleContent(content) {
  try {
    const c = JSON.parse(content);
    return Array.isArray(c?.slides) ? JSON.stringify({ ...c, slides: bibleSlides(c.slides) }) : content;
  } catch {
    return content;
  }
}
