import type { Presentation } from '@gp/core';

/**
 * A presentation's date and time as the side menu shows them, "2026-11-01 10:00"
 * (Sidebar.razor: the Swedish short date, then the time), or null with neither.
 */
export function eventLine(p: Pick<Presentation, 'eventDate' | 'time'>): string | null {
  const parts = [p.eventDate, p.time].filter(Boolean);
  return parts.length ? parts.join(' ') : null;
}
