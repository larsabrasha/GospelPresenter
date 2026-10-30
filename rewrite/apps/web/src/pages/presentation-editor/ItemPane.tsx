import type { Overlay, PresentationItem, Song, SongArrangement, Theme } from '@gp/core';
import { useState, type ReactNode } from 'react';
import { t } from '../../i18n.ts';
import type { ItemSlides } from '../../live/live.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { EmptySlidesPicture, MenuIcon, PencilIcon, PlayIcon } from '../../ui/icons.tsx';
import { href } from '../../ui/router.ts';
import { ItemTitle } from './ItemTitle.tsx';
import { IDLE_HINTS } from './idleHints.ts';
import { SelectedItem, type Shown } from './SelectedItem.tsx';

/** Starta presentation: in the title row from `lg`, at the bottom right below it. */
function StartButton({ onStart, className }: { onStart: () => void; className: string }) {
  return (
    <AppButton
      variant="plain"
      onClick={onStart}
      title={t('presentation.start')}
      className={`pointer-events-auto shrink-0 px-4 py-2.5 rounded-full items-center gap-2 shadow-lg cursor-pointer bg-emerald-500 text-white hover:bg-emerald-600 ${className}`}
    >
      <PlayIcon className="size-5" />
      <span className="text-sm font-medium">{t('presentation.start')}</span>
    </AppButton>
  );
}

const randomHint = () => IDLE_HINTS[Math.floor(Math.random() * IDLE_HINTS.length)]!;

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
 * The main area: the selected item's title and Starta presentation above it, or the
 * empty states; below `lg` the round button that opens the running order.
 */
