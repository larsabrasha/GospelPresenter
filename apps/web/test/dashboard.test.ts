import { describe, expect, it } from 'vitest';
import { dateLabel, localToday } from '../src/pages/dashboard.ts';

// The start page's lists are the core's `startPageView`, tested in packages/rust-core/test/page-models.test.ts.
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
});
