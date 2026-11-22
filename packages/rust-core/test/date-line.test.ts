// A presentation's date line (`dateLineView`, crates/gp-core/src/date_line.rs) against the web's dashboard.ts, which
// writes a date with Intl (`shortDate`): the same words for every day of two years, in Swedish and English, with the
// year and without it.
import { describe, expect, it } from 'vitest';
import { nodeRustCore } from '../src/node.ts';

/** dashboard.ts's shortDate, as it stands: "mån 4 maj", with the year when asked. */
function web(iso: string, withYear: boolean, locale: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const parts = new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'long', ...(withYear ? { year: 'numeric' } : {}) }).formatToParts(new Date(y!, m! - 1, d!));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return [part('weekday').replace(/\.$/, ''), part('day'), part('month'), withYear ? part('year') : ''].filter(Boolean).join(' ');
}

function days(from: string, n: number): string[] {
  const [y, m, d] = from.split('-').map(Number);
  return Array.from({ length: n }, (_, i) => {
    const at = new Date(y!, m! - 1, d! + i);
    return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
  });
}

describe('dateLineView', () => {
  const core = nodeRustCore();
  const today = '2026-01-01';
  for (const [locale, intl] of [['sv', 'sv-SE'], ['en', 'en-GB']] as const) {
    for (const withYear of [false, true]) {
      it(`writes every day of 2027 and 2028 as the web does (${locale}${withYear ? ', with the year' : ''})`, () => {
        const differ = days('2027-01-01', 731).filter((iso) => {
          const { parts } = core.pure<{ parts: { text?: string }[] }>('dateLineView', { today, locale, eventDate: iso, withYear });
          return parts[0]?.text !== web(iso, withYear, intl);
        });

        expect(differ).toEqual([]);
      });
    }
  }
});
