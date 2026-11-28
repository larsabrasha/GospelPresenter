// The calendar's rules that every end shares (docs/planning.md): what a field holds, who may see an event outside the
// church, and the limits the mutators keep.

/** Who may see an event outside the church: no one, the time and the place only ("Uthyrd"), or its title and description too. */
export const VISIBILITIES = ['hidden', 'busy', 'shown'] as const;
export type Visibility = (typeof VISIBILITIES)[number];

/** One name in a field: text as typed, or a member of the organisation, with their name as it was when picked. */
export type FieldEntry = { text: string } | { person: string; name: string };

/** The calendar's limits: events (templates and the trash not counted), a field's characters and entries, an import's rows. */
export const EVENT_LIMITS = {
  events: 5000,
  templates: 50,
  fieldsPerEvent: 30,
  entriesPerField: 20,
  fieldName: 50,
  entry: 200,
  title: 200,
  busyWord: 30,
  importAtOnce: 1000,
} as const;

/** What an entry says: its text, or the person's name. */
export const entryText = (e: FieldEntry): string => ('person' in e ? e.name : e.text);

/** Whether a field still needs someone: nothing is in it (docs/planning.md, "Missing"). */
export const isMissing = (entries: readonly FieldEntry[]): boolean => entries.length === 0;
