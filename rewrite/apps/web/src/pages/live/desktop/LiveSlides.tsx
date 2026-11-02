import { sortedArrangements, type LivePointer, type Overlay, type PresentationItem, type Song, type SongArrangement, type Theme } from '@gp/core';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { t } from '../../../i18n.ts';
import { followsShown } from '../../../live/liveList.ts';
import type { ItemSlides } from '../../../live/live.ts';
import { AppButton } from '../../../ui/AppButton.tsx';
import { EmptySlidesPicture } from '../../../ui/icons.tsx';
import { href } from '../../../ui/router.ts';
import { ImageItemEditor, ItemMedia, ItemSettings, ItemWarnings, type Players } from '../../presentation-editor/ItemParts.tsx';
import { ItemMenu, OverlayChip } from './ItemMenu.tsx';
import { SlideGrid } from '../../presentation-editor/SlideGrid.tsx';

/** How tall a section's sticky heading is: a slide under it is out of view. */
const HEADING = 44;

/** A small round button in a section's heading. */
const HEADING_BUTTON = 'ml-1 h-7 px-2.5 rounded-full flex items-center gap-1 normal-case tracking-normal font-medium cursor-pointer';

/** `text` with `marker` replaced by `bold` in bold. */
function withBold(text: string, marker: string, bold: string): ReactNode {
  const [before, after] = text.split(marker);
  return (
    <>
      {before}
      <strong>{bold}</strong>
      {after}
    </>
  );
}

/**
 * The middle of a presentation on a computer, the same before and while it is presented (docs/layout-2-0.md): the
 * whole running order, each item a section whose heading sticks at the top, its slides a grid. The heading renames
 * the item, opens its song or edits its pictures; under it the item's warnings, its player, its arrangement and
 * overlay. While presenting (`players`) a click on a slide shows it, and the slides follow the shown one only when
 * it changed some other way than a click here, and only when out of view. `reveal` scrolls to an item chosen at the
 * left.
 */
export function LiveSlides({
  items,
  slides,
  theme,
  songs,
  arrangements,
  overlays,
  pointer,
  players,
  reveal,
  onShow,
  onAddImages,
}: {
  items: PresentationItem[];
  slides: Map<string, ItemSlides>;
  theme: Theme;
  songs: Map<string, Song>;
  arrangements: SongArrangement[];
  overlays: Overlay[];
  pointer: LivePointer;
  /** While presenting: the session's players, and slides that show when clicked. */
  players?: Players;
  /** The item last chosen at the left, and a count so choosing it again scrolls again. */
  reveal: { id: string; n: number } | null;
  onShow: (itemId: string, partIndex: number) => void;
  /** "Lägg till bilder" on an image item: the add dialog's picture tab, adding to it. */
  onAddImages: (itemId: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const clicked = useRef(false);
  // Redigera on an image item: its pictures to reorder, remove and add to, one item at a time.
  const [editingImages, setEditingImages] = useState<string | null>(null);

  // Once for each slide shown, on opening too.
  const shownKey = `${pointer.itemId}/${pointer.partIndex}`;
  const followed = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (followed.current === shownKey) return;
    followed.current = shownKey;
    const el = box.current;
    const tile = el?.querySelector<HTMLElement>('[aria-pressed="true"]');
    const byTap = clicked.current;
    clicked.current = false;
    if (!el || !tile) return;
    const top = tile.getBoundingClientRect().top - el.getBoundingClientRect().top;
    // The sticky heading as it is drawn (its … makes it taller than HEADING), so the tile's ring is never under it.
    const heading = tile.closest('section')?.querySelector('h3')?.offsetHeight ?? HEADING;
    if (followsShown({ byTap, top, bottom: top + tile.offsetHeight, viewHeight: el.clientHeight, headingHeight: heading }))
      el.scrollTo({ top: el.scrollTop + top - heading - 16, behavior: 'smooth' });
  }, [shownKey]);

  useEffect(() => {
    const el = box.current;
    const section = reveal ? el?.querySelector<HTMLElement>(`[data-item="${reveal.id}"]`) : null;
    if (el && section) el.scrollTo({ top: section.offsetTop, behavior: 'smooth' });
  }, [reveal]);

  // `elevated`: a step lighter in dark mode, so black slides stand out from the ground (app.css).
  return (
    <div ref={box} className="elevated relative flex-1 min-w-0 overflow-y-auto px-6 pb-12 bg-ground" data-testid="live-slides">
      {!items.length && (
        <div className="h-full flex flex-col items-center justify-center text-center px-6 py-12 select-none">
          <EmptySlidesPicture className="w-48 h-auto mb-6 text-stone-300 dark:text-stone-600" />
          <h2 className="text-lg/7 font-semibold text-stone-500 dark:text-stone-400 mb-2">{t('presentation.empty')}</h2>
          <p className="text-sm text-stone-400 dark:text-stone-500 max-w-xs leading-relaxed">{withBold(t('presentation.emptyText'), '{add}', t('presentation.add'))}</p>
        </div>
      )}
      {items.map((item) => {
        const set = slides.get(item.id);
        const song = item.type === 'song' ? songs.get(item.sourceId) : undefined;
        const editing = item.type === 'image' && editingImages === item.id;
        return (
          <section key={item.id} data-item={item.id} aria-label={item.title} className="flex flex-col gap-2 pb-3">
            <h3 className="sticky top-0 z-[2] -mx-6 px-6 pt-3.5 pb-2 min-h-[44px] flex items-center gap-2.5 text-[13px] font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400 bg-ground/90 backdrop-blur-md">
              {/* The item's name, not renamed here: that confused (Lars, 2026-11-02). */}
              <span className="min-w-0 truncate">{item.title}</span>
              {item.id === pointer.itemId && !pointer.black && <span className="size-2 rounded-full bg-red-500 shrink-0" aria-label={t('live.badge')} />}
              <OverlayChip item={item} overlays={overlays} />
              {/* While its pictures are edited, Klar ends it at once; otherwise Redigera and the overlay are in its …. */}
              {editing ? (
                <AppButton variant="plain" onClick={() => setEditingImages(null)} className={`${HEADING_BUTTON} ml-auto bg-sky-500 text-white hover:bg-sky-600`}>
                  {t('presentation.doneEditingImages')}
                </AppButton>
              ) : (
                <ItemMenu
                  item={item}
                  overlays={overlays}
                  // A song opens alone in Inställningar, and Stäng comes back here, also while presenting.
                  editHref={song?.deletedAt === null ? href({ page: 'song', id: item.sourceId }) : undefined}
                  onEditImages={item.type === 'image' ? () => setEditingImages(item.id) : undefined}
                />
              )}
            </h3>
            <ItemWarnings item={item} set={set} songName={song?.name} />
            <ItemMedia item={item} set={set} players={players} shownId={pointer.itemId} />
            <ItemSettings item={item} song={song} arrangements={song ? sortedArrangements(arrangements, song.id) : []} overlays={overlays} withoutOverlay />
            {set && editing ? (
              <ImageItemEditor item={item} slides={set.slides} theme={theme} onAddImages={() => onAddImages(item.id)} />
            ) : (
              !!set?.slides.length && (
                <SlideGrid
                  slides={set.slides}
                  label={item.title}
                  theme={theme}
                  overlayId={item.overlayId}
                  shown={
                    players && {
                      pointer,
                      itemId: item.id,
                      onShow: (partIndex) => {
                        clicked.current = true;
                        onShow(item.id, partIndex);
                      },
                    }
                  }
                />
              )
            )}
          </section>
        );
      })}
    </div>
  );
}
