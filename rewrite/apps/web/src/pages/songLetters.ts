// Sånger's sections by first letter, as Contacts and Music's Låtar have them (Lars, 2026-11-02).

/** The section a name goes under: its first letter in capitals, Å, Ä and Ö their own; "#" for a digit or a sign. */
export function letterOf(name: string): string {
  const first = name.trim().charAt(0).toLocaleUpperCase('sv');
  return /\p{L}/u.test(first) ? first : '#';
}

/** The songs, already in the list's order, in runs by letter: each letter once, where its first song is. */
export function byLetter<T extends { name: string }>(songs: readonly T[]): { letter: string; songs: T[] }[] {
  const sections: { letter: string; songs: T[] }[] = [];
  const at = new Map<string, { letter: string; songs: T[] }>();
  for (const song of songs) {
    const letter = letterOf(song.name);
    let section = at.get(letter);
    if (!section) {
      section = { letter, songs: [] };
      at.set(letter, section);
      sections.push(section);
    }
    section.songs.push(song);
  }
  return sections;
}
