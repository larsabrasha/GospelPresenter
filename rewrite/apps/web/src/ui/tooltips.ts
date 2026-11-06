// The app's tooltips in place of the browser's own (Lars, 2026-11-06, as ~/Developer/bygg's Radix tooltips): the
// browser's waits more than a second, cannot be styled, and looks out of place in Electron. One layer for the whole
// app reads the `title` the elements already have, so no component changes: on hover with a mouse or a pen, or on
// focus by the keyboard, it takes the element's `title` away (so the browser's own does not show too), shows its own
// after 300 ms (at once if another showed a moment ago), and gives the `title` back when the pointer or focus leaves.
// None on a touch screen, where the finger covers it. A shortcut at a title's end, "(⌘K)", is shown fainter.

/** How long the pointer rests before a tooltip shows; and how soon after one hides the next shows at once. */
const DELAY_MS = 300;
const SKIP_MS = 400;
/** The gap to the element, and the least room kept to the window's edges. */
const GAP = 6;
const EDGE = 8;

/** A title as its text and the shortcut at its end, if it has one: "Sök i allt (⌘K)" is "Sök i allt" and "⌘K". */
export function splitKeys(title: string): { text: string; keys: string | null } {
  const m = /^(.+?)\s*\(((?:⌘|Ctrl\+|⌥|⇧|Alt\+)[^()]{1,12})\)$/.exec(title.trim());
  return m ? { text: m[1]!, keys: m[2]! } : { text: title.trim(), keys: null };
}

/**
 * Where a tooltip `size` big goes for an element at `box` in a window `view` big: centred under it, above it when there
 * is no room below, and moved in from the sides to stay `EDGE` inside the window.
 */
export function tipPlace(
  box: { left: number; top: number; width: number; height: number },
  size: { width: number; height: number },
  view: { width: number; height: number },
): { left: number; top: number } {
  const below = box.top + box.height + GAP;
  const top = below + size.height + EDGE <= view.height ? below : Math.max(EDGE, box.top - GAP - size.height);
  const centred = box.left + box.width / 2 - size.width / 2;
  const left = Math.min(Math.max(EDGE, centred), Math.max(EDGE, view.width - EDGE - size.width));
  return { left, top };
}

/** Installs the tooltips for the page's life. Once, before the app renders. */
export function installTooltips(): void {
  let target: Element | null = null;
  let timer = 0;
  let hiddenAt = -Infinity;
  let tip: HTMLDivElement | null = null;

  /** Takes the element's title away, keeping it and, where it was the element's only name, its name. */
  const stash = (el: Element): string | null => {
    const title = el.getAttribute('title');
    if (!title) return null;
    el.setAttribute('data-tip', title);
    el.removeAttribute('title');
    if (!el.hasAttribute('aria-label') && !el.textContent?.trim()) {
      el.setAttribute('aria-label', title);
      el.setAttribute('data-tip-label', '');
    }
    return title;
  };
  /** Gives the title back, unless the page has set a new one meanwhile. */
  const unstash = (el: Element) => {
    const title = el.getAttribute('data-tip');
    el.removeAttribute('data-tip');
    if (el.hasAttribute('data-tip-label')) {
      el.removeAttribute('aria-label');
      el.removeAttribute('data-tip-label');
    }
    if (title !== null && !el.hasAttribute('title')) el.setAttribute('title', title);
  };

  const hide = () => {
    clearTimeout(timer);
    if (target) unstash(target);
    target = null;
    if (tip?.isConnected) {
      tip.remove();
      hiddenAt = performance.now();
    }
  };

  const show = (el: Element, title: string) => {
    if (target !== el || !el.isConnected) return;
    tip ??= Object.assign(document.createElement('div'), {
      role: 'tooltip',
      className:
        'fixed z-[1000] flex max-w-64 items-center gap-2 rounded-md bg-stone-800 px-2 py-1 text-xs text-white shadow-md pointer-events-none select-none dark:bg-stone-100 dark:text-stone-900',
    });
    const { text, keys } = splitKeys(title);
    tip.replaceChildren(Object.assign(document.createElement('span'), { textContent: text }));
    if (keys) tip.append(Object.assign(document.createElement('kbd'), { className: 'font-sans opacity-60', textContent: keys }));
    tip.style.visibility = 'hidden';
    document.body.append(tip);
    const at = tipPlace(el.getBoundingClientRect(), tip.getBoundingClientRect(), { width: innerWidth, height: innerHeight });
    Object.assign(tip.style, { left: `${at.left}px`, top: `${at.top}px`, visibility: '' });
  };

  const start = (el: Element) => {
    if (el === target) return;
    hide();
    const title = stash(el);
    if (!title) return;
    target = el;
    timer = window.setTimeout(() => show(el, title), performance.now() - hiddenAt < SKIP_MS ? 0 : DELAY_MS);
  };

  /** The element a tooltip is for: the nearest with a title, or the one whose title is taken now. */
  const titled = (from: EventTarget | null) => (from instanceof Element ? from.closest('[title], [data-tip]') : null);

  document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    const el = titled(e.target);
    if (el) start(el);
    else hide();
  });
  document.addEventListener('focusin', (e) => {
    const el = e.target instanceof Element && e.target.matches(':focus-visible') ? titled(e.target) : null;
    if (el) start(el);
  });
  document.addEventListener('focusout', hide);
  document.documentElement.addEventListener('pointerleave', hide);
  // A press, a key, a scroll or the window going away ends it: what it named may have moved or gone.
  for (const type of ['pointerdown', 'keydown', 'wheel'] as const) document.addEventListener(type, hide, { capture: true, passive: true });
  addEventListener('scroll', hide, { capture: true, passive: true });
  addEventListener('blur', hide);
}
