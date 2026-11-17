import { planVerseSearch, type BibleBookText, type Verse } from '../src/index.ts';

/**
 * The verses a reference query selects among `books`, in the books' order: the plan the page makes, applied as the
 * Rust core's bibleView reads it (crates/gp-core/src/bible_view.rs), so the tests read the planning's effect.
 */
export function searchVerses(query: string, books: BibleBookText[]): Verse[] {
  const plan = planVerseSearch(
    query,
    books.map((b) => b.code),
  );
  if (!plan) return [];
  const within = (c: number, v: number) => (c > plan.from[0] || (c === plan.from[0] && v >= plan.from[1])) && (c < plan.to[0] || (c === plan.to[0] && v <= plan.to[1]));
  return books.filter((b) => plan.codes.includes(b.code)).flatMap((b) => b.verses.filter(([c, v]) => within(c, v)).map(([c, v, t]) => ({ b: b.code, c, v, t })));
}