export function ItemPane({
  items,
  selected,
  renaming,
  setRenaming,
  selectedSong,
  selectedArrangements,
  selectedSlides,
  overlays,
  theme,
  canStart,
  onStart,
  onShowMenu,
  onAddImages,
  shown,
}: {
  /** While presenting: a slide clicked is shown live. */
  shown?: Shown;
  /** "Lägg till bilder" on an image item: the add dialog's picture tab, adding to it. */
  onAddImages: () => void;
  items: PresentationItem[];
  selected: PresentationItem | null;
  renaming: boolean;
  setRenaming: (on: boolean) => void;
  selectedSong: Song | undefined;
  selectedArrangements: SongArrangement[];
  selectedSlides: ItemSlides | undefined;
  overlays: Overlay[];
  theme: Theme;
  /** Starta presentation: not in a template's editor. */
  canStart: boolean;
  onStart: () => void;
  onShowMenu: () => void;
}) {
  // Redigera on an image item: its pictures to reorder, remove and add to; another item ends it.
  const [editingImages, setEditingImages] = useState<string | null>(null);
  const editing = !!selected && editingImages === selected.id;
  // When nothing is selected: a quote or a Bible verse, a new one each time (SlideGrid.razor).
  const [hint, setHint] = useState(() => ({ after: selected?.id ?? null, ...randomHint() }));
  if (hint.after !== (selected?.id ?? null)) setHint({ after: selected?.id ?? null, ...randomHint() });
  return (
    <div className="flex-1 min-w-0 flex flex-col relative bg-neutral-100 dark:bg-neutral-900">
      {/* Keyed by the item: a new one starts at the top of its slides (Sidebar.razor scrolls `main` to the top). */}
      <div key={selected?.id ?? ''} className="flex-1 min-h-0 flex flex-col overflow-y-auto">
        {/* Below `lg` the title floats over the slides, which fade out under it (PresentationHeader.razor). */}
        <div className="flex items-center justify-between gap-3 px-5 py-1 lg:py-3 lg:pr-3 absolute top-0 left-0 right-0 h-20 lg:h-auto z-10 lg:z-[5] pointer-events-none lg:pointer-events-auto bg-linear-to-b from-neutral-100 via-neutral-100/80 dark:from-neutral-900 dark:via-neutral-900/80 to-transparent lg:bg-none lg:static">
          {selected ? (
            <div className="flex items-center gap-3 min-w-0">
              <ItemTitle key={selected.id} item={selected} editing={renaming} setEditing={setRenaming} />
              {selectedSong?.deletedAt === null && (
                <a
                  href={href({ page: 'song', id: selectedSong.id })}
                  className="pointer-events-auto shrink-0 flex items-center gap-1 px-2 py-1 rounded-full text-xs cursor-pointer no-underline text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300"
                  title={t('presentation.editSong')}
                >
                  <PencilIcon className="size-4" />
                  {t('presentation.editSong')}
                </a>
              )}
              {selected.type === 'image' && (
                <AppButton
                  variant="plain"
                  className={`pointer-events-auto shrink-0 flex items-center gap-1 px-2 py-1 rounded-full text-xs cursor-pointer ${
                    editing ? 'bg-sky-500 text-white hover:bg-sky-600' : 'text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300'
                  }`}
                  title={t(editing ? 'presentation.doneEditingImages' : 'presentation.editImages')}
                  onClick={() => setEditingImages(editing ? null : selected.id)}
                >
                  {!editing && <PencilIcon className="size-4" />}
                  {t(editing ? 'presentation.doneEditingImages' : 'presentation.editImages')}
                </AppButton>
              )}
            </div>
          ) : (
            <span />
          )}
          {canStart && <StartButton onStart={onStart} className="hidden lg:flex" />}
        </div>
        <div className="flex-1 flex flex-col gap-3 px-3 pt-16 lg:pt-0 pb-24 lg:pb-3">
          {!items.length && (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-12 select-none">
              <EmptySlidesPicture className="w-48 h-auto mb-6 text-neutral-300 dark:text-neutral-600" />
              <h2 className="text-lg/7 font-semibold text-neutral-500 dark:text-neutral-400 mb-2">{t('presentation.empty')}</h2>
              <p className="text-sm text-neutral-400 dark:text-neutral-500 max-w-xs leading-relaxed">
                {withBold(t('presentation.emptyText'), '{add}', t('presentation.add'))}
              </p>
            </div>
          )}
          {!selected && !!items.length && (
            <div className="flex-1 flex flex-col items-center justify-center text-center select-none gap-3" data-testid="idle-hint">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="size-8 text-neutral-300 dark:text-neutral-600"
                aria-hidden="true"
                // A fixed icon of this file, not user text.
                dangerouslySetInnerHTML={{ __html: hint.icon }}
              />
              <div className="max-w-sm">
                <p className="text-sm text-neutral-300 dark:text-neutral-600 italic">{hint.text}</p>
                {hint.source && <p className="text-xs text-neutral-300 dark:text-neutral-600 mt-1">– {hint.source}</p>}
              </div>
            </div>
          )}
          {selected && (
            <SelectedItem
              selected={selected}
              selectedSong={selectedSong}
              selectedArrangements={selectedArrangements}
              selectedSlides={selectedSlides}
              overlays={overlays}
              theme={theme}
              editingImages={editing}
              onAddImages={onAddImages}
              shown={shown}
            />
          )}
        </div>
      </div>
      {/* Below `lg`: the slides fade out under the round menu button at the bottom left, and Starta presentation at the right. */}
      <div className="absolute bottom-0 left-0 right-0 h-24 bg-linear-to-t from-neutral-100 dark:from-neutral-900 to-transparent lg:hidden z-20 pointer-events-none" />
      <AppButton
        variant="plain"
        className="absolute bottom-3 left-3 z-30 lg:hidden cursor-pointer p-4 bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200 rounded-full shadow-[0_2px_12px_rgba(0,0,0,0.15)] dark:shadow-[0_2px_12px_rgba(0,0,0,0.4)]"
        title={t('nav.menu')}
        aria-label={t('nav.menu')}
        onClick={onShowMenu}
      >
        <MenuIcon className="size-8" />
      </AppButton>
      {canStart && <StartButton onStart={onStart} className="absolute bottom-3 right-3 z-30 flex lg:hidden" />}
    </div>
  );
}
