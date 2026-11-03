import { type LivePointer, type Overlay, type PresentationItem, type Slide, type Song, type Theme } from '@gp/core';
import { useRef, useState, type ReactNode } from 'react';
import { t } from '../../i18n.ts';
import { slideMarks, type SlideMarkKind } from '../../live/liveList.ts';
import type { ItemSlides } from '../../live/live.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { EllipsisIcon, EmptySlidesPicture } from '../../ui/icons.tsx';
import { SlideMark } from '../../ui/SlideTile.tsx';
import { SlideView } from '../../ui/SlideView.tsx';
import { useWide } from '../../ui/useWide.ts';
import { ImageItemEditor, ItemMedia, ItemWarnings, type Players } from '../presentation-editor/ItemParts.tsx';
import { SlideGrid } from '../presentation-editor/SlideGrid.tsx';
import { OverlayChip } from './OverlayChip.tsx';
import { ItemContextMenu, type ItemMenuSource, type OpenItemMenu } from './ItemContextMenu.tsx';
import { useFollowShown } from './followShown.ts';

/** A small round button in a section's heading. */
const HEADING_BUTTON = 'ml-1 h-7 px-2.5 rounded-full flex items-center gap-1 normal-case tracking-normal font-medium cursor-pointer';

/**
 * A presentation's slides, one list on a computer and a phone, the same before and while it is presented
 * (docs/layout-2-0.md; Lars, 2026-11-02): the whole running order, each item a section whose heading sticks at the
 * top until the next pushes it away, with its warnings and its player under it; from `lg` the item's arrangement and
 * overlay too, and its slides a grid of pictures; on a phone every part a row with its whole text. While presenting
 * (`onShow`) a click or a tap shows a slide; the list follows the shown one only when it changed some other way, and
 * only when out of view. An item's … beside its name opens on a computer the same menu as its row at the left
 * (`menuSource`, ItemContextMenu), and on a phone `onItemMenu`'s sheet.
 */
