import type { Overlay, PresentationItem, Song, SongArrangement, Theme } from '@gp/core';
import { t } from '../../i18n.ts';
import type { ItemSlides } from '../../live/live.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { EmptySlidesPicture, MenuIcon, PencilIcon, PlayIcon } from '../../ui/icons.tsx';
import { href } from '../../ui/router.ts';
import { ItemTitle } from './ItemTitle.tsx';
import { SelectedItem } from './SelectedItem.tsx';

/**
 * The main area: the selected item's title and Starta presentation above it, or the
 * empty states; below `lg` the round button that opens the running order.
 */
export function ItemPane({
  id,
  items,
  selected,
  renaming,
  setRenaming,
  selectedSong,
  selectedArrangements,
  selectedSlides,
  overlays,
  theme,
  onShowMenu,
}: {
  id: string;
  items: PresentationItem[];
  selected: PresentationItem | null;
  renaming: boolean;
  setRenaming: (on: boolean) => void;
  selectedSong: Song | undefined;
  selectedArrangements: SongArrangement[];
  selectedSlides: ItemSlides | undefined;
  overlays: Overlay[];
  theme: Theme;
  onShowMenu: () => void;
}) {
  return (
    <div className="flex-1 min-w-0 flex flex-col relative bg-neutral-100 dark:bg-neutral-900">
      <div className="flex-1 min-h-0 flex flex-col overflow-y-auto">
        <div className="flex items-center justify-between gap-3 px-5 py-3 lg:pr-3">
          {selected ? (
            <div className="flex items-center gap-3 min-w-0">
              <ItemTitle key={selected.id} item={selected} editing={renaming} setEditing={setRenaming} />
              {selectedSong?.deletedAt === null && !renaming && (
                <a
                  href={href({ page: 'song', id: selectedSong.id })}
                  className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-full text-xs cursor-pointer no-underline text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300"
                  title={t('presentation.editSong')}
                >
                  <PencilIcon className="size-4" />
                  {t('presentation.editSong')}
                </a>
              )}
            </div>
          ) : (
            <span />
          )}
          <AppButton
            variant="plain"
            href={href({ page: 'live', id })}
            className="absolute bottom-3 right-3 z-30 lg:static shrink-0 px-4 py-2.5 rounded-full flex items-center gap-2 shadow-lg cursor-pointer bg-emerald-500 text-white hover:bg-emerald-600"
          >
            <PlayIcon className="size-5" />
            <span className="text-sm font-medium">{t('presentation.start')}</span>
          </AppButton>
        </div>
        <div className="flex-1 flex flex-col gap-3 px-3 pb-24 lg:pb-3">
          {!items.length && (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-12 select-none">
              <EmptySlidesPicture className="w-48 h-auto mb-6 text-neutral-300 dark:text-neutral-600" />
              <h2 className="text-lg/7 font-semibold text-neutral-500 dark:text-neutral-400 mb-2">{t('presentation.empty')}</h2>
              <p className="text-sm text-neutral-400 dark:text-neutral-500 max-w-xs leading-relaxed">{t('presentation.emptyText')}</p>
            </div>
          )}
          {!selected && !!items.length && (
            <div className="flex-1 flex items-center justify-center py-12 select-none">
              <p className="text-sm text-neutral-400 dark:text-neutral-500 italic">{t('presentation.selectItem')}</p>
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
    </div>
  );
}
