import { describe, expect, it } from 'vitest';
import { addMonths, calendarDays, cellDate, dateLabel, localToday, monthTitle, tileOf } from '../src/pages/dashboard.ts';

// The start page's lists are the core's (`startPageView`, `calendarMonthView`, `presentationTableView`), tested in
// packages/core/test/node/page-models.test.ts.
describe('the start page', () => {
  it('says Idag and Imorgon, else the short date as the current app writes it', () => {
    expect(dateLabel('2026-10-27', '2026-10-27', true)).toBe('Idag');
    expect(dateLabel('2026-10-28', '2026-10-27', false)).toBe('Imorgon');
    expect(dateLabel('2026-05-04', '2026-10-27', true)).toBe('mån 4 maj 2026');
    expect(dateLabel('2026-11-05', '2026-10-27', false)).toBe('tors 5 november');
  });

  it("today is the device's own date, not UTC's", () => {
    expect(localToday(new Date(2026, 0, 1, 0, 30))).toBe('2026-01-01');
  });

  it('gives a date tile the short weekday, the day and the short month', () => {
    expect(tileOf('2026-11-15')).toEqual({ weekday: 'sön', day: '15', month: 'nov' });
  });

  it('names a month with a capital, and its year only when it is not this year or asked', () => {
    expect(monthTitle('2026-11', '2026-11-27')).toBe('November');
    expect(monthTitle('2025-12', '2026-01-10')).toBe('December 2025');
    expect(monthTitle('2026-11', '2026-11-27', true)).toBe('November 2026');
  });

  it('writes a table’s date short, with the year only when it is not this year', () => {
    expect(cellDate('2026-11-05', '2026-10-27')).toBe('5 nov');
    expect(cellDate('2025-05-04', '2026-10-27')).toBe('4 maj 2025');
  });

  it('steps months across a new year', () => {
    expect([addMonths('2026-12', 1), addMonths('2026-01', -1)]).toEqual(['2027-01', '2025-12']);
  });

  it('starts a month’s calendar on the Monday of its first week, six weeks long', () => {
    const days = calendarDays('2026-11');

    expect([days[0], days[6], days.length]).toEqual(['2026-10-26', '2026-11-01', 42]);
  });
});