export function SlideList({
  items,
  slides,
  theme,
  songs,
  overlays,
  pointer,
  players,
  toItem,
  markedId = null,
  onShow,
  onItemMenu,
  menuSource,
  editingImages: editingShown,
  onEditingImages,
  onAddImages,
  footer,
  header,
  template = false,
}: {
  items: PresentationItem[];
  slides: Map<string, ItemSlides>;
  theme: Theme;
  songs: Map<string, Song>;
  overlays: Overlay[];
  pointer: LivePointer;
  /** While presenting: the session's players (on a phone the audio only: the video plays in the picture). */
  players?: Players;
  /** The item to scroll to: chosen at the left, or just added; a new object each time, the same item again too. */
  toItem: { id: string } | null;
  /** An item just added, its heading marked for a moment. */
  markedId?: string | null;
  /** While presenting: a slide clicked or tapped is shown. */
  onShow?: (itemId: string, partIndex: number) => void;
  /** On a phone: an item's … opens its sheet. */
  onItemMenu?: (item: PresentationItem) => void;
  /** On a computer: what an item's menu needs, the same as its row's at the left. */
  menuSource?: ItemMenuSource;
  /** On a computer: the picture item edited in place, which its row's menu at the left can start too. */
  editingImages?: string | null;
  onEditingImages?: (itemId: string | null) => void;
  /** "Lägg till bilder" on an image item edited in place: the add dialog's picture tab, adding to it. */
  onAddImages?: (itemId: string) => void;
  /** Under the last item: on a phone, whether it is kept offline and Fjärrstyrning, as a computer's columns have them. */
  footer?: ReactNode;
  /** Above the items, scrolling with them: a phone's description while nothing is presented. */
  header?: ReactNode;
  /** A template's editor: the empty list says the template is empty. */
  template?: boolean;
}) {
  const wide = useWide();
  const box = useRef<HTMLDivElement>(null);
  // Redigera on an image item, on a computer: its pictures to reorder, remove and add to, one item at a time.
  const [ownEditing, setOwnEditing] = useState<string | null>(null);
  const editingImages = editingShown === undefined ? ownEditing : editingShown;
  const setEditingImages = onEditingImages ?? setOwnEditing;
  const [menu, setMenu] = useState<OpenItemMenu | null>(null);
  const markTapped = useFollowShown(box, `${pointer.itemId}/${pointer.partIndex}`, wide ? 16 : 56, toItem);
  const markOf = slideMarks(items.map((i) => ({ itemId: i.id, parts: slides.get(i.id)?.slides.length ?? 0 })), pointer);
  const show =
    onShow &&
    ((itemId: string, partIndex: number) => {
      markTapped();
      onShow(itemId, partIndex);
    });
  // Before presenting, a slide clicked is only outlined in blue, as in the current app; Starta presentation starts
  // black all the same (spec 04), and lets go of it.
  const [picked, setPicked] = useState<{ itemId: string; partIndex: number } | null>(null);
  const [wasShowing, setWasShowing] = useState(!!onShow);
  if (wasShowing !== !!onShow) {
    setWasShowing(!!onShow);
    setPicked(null);
  }

  // `elevated` on a computer: a step lighter in dark mode, so black slides stand out from the ground (app.css).
  return (
    <div
      ref={box}
      // A column, so the footer (a phone's offline and Fjärrstyrning lines) stands at the foot of the page when the
      // items are few, and after them when they are many; never floating over them (Lars, 2026-11-02).
      className={`${wide ? 'elevated' : ''} relative flex-1 min-w-0 min-h-0 overflow-y-auto flex flex-col px-4 lg:px-6 pb-24 lg:pb-12 max-lg:landscape:pt-3 bg-ground`}
      data-testid={wide ? 'live-slides' : 'live-order'}
    >
      {header}
      {!items.length && (
        <div className="h-full flex flex-col items-center justify-center text-center px-6 py-12 select-none">
          <EmptySlidesPicture className="w-48 h-auto mb-6 text-stone-300 dark:text-stone-600" />
          <h2 className="text-lg/7 font-semibold text-stone-500 dark:text-stone-400 mb-2">{t(template ? 'templates.emptyTemplate' : 'presentation.empty')}</h2>
          <p className="text-sm text-stone-400 dark:text-stone-500 max-w-xs leading-relaxed">{withBold(t('presentation.emptyText'), '{add}', t('presentation.add'))}</p>
        </div>
      )}
      {items.map((item) => {
        const set = slides.get(item.id);
        const song = item.type === 'song' ? songs.get(item.sourceId) : undefined;
        const editing = !onItemMenu && item.type === 'image' && editingImages === item.id;
        return (
          <section key={item.id} data-item={item.id} aria-label={item.title} className="flex flex-col gap-1.5 lg:gap-2 max-lg:mb-2 lg:pb-3">
            {/* As iOS's grouped lists on a phone: the heading close above its rows, the space between sections above it. It
                sticks a pixel above the top, a pixel taller, so no sliver of a row's red frame shows above it where the
                scroll lands between pixels (Lars, 2026-11-02). Its name starts where the rows' text does, as the start
                page's captions (Lars, 2026-11-03). */}
            <h3
              className={`sticky -top-px z-[2] -mx-4 lg:-mx-6 pl-8 pr-5 lg:pl-10 lg:pr-6 pt-[calc(1.25rem+1px)] lg:pt-[calc(0.875rem+1px)] pb-0.5 lg:pb-2 lg:min-h-[44px] flex items-center gap-2 lg:gap-2.5 text-sm/5 font-semibold bg-ground transition-colors ${item.id === markedId ? 'text-sky-500' : 'text-stone-500 dark:text-stone-400'}`}
            >
              {/* The item's name, not renamed here: that confused (Lars, 2026-11-02). */}
              {/* The dot of the item shown stands in the room left of its name, so the name never moves (Lars, 2026-11-03). */}
              <span className="relative min-w-0 flex">
                {item.id === pointer.itemId && !pointer.black && <span className="absolute -left-3 top-1/2 -translate-y-1/2 size-2 rounded-full bg-red-500" aria-label={t('live.badge')} />}
                <span className="min-w-0 truncate">{item.title}</span>
              </span>
              <OverlayChip item={item} overlays={overlays} />
              {onItemMenu ? (
                <AppButton
                  variant="plain"
                  aria-label={t('live.itemMore', { title: item.title })}
                  onClick={() => onItemMenu(item)}
                  // 44 pt to a finger, drawn into the heading's space above and down to the card, so the row stays its height.
                  className="ml-auto -mr-3 -mt-5 -mb-2 size-11 shrink-0 rounded-full flex items-center justify-center cursor-pointer text-stone-600 dark:text-stone-300"
                >
                  <EllipsisIcon className="size-5" />
                </AppButton>
              ) : editing ? (
                // While its pictures are edited, Klar ends it at once.
                <AppButton variant="plain" onClick={() => setEditingImages(null)} className={`${HEADING_BUTTON} ml-auto bg-sky-500 text-white hover:bg-sky-600`}>
                  {t('presentation.doneEditingImages')}
                </AppButton>
              ) : (
                menuSource && (
                  <AppButton
                    variant="plain"
                    aria-label={t('presentation.itemOptions', { title: item.title })}
                    title={t('presentation.itemOptions', { title: item.title })}
                    // The menu opens under the button, as a row's … at the left opens it.
                    onClick={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      setMenu({ item, at: { x: rect.left, y: rect.bottom + 4 } });
                    }}
                    className="size-7 rounded-full flex items-center justify-center cursor-pointer text-stone-500 hover:bg-stone-200/60 dark:hover:bg-white/[0.06] normal-case tracking-normal font-normal"
                  >
                    <EllipsisIcon className="size-4" />
                  </AppButton>
                )
              )}
            </h3>
            <ItemWarnings item={item} set={set} songName={song?.name} />
            <ItemMedia item={item} set={set} players={players} shownId={pointer.itemId} />
            {set && editing ? (
              <ImageItemEditor item={item} slides={set.slides} theme={theme} onAddImages={() => onAddImages?.(item.id)} />
            ) : !set?.slides.length ? null : wide ? (
              <SlideGrid
                slides={set.slides}
                label={item.title}
                theme={theme}
                overlayId={item.overlayId}
                shown={show && { pointer, itemId: item.id, mark: (partIndex) => markOf(item.id, partIndex), onShow: (partIndex) => show(item.id, partIndex) }}
                picked={{ partIndex: picked?.itemId === item.id ? picked.partIndex : null, onPick: (partIndex) => setPicked({ itemId: item.id, partIndex }) }}
              />
            ) : (
              set.slides.map((slide, partIndex) => (
                <PartRow
                  key={slide.key}
                  slide={slide}
                  partIndex={partIndex}
                  theme={theme}
                  current={!pointer.black && item.id === pointer.itemId && partIndex === pointer.partIndex}
                  rested={pointer.black && item.id === pointer.itemId && partIndex === pointer.partIndex}
                  mark={markOf(item.id, partIndex)}
                  picked={!show && picked?.itemId === item.id && picked.partIndex === partIndex}
                  onShow={show ? () => show(item.id, partIndex) : () => setPicked({ itemId: item.id, partIndex })}
                />
              ))
            )}
          </section>
        );
      })}
      {footer && <div className="mt-auto flex flex-col items-center gap-1 pt-4 empty:hidden">{footer}</div>}
      {menu && menuSource && <ItemContextMenu menu={menu} source={menuSource} onClose={() => setMenu(null)} />}
    </div>
  );
}

