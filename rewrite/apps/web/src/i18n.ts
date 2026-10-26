// UI text. Keys are typed, so a missing translation is a type error (ADR 0007,
// decision 11). Milestone 1 ships Swedish only; English comes with the
// language switch.

const sv = {
  'app.name': 'Gospel Presenter',
  'nav.songs': 'Sånger',
  'nav.presentations': 'Presentationer',
  'status.connected': 'Ansluten',
  'status.offline': 'Offline',
  'status.pending': '{n} ändringar väntar',
  'status.memory': 'Data sparas bara i minnet: {reason}',
  'status.updateRequired': 'Servern kräver en nyare version av appen. Dina ändringar sparas tills du uppdaterar.',
  'status.rejected': 'Servern tog inte emot en ändring: {error}',
  'songs.new': 'Ny sång',
  'songs.search': 'Sök sång',
  'songs.empty': 'Inga sånger än.',
  'songs.namePrompt': 'Sångens namn',
  'song.name': 'Namn',
  'song.author': 'Upphovspersoner',
  'song.publisher': 'Utgivare',
  'song.year': 'År',
  'song.ccli': 'CCLI',
  'song.parts': 'Delar',
  'song.addPart': 'Lägg till del',
  'song.noLabel': 'Ingen etikett',
  'song.moveUp': 'Flytta upp',
  'song.moveDown': 'Flytta ned',
  'song.removePart': 'Ta bort del',
  'song.trash': 'Flytta till papperskorgen',
  'song.notFound': 'Sången finns inte.',
  'presentations.new': 'Ny presentation',
  'presentations.empty': 'Inga presentationer än.',
  'presentations.namePrompt': 'Presentationens namn',
  'presentation.name': 'Namn',
  'presentation.date': 'Datum',
  'presentation.items': 'Programpunkter',
  'presentation.addSong': 'Lägg till sång',
  'presentation.add': 'Lägg till',
  'presentation.close': 'Stäng',
  'presentation.added': 'Tillagd',
  'presentation.start': 'Starta',
  'presentation.empty': 'Inga programpunkter än.',
  'presentation.notFound': 'Presentationen finns inte.',
  'presentation.remove': 'Ta bort',
  'live.output': 'Extern skärm',
  'live.black': 'Svart skärm',
  'live.end': 'Avsluta',
  'live.songMissing': 'Sången finns inte längre.',
  'live.songTrashed': 'Sången ligger i papperskorgen och visas inte.',
  'live.noParts': 'Sången har inga delar.',
  'live.preview': 'Visas nu',
} as const;

export type TextKey = keyof typeof sv;

/** The text for `key`, with `{name}` placeholders filled from `vars`. */
export function t(key: TextKey, vars: Record<string, string | number> = {}): string {
  return sv[key].replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}
