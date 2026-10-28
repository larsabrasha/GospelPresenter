/** "lör 1 nov. 2026" in the viewer's (Swedish) calendar; the date is a plain day, not an instant. */
export function formatEventDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString('sv-SE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}
