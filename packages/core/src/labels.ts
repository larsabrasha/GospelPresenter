// The labels a new organisation starts with, with the current app's colours
// (spec 02 "Part label").

export const DEFAULT_LABEL_COLOR = '#6b7280';

const defaults: [string, string][] = [
  ['Verse', '#3478c7'],
  ['Verse 1', '#2e6ab8'],
  ['Verse 2', '#285da9'],
  ['Verse 3', '#22509a'],
  ['Verse 4', '#1c438b'],
  ['Verse 5', '#16367c'],
  ['Verse 6', '#10296d'],
  ['Chorus', '#c73448'],
  ['Chorus 1', '#b82e40'],
  ['Chorus 2', '#972738'],
  ['Chorus 3', '#7a2030'],
  ['Chorus 4', '#6b1c2a'],
  ['Bridge', '#7834c7'],
  ['Bridge 1', '#6b2eb8'],
  ['Bridge 2', '#5e28a9'],
  ['Bridge 3', '#4e2096'],
  ['PreChorus', '#c734a8'],
  ['Tag', '#c73434'],
  ['Intro', '#c7b834'],
  ['Ending', '#b8ad2e'],
  ['Outro', '#a9a228'],
  ['Interlude', '#34c734'],
  ['Vamp', '#34b834'],
  ['Turnaround', '#34a934'],
  ['Blank', '#1a1a1a'],
];

export const DEFAULT_LABELS = defaults.map(([text, color], sort) => ({ text, color, sort }));

/** A label's text as compared: two labels may not share it (spec 02 "Part label"), whatever their case or spacing. */
export function labelKey(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * The id a label made from `text` is given first: its normalised text, so the
 * same label made on two devices is one row. A label renamed since may hold it;
 * then the creating mutator adds a number (`freeLabelId`).
 */
export function labelId(text: string): string {
  return 'label:' + labelKey(text);
}

/**
 * The 25 default labels for an organisation (SONG-R47), written once by the
 * server when it opens the database, so they sync like any change and one the
 * organisation deletes stays deleted. A label that already has the text (one
 * made from a song before the labels page) is left as it is.
 */
export const labelSeedSql: string[] = [
  `CREATE TABLE IF NOT EXISTS server_seeds (what TEXT PRIMARY KEY NOT NULL)`,
  ...DEFAULT_LABELS.map(
    (l) =>
      `INSERT INTO labels (id, text, color, sort) SELECT '${labelId(l.text)}', '${l.text}', '${l.color}', ${l.sort}
       WHERE NOT EXISTS (SELECT 1 FROM server_seeds WHERE what = 'labels')
         AND NOT EXISTS (SELECT 1 FROM labels WHERE id = '${labelId(l.text)}' OR lower(trim(text)) = '${labelKey(l.text)}')`,
  ),
  `INSERT INTO server_seeds (what) SELECT 'labels' WHERE NOT EXISTS (SELECT 1 FROM server_seeds WHERE what = 'labels')`,
];

/** The colour and order a label gets when it is created from its text. */
export function labelDefaults(text: string): { color: string; sort: number } {
  const known = DEFAULT_LABELS.find((l) => labelId(l.text) === labelId(text));
  return known ? { color: known.color, sort: known.sort } : { color: DEFAULT_LABEL_COLOR, sort: DEFAULT_LABELS.length };
}
