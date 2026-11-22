// A template's weekly slot (spec 03 "Template"), apart from the pages so it can be tested.
import type { Presentation } from '@gp/core';
import { pageCore } from '../db/pageCore.ts';
import { t } from '../i18n.ts';
import { localToday } from './dashboard.ts';

/** The days in the order the select lists them: from the Swedish first day of the week, Monday (TemplateDetailsDialog.razor). */
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0] as const;

export function weekdayName(day: number): string {
  return t(`weekday.${day}` as 'weekday.0');
}

/** A template's slot as the core works it out (`templateView`): its day's text key and time, its place, the date a
 * presentation from it is prefilled with. */
interface Slot {
  schedule: { day: `weekday.${0 | 1 | 2 | 3 | 4 | 5 | 6}` | null; time: string | null };
  location: string | null;
  nextDate: string;
}

const slot = (template: Pick<Presentation, 'weekday' | 'time'> & { location?: string | null }, now = new Date()): Slot => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return pageCore().pure<Slot>('templateView', {
    template: { weekday: template.weekday, time: template.time, location: template.location ?? null },
    today: localToday(now),
    now: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
  });
};

/** "Söndag 11:00": the day and the time, either alone, or null when the template has neither (Sidebar.razor). */
export function scheduleLine(template: Pick<Presentation, 'weekday' | 'time'>): string | null {
  const { day, time } = slot(template).schedule;
  const parts = [day ? t(day) : null, time].filter(Boolean);
  return parts.length ? parts.join(' ') : null;
}

/** "Söndag 11:00 · Kyrkan", the picker's line under a template's name (Dashboard.razor). */
export function templateDetails(template: Pick<Presentation, 'weekday' | 'time' | 'location'>): string {
  return [scheduleLine(template), template.location].filter(Boolean).join(' · ');
}

/**
 * The date a presentation from the template is prefilled with: the next time its weekday comes, today if that is
 * today and its time has not passed yet (or it has no time), else a week on; empty without a weekday. The core's rule.
 */
export function nextDate(template: Pick<Presentation, 'weekday' | 'time'>, now = new Date()): string {
  return slot(template, now).nextDate;
}
