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

/** A label's id: its normalised text, so the same label made on two devices is one row. */
export function labelId(text: string): string {
  return 'label:' + text.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** The colour and order a label gets when it is created from its text. */
export function labelDefaults(text: string): { color: string; sort: number } {
  const known = DEFAULT_LABELS.find((l) => labelId(l.text) === labelId(text));
  return known ? { color: known.color, sort: known.sort } : { color: DEFAULT_LABEL_COLOR, sort: DEFAULT_LABELS.length };
}
