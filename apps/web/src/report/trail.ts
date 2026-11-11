import { BUG_REPORT_LIMITS } from '@gp/core';

// The steps before a bug report (docs/bug-reports.md; Lars, 2026-11-05: what was done before, at no cost): the pages
// opened, what was pressed, the app's commands, the changes saved, what went live, and errors. A fixed ring of
// `BUG_REPORT_LIMITS.trail` entries, one push each, kept only in this page's memory and sent only with a report the user
// sees first. Never what is typed: no field's value, no search, no token; a page by its path alone, without its query
// or fragment (an invite's token is in the fragment).

export type StepKind = 'page' | 'press' | 'command' | 'change' | 'live' | 'error';

export interface Step {
  /** When, in ms since the epoch. */
  at: number;
  kind: StepKind;
  what: string;
  /** The same step again and again in a row (a field saved as it is typed in, a button pressed on): how many times. */
  times: number;
}

/** How long a step's text may be: a button's name, a path, a message's start. */
const MAX_WHAT = 80;

const steps: Step[] = [];

/**
 * Keeps a step; the oldest goes once the ring is full. The same step as the last one only counts again and moves its
 * time, so something done over and over takes one place rather than pushing the rest out.
 */
export function note(kind: StepKind, what: string, at = Date.now()): void {
  const text = what.slice(0, MAX_WHAT);
  const last = steps.at(-1);
  if (last && last.kind === kind && last.what === text) {
    last.times++;
    last.at = at;
    return;
  }
  steps.push({ at, kind, what: text, times: 1 });
  if (steps.length > BUG_REPORT_LIMITS.trail) steps.shift();
}

/** The steps, oldest first. */
export function trail(): Step[] {
  return steps.map((s) => ({ ...s }));
}

/** Forgets every step (tests). */
export function clearTrail(): void {
  steps.length = 0;
}

/** What a press counts as: something one presses, never a field. */
const PRESSABLE =
  'button, a[href], summary, [role="button"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="tab"], [role="option"], [role="switch"], [role="checkbox"]';

/** The parts of a page a press is told within: a dialog, a menu, a list, a set of tabs, a named region. */
const AREA = '[role="dialog"], [role="menu"], [role="listbox"], [role="tablist"], [role="toolbar"], [role="region"], nav[aria-label], ul[aria-label], ol[aria-label], section[aria-label]';

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

/** What labels an element: its `aria-label`, else the text of what `aria-labelledby` names. */
function label(el: Element): string {
  const by = el.getAttribute('aria-labelledby');
  return clean(el.getAttribute('aria-label') || (by && by.split(/\s+/).map((id) => document.getElementById(id)?.textContent).join(' ')));
}

/**
 * The name of what a press was on, as a screen reader says it (a button, link, menu row, tab or option), and the part
 * of the page it is in, so that "Radera" says which: "Radera · Felrapport". Null for anything else (a field, the page)
 * and inside `data-private`. A button without a name is named by its test id, else its tag: a screen reader has
 * nothing better to say of it either.
 */
function pressedName(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  const el = target.closest(PRESSABLE);
  if (!el || el.closest('[data-private]')) return null;
  const said = label(el) || clean(el.getAttribute('title') || el.textContent) || el.closest('[data-testid]')?.getAttribute('data-testid') || `(${el.tagName.toLowerCase()})`;
  const area = el.parentElement?.closest(AREA);
  const where = area ? label(area).slice(0, 40) : ''; // a part's label only: its text would be the whole of it
  return where && where !== said ? `${said} · ${where}` : said;
}

/** Starts the trail: the page now, each page after it, and each press. Once, in the signed-in app. */
export function installTrail(navigated: string): void {
  const page = () => note('page', location.pathname);
  page();
  addEventListener('popstate', page);
  addEventListener(navigated, page);
  // In the capture phase, so a press a handler stops still counts; passive, so it never delays the press.
  document.addEventListener(
    'click',
    (e) => {
      const name = pressedName(e.target);
      if (name) note('press', name);
    },
    { capture: true, passive: true },
  );
}
