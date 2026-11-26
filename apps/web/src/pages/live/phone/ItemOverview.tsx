// A phone's overview of the running order (docs/layout-2-0.md, Lars 2026-11-26): each item one row until it is opened,
// so the whole service fits a screen, for whoever runs it and for someone given a link to control it remotely.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { Overlay, PresentationItem } from '@gp/core';
import { t } from '../../../i18n.ts';
import { AppButton } from '../../../ui/AppButton.tsx';
import { ChevronDownIcon, ChevronRightIcon, CommentIcon, ItemBadge, SquaresOverlapIcon } from '../../../ui/icons.tsx';
import { NOTE_CHIP, OVERLAY_CHIP } from '../OverlayChip.tsx';

/**
 * Which items show their parts: the one shown while presenting, and the one the user opened, kept open when the shown
 * one moves on, so nothing closes under a finger. At most two: opening another closes the one opened before. The shown
 * one closes by its chevron too, and opens again when the next item is shown. An item just added opens, as the list
 * goes to it. On a computer (`overview` false) every item shows its parts.
 */
export function useItemOverview({ overview, shownId, toItem }: { overview: boolean; shownId: string | null; toItem: { id: string } | null }) {
  const [opened, setOpened] = useState<string | null>(null);
  const [closedShown, setClosedShown] = useState<string | null>(null);
  const [lastTo, setLastTo] = useState(toItem);
  if (toItem !== lastTo) {
    setLastTo(toItem);
    if (toItem) setOpened(toItem.id);
  }
  const isOpen = (itemId: string) => !overview || itemId === opened || (itemId === shownId && itemId !== closedShown);
  return {
    isOpen,
    /** Opens an item, or closes it, the shown one too. */
    toggle: (itemId: string) => {
      const open = isOpen(itemId);
      setOpened(open ? (o) => (o === itemId ? null : o) : itemId);
      setClosedShown(open && itemId === shownId ? itemId : null);
    },
    opened: overview ? opened : null,
    /** Whether the user is looking at an item other than the shown one: the list then neither follows nor jumps. */
    hold: overview && opened !== null && opened !== shownId,
  };
}

/**
 * Keeps the item the user opened where it is on the screen while items above it open and close as the shown one moves
 * on (Safari has no scroll anchoring of its own): after each render, the list scrolls by as much as the item moved.
 */
export function useKeepInPlace(box: RefObject<HTMLElement | null>, anchorId: string | null) {
  const last = useRef<{ id: string; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = box.current;
    const section = el && anchorId ? el.querySelector<HTMLElement>(`[data-item="${anchorId}"]`) : null;
    const before = last.current;
    if (el && section && before?.id === anchorId) {
      const moved = section.getBoundingClientRect().top - before.top;
      if (Math.abs(moved) > 0.5) el.scrollBy({ top: moved, behavior: 'instant' });
    }
    const record = () => {
      last.current = section && anchorId ? { id: anchorId, top: section.getBoundingClientRect().top } : null;
    };
    record();
    el?.addEventListener('scroll', record, { passive: true });
    return () => el?.removeEventListener('scroll', record);
  });
}

/**
 * "Till det som visas": while the user looks at another item and the shown part is out of view, a pill at the foot
 * of the list that glides to it, drawn anew (keyed) for each part shown. Whether the part is away is the observer's
 * last word, read only while `active`.
 */
export function ToShownButton({ box, active }: { box: RefObject<HTMLElement | null>; active: boolean }) {
  const [away, setAway] = useState(false);
  useEffect(() => {
    const el = box.current;
    const part = active ? el?.querySelector<HTMLElement>('[data-current="true"], [data-rested="true"]') : null;
    if (!el || !part) return;
    const watch = new IntersectionObserver(([e]) => setAway(!e!.isIntersecting), { root: el });
    watch.observe(part);
    return () => watch.disconnect();
  }, [box, active]);
  if (!active || !away) return null;
  return (
    <AppButton
      variant="plain"
      onClick={() => box.current?.querySelector('[data-current="true"], [data-rested="true"]')?.scrollIntoView({ block: 'center', behavior: 'smooth' })}
      className="sticky bottom-24 z-[3] self-center mt-3 h-10 px-4 rounded-full flex items-center gap-2 text-sm font-semibold shadow-lg bg-red-600 text-white cursor-pointer"
    >
      <span className="size-2 rounded-full bg-white" aria-hidden />
      {t('live.toShown')}
    </AppButton>
  );
}

