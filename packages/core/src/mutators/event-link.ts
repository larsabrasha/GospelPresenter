import { and, eq, isNull } from 'drizzle-orm';
import { EVENT_LIMITS } from '../calendar.ts';
import { events, presentations } from '../schema.ts';
import type { Tx } from './base.ts';

// A presentation is what shows at an event, and its date is the event's (docs/planning.md, "One date"; Lars,
// 2026-11-28): a presentation with a date has its event, made with it, and its date, time and place, changed from the
// presentation, are written to the event too. The event's own changes reach the presentation in events.ts.

/**
 * The event of presentation `presentationId` after its date, time or place was set: written there; made when it has a
 * date and no event (its id the presentation's, the same on every device); let go when its date was taken away, the
 * event staying in the calendar. An event of that id already there (one in the trash) leaves it without one.
 */
export async function eventFollowsPresentation(tx: Tx, presentationId: string, at: number) {
  const [p] = await tx.select().from(presentations).where(and(eq(presentations.id, presentationId), eq(presentations.isTemplate, false)));
  if (!p) return;
  const [linked] = await tx
    .select({ id: events.id })
    .from(events)
    .where(and(eq(events.presentationId, p.id), eq(events.isTemplate, false), isNull(events.deletedAt)));
  if (linked) {
    if (p.eventDate) await tx.update(events).set({ date: p.eventDate, time: p.time, place: p.location, updatedAt: at }).where(eq(events.id, linked.id));
    else await tx.update(events).set({ presentationId: null, updatedAt: at }).where(eq(events.id, linked.id));
    return;
  }
  if (!p.eventDate) return;
  const [taken] = await tx.select({ id: events.id }).from(events).where(eq(events.id, p.id));
  if (taken) return;
  await tx.insert(events).values({
    id: p.id,
    title: p.name.slice(0, EVENT_LIMITS.title),
    date: p.eventDate,
    time: p.time,
    endDate: null,
    endTime: null,
    place: p.location,
    description: null,
    visibility: 'hidden',
    busyWord: null,
    presentationId: p.id,
    isTemplate: false,
    deletedAt: null,
    updatedAt: at,
  });
}
