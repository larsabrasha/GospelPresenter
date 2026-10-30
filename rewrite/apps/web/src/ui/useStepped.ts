import { startTransition, useEffect, useState } from 'react';

/**
 * The first rows of `items`, more each task until all of them: a new list is
 * drawn in steps, so a long one (3 000 songs) does not hold up the page while
 * it is made. Each step yields to any other update (a transition). `first`
 * should be more than a screen holds.
 */
export function useStepped<T>(items: T[], first = 60, more = 300): T[] {
  const [drawn, setDrawn] = useState({ items, rows: first });
  // A new list starts over, in the same render.
  const current = drawn.items === items ? drawn : { items, rows: first };
  if (current !== drawn) setDrawn(current);
  useEffect(() => {
    if (current.rows >= items.length) return;
    const timer = setTimeout(() => startTransition(() => setDrawn((d) => (d.items === items ? { items, rows: d.rows + more } : d))), 0);
    return () => clearTimeout(timer);
  }, [current.rows, items, more]);
  return current.rows >= items.length ? items : items.slice(0, current.rows);
}
