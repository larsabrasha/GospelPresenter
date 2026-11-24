// A template's weekly slot (spec 03 "Template"), apart from the pages so it can be tested.
import type { Presentation } from '@gp/core';
import { t } from '../i18n.ts';
import { localToday } from './dashboard.ts';

/** The days in the order the select lists them: from the Swedish first day of the week, Monday (TemplateDetailsDialog.razor). */
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0] as const;

export function weekdayName(day: number): string {
  return t(`weekday.${day}` as 'weekday.0');
}

/** "Söndag 11:00": the day and the time, either alone, or null when the template has neither (Sidebar.razor). */
export function scheduleLine(template: Pick<Presentation, 'weekday' | 'time'>): string | null {
  const parts = [template.weekday !== null ? weekdayName(template.weekday) : null, template.time].filter(Boolean);
  return parts.length ? parts.join(' ') : null;
}

/** "Söndag 11:00 · Kyrkan", the picker's line under a template's name (Dashboard.razor). */
export function templateDetails(template: Pick<Presentation, 'weekday' | 'time' | 'location'>): string {
  return [scheduleLine(template), template.location].filter(Boolean).join(' · ');
}

/**
 * The date a presentation from the template is prefilled with: the next time
 * its weekday comes, today if that is today and its time has not passed yet
 * (or it has no time), else a week on. Empty without a weekday.
 */
export function nextDate(template: Pick<Presentation, 'weekday' | 'time'>, now = new Date()): string {
  if (template.weekday === null) return '';
  let days = (template.weekday - now.getDay() + 7) % 7;
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  if (days === 0 && template.time !== null && time >= template.time) days = 7;
  return localToday(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days));
}
