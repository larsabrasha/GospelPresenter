import { describe, expect, it } from 'vitest';
import { nextDate, scheduleLine, templateDetails } from '../src/pages/templates.ts';

// 2026-11-01 is a Sunday.
const sunday = (hours: number, minutes = 0) => new Date(2026, 10, 1, hours, minutes);

describe("a template's weekly slot", () => {
  it('PRES-A3: a Sunday template is today before its time', () => {
    expect(nextDate({ weekday: 0, time: '11:00' }, sunday(10, 59))).toBe('2026-11-01');
  });

  it('PRES-A3: a Sunday template is next week from its time on', () => {
    expect(nextDate({ weekday: 0, time: '11:00' }, sunday(11))).toBe('2026-11-08');
  });

  it('a template without a time is today all day on its weekday', () => {
    expect(nextDate({ weekday: 0, time: null }, sunday(23, 30))).toBe('2026-11-01');
  });

  it('another weekday is the next one to come, across a month end', () => {
    expect(nextDate({ weekday: 6, time: null }, new Date(2026, 9, 30, 12))).toBe('2026-10-31');
    expect(nextDate({ weekday: 1, time: null }, new Date(2026, 9, 31, 12))).toBe('2026-11-02');
  });

  it('a template without a weekday prefills no date', () => {
    expect(nextDate({ weekday: null, time: '11:00' }, sunday(9))).toBe('');
  });

  it('the picker joins day, time and place; whatever is missing is left out', () => {
    expect(templateDetails({ weekday: 0, time: '11:00', location: 'Kyrkan' })).toBe('Söndag 11:00 · Kyrkan');
    expect(templateDetails({ weekday: null, time: null, location: 'Kyrkan' })).toBe('Kyrkan');
    expect(scheduleLine({ weekday: null, time: null })).toBeNull();
  });
});