/**
 * An item's row on a phone, the same closed and open (Lars, 2026-11-26, as Notes' sections): its kind, its title and
 * how many parts it has, then its overlay and its comment as the running order's row has them (they say what shows and
 * what to mind), and a chevron, › closed and ⌄ open; a tap opens or closes it and shows nothing on the screens. The
 * chevron is at the far right, the … left of it, drawn over the row (the row is the button, and a button holds no
 * button) where the row keeps room for it. The item shown has the red dot at its left. A programme point (a heading
 * item) is the same row with its icon and nothing to open: no `onToggle`, the chevron's room empty, so the …s line up.
 */
export function ItemRow({
  item,
  parts,
  overlays,
  open,
  shown,
  marked,
  onToggle,
  menuButton,
}: {
  item: PresentationItem;
  parts: number;
  overlays: Overlay[];
  open: boolean;
  shown: boolean;
  /** Just added: its title blue for a moment, as a heading's was. */
  marked: boolean;
  onToggle?: () => void;
  menuButton: ReactNode;
}) {
  const overlay = item.overlayId ? overlays.find((o) => o.id === item.overlayId) : undefined;
  const row = 'grow min-w-0 flex items-center gap-3 pl-4 pr-4 py-3 min-h-14 text-left';
  const Chevron = open ? ChevronDownIcon : ChevronRightIcon;
  const content = (
    <>
      {shown && <span className="absolute left-1.5 top-1/2 -translate-y-1/2 size-2 rounded-full bg-red-500" aria-label={t('live.badge')} />}
      <ItemBadge type={item.type} />
        <span className="min-w-0 flex flex-col gap-0.5">
          <span className={`truncate text-[17px]/snug transition-colors ${marked ? 'text-sky-500' : 'text-stone-900 dark:text-stone-100'}`}>{item.title}</span>
          {parts > 0 && <span className="text-[13px]/[18px] text-stone-500 dark:text-stone-400">{t(parts === 1 ? 'live.parts.one' : 'live.parts.many', { n: parts })}</span>}
          {overlay && (
            <span className={`self-start ${OVERLAY_CHIP}`} title={t('overlays.itemOverlay')}>
              <SquaresOverlapIcon className="size-3 shrink-0" />
              <span className="truncate">{overlay.title}</span>
            </span>
          )}
          {item.note && (
            <span className={NOTE_CHIP}>
              <CommentIcon className="size-3 shrink-0" />
              <span className="truncate">{item.note}</span>
            </span>
          )}
        </span>
      {/* The …'s room, 44 pt, then the chevron's. */}
      <span className="ml-auto w-11 shrink-0" aria-hidden />
      {onToggle ? <Chevron className={CHEVRON} /> : <span className="size-4 shrink-0" aria-hidden />}
    </>
  );
  return (
    <div className="relative flex items-center rounded-2xl bg-surface">
      {onToggle ? (
        <AppButton variant="plain" aria-expanded={open} onClick={onToggle} className={`${row} cursor-pointer`}>
          {content}
        </AppButton>
      ) : (
        <span className={row}>{content}</span>
      )}
      {/* Right of the …: the row's 16 px, the chevron's 16 and the gap of 12. */}
      <span className="absolute right-11 top-1/2 -translate-y-1/2 flex">{menuButton}</span>
    </div>
  );
}

/** The chevron of a phone's item, at the far right of its row. */
const CHEVRON = 'size-4 shrink-0 text-stone-400 dark:text-stone-500';