/** A part on a phone: its name and its whole text (a picture or a video drawn small), VISAS or NÄSTA at its right. */
function PartRow({
  slide,
  partIndex,
  theme,
  current,
  rested,
  mark,
  picked,
  onShow,
}: {
  slide: Slide;
  partIndex: number;
  theme: Theme;
  current: boolean;
  /** After Rensa, the part last shown keeps a quiet grey border: where → goes on from. */
  rested: boolean;
  mark: SlideMarkKind | null;
  /** Before presenting, the part tapped: outlined in blue, as a computer's tile. */
  picked: boolean;
  onShow: () => void;
}) {
  return (
    <AppButton
      variant="plain"
      data-current={current}
      data-rested={rested || undefined}
      aria-current={current || undefined}
      aria-pressed={picked || undefined}
      onClick={onShow}
      // The border is always there, clear until the part is shown, so the shown card is no bigger than the rest.
      className={`w-full flex gap-3 px-3.5 py-2.5 rounded-2xl border-2 text-left cursor-pointer ${slide.kind === 'media' ? 'items-center' : 'items-start'} ${current ? 'bg-surface dark:bg-raised border-red-500' : rested ? 'bg-surface border-stone-300 dark:border-stone-600' : picked ? 'bg-surface border-sky-500' : 'bg-surface border-transparent'}`}
    >
      {slide.kind === 'media' && (
        <span className="w-24 aspect-video shrink-0 rounded-lg overflow-hidden">
          <SlideView slide={slide} theme={theme} label={false} credits={false} />
        </span>
      )}
      <span className="flex-1 min-w-0 flex flex-col gap-0.5">
        {/* One height with or without VISAS and NÄSTA, so a row keeps its size as they move (Lars, 2026-11-02). */}
        <span className="h-5 flex items-center justify-between gap-2">
          <span className="text-[13px]/5 font-semibold text-stone-500 dark:text-stone-400 truncate">{slide.label?.text ?? String(partIndex + 1)}</span>
          {mark && <SlideMark kind={mark} />}
        </span>
        {slide.kind !== 'media' && <span className="text-[17px]/snug whitespace-pre-line text-stone-900 dark:text-stone-100">{slide.text}</span>}
      </span>
    </AppButton>
  );
}

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
