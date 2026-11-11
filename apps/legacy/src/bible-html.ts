import type { BibleSegment, BibleSlide } from '@gp/core';

// A Bible item's slide as 1.x stored it: HTML its BibleTextService made once, when the passage was added,
// `<div class="text-left"><sup class="opacity-40">16</sup>&nbsp;For God …</div>`. 2.0 keeps a slide as
// data (D12, D25), so the markup is read back into runs of words, each starting at a verse number.

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }
    return ENTITIES[e.toLowerCase()] ?? whole;
  });
}

/** Text without its tags, entities decoded, spaces (the non-breaking one after a verse number too) made one. */
const plain = (html: string) =>
  decode(html.replace(/<[^>]*>/g, ' '))
    .replace(/[\s ]+/g, ' ')
    .trim();

/**
 * One slide's segments. A `<sup>` holding a number starts a verse; the text before the first one, or all of
 * a slide without any (older or hand-made content), is a run without a number.
 */
export function bibleSlideFromHtml(html: string): BibleSlide {
  const segments: BibleSegment[] = [];
  const sup = /<sup\b[^>]*>\s*(\d{1,3})\s*<\/sup>/gi;
  let at = 0;
  let n: number | null = null;
  for (const m of html.matchAll(sup)) {
    const t = plain(html.slice(at, m.index));
    if (t || n !== null) segments.push({ n, t });
    n = Number(m[1]);
    at = m.index + m[0].length;
  }
  const t = plain(html.slice(at));
  if (t || n !== null) segments.push({ n, t });
  return segments;
}
