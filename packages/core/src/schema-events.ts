import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// The calendar's synced tables (docs/planning.md), beside the others in schema.ts, which lists them as synced.

/**
 * An event of the calendar (docs/planning.md): what happens in the church, when and where, and who does what (its
 * `event_fields`). A template of events is a row of its own kind here, as a presentation's template is (no date).
 */
export const events = sqliteTable('events', {
  id: text('id').primaryKey(),
  /** May be empty: a row of an imported sheet with a date only. */
  title: text('title').notNull(),
  /** ISO date, `YYYY-MM-DD`; null on a template. */
  date: text('date'),
  /** `HH:MM`, each optional. */
  time: text('time'),
  endDate: text('end_date'),
  endTime: text('end_time'),
  place: text('place'),
  /** Free text for whoever comes; the one text that may be shown outside the church. */
  description: text('description'),
  /** Who may see it outside the church: `hidden`, `busy` (the time and the place only) or `shown`. */
  visibility: text('visibility').notNull(),
  /** The word a `busy` event is shown with ("Uthyrd"); null says "Upptagen". */
  busyWord: text('busy_word'),
  /** The presentation linked to it, at most one each way; its date, time and place follow the event's. */
  presentationId: text('presentation_id'),
  isTemplate: integer('is_template', { mode: 'boolean' }).notNull().default(false),
  /** Set while it is in the trash. */
  deletedAt: integer('deleted_at'),
  updatedAt: integer('updated_at'),
});

/**
 * A field of an event ("Vem gör vad"): its name and what is in it, `entries` a JSON array of `{text}` or
 * `{person, name}` (a member's user id and their name when picked). `sort` orders an event's fields.
 */
export const eventFields = sqliteTable('event_fields', {
  id: text('id').primaryKey(),
  eventId: text('event_id')
    .notNull()
    .references(() => events.id),
  name: text('name').notNull(),
  sort: integer('sort').notNull(),
  entries: text('entries').notNull(),
});
