import type { Overlay, PresentationItem } from '@gp/core';
import { useDb } from '../../db/react.tsx';
import { t } from '../../i18n.ts';
import type { ItemSlides } from '../../live/live.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { useSaveFailed } from '../../ui/AutoSave.tsx';
import { afterWrite } from '../../ui/debounce.ts';
import { Dropdown, MENU_ITEM } from '../../ui/Dropdown.tsx';
import { EllipsisOutlineIcon, ItemIcon, MenuIcon, PlusIcon, TrashIcon, WarningIcon } from '../../ui/icons.tsx';
import { useSortable } from '../../ui/sortable.ts';

/** The running order: one row per item, dragged by its handle, with the add button under the list. */
export function RunningOrder({
  items,
  slides,
  overlays,
  selectedId,
  onSelect,
  onRemove,
  onAdd,
}: {
  items: PresentationItem[];
  slides: Map<string, ItemSlides>;
  overlays: Overlay[];
  selectedId: string | null;
  onSelect: (itemId: string) => void;
  onRemove: (item: PresentationItem) => void;
  onAdd: () => void;
}) {
  const db = useDb();
  const saveFailed = useSaveFailed();
  // Dragged by the handle (Sidebar.razor), saved by the same mutator as Alt+↑/↓.
  const { listRef, rowStyle, handle, dragging } = useSortable<HTMLOListElement>((from, to) =>
    afterWrite(db.mutate('moveItem', { itemId: items[from]!.id, by: to - from }), () => {}, saveFailed),
  );

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <ol ref={listRef} className="pb-8" aria-label={t('presentation.items')}>
        {items.map((item, i) => {
          const problem = slides.get(item.id)?.problem;
          const carried = item.overlayId ? overlays.find((o) => o.id === item.overlayId) : undefined;
          const isSelected = item.id === selectedId;
          return (
            <li
              key={item.id}
              data-sort-row
              style={rowStyle(i)}
              className={`flex items-center mx-2 rounded-lg text-sm group ${isSelected ? 'bg-sky-500 text-white' : 'text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700'} ${
                dragging === i ? `shadow-lg ${isSelected ? '' : 'bg-white dark:bg-neutral-700'}` : ''
              }`}
            >
              <AppButton
                variant="plain"
                className="flex items-center gap-3 px-3 py-3 grow cursor-pointer min-w-0 text-left rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500"
                aria-pressed={isSelected}
                onClick={() => onSelect(item.id)}
              >
                <ItemIcon type={item.type} className="size-4 shrink-0" />
                <span className="truncate">{item.title}</span>
                {carried && (
                  <span
                    className={`shrink-0 max-w-24 truncate rounded-full px-2 py-0.5 text-[11px] ${isSelected ? 'bg-white/20 text-white' : 'bg-sky-50 dark:bg-sky-900/30 text-sky-600 dark:text-sky-400'}`}
                    title={t('overlays.carried')}
                  >
                    {carried.title}
                  </span>
                )}
                {(problem === 'song-trashed' || problem === 'song-missing' || problem === 'image-missing' || problem === 'audio-missing') && (
                  <span className={isSelected ? 'text-white' : 'text-amber-500'}>
                    <WarningIcon className="size-4" />
                    <span className="sr-only">⚠</span>
                  </span>
                )}
              </AppButton>
              {isSelected && (
                <Dropdown
                  className="shrink-0"
                  menuClassName="w-48"
                  button={{
                    className: 'p-2 rounded-full hover:bg-sky-400 cursor-pointer text-white/70 hover:text-white',
                    title: t('presentation.options'),
                    'aria-label': t('presentation.itemOptions', { title: item.title }),
                  }}
                  trigger={<EllipsisOutlineIcon className="size-4" />}
                >
                  <AppButton variant="plain" role="menuitem" className={`${MENU_ITEM} text-red-500! dark:text-red-400!`} onClick={() => onRemove(item)}>
                    <TrashIcon className="size-4" strokeWidth={1.5} />
                    {t('presentation.remove')}
                  </AppButton>
                </Dropdown>
              )}
              {/* The drag handle; Alt+↑/↓ moves the selected item from the keyboard. */}
              <div
                {...handle(i)}
                data-testid="drag-handle"
                className={`px-3 py-2 shrink-0 cursor-grab active:cursor-grabbing touch-none select-none ${isSelected ? 'text-white/30' : 'text-neutral-300 dark:text-neutral-500'}`}
              >
                <MenuIcon className="size-4" />
              </div>
            </li>
          );
        })}
      </ol>
      <div className="sticky bottom-0 p-3 bg-white dark:bg-neutral-800">
        <AppButton variant="secondary" onClick={onAdd} className="w-full flex items-center justify-center gap-2">
          <PlusIcon className="size-4" />
          {t('presentation.add')}
        </AppButton>
      </div>
    </div>
  );
}
