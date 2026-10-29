import type { Overlay, PresentationItem } from '@gp/core';
import { useEffect, useRef, useState } from 'react';
import { useDb } from '../../db/react.tsx';
import { t } from '../../i18n.ts';
import type { ItemSlides } from '../../live/live.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { useSaveFailed } from '../../ui/AutoSave.tsx';
import { afterWrite } from '../../ui/debounce.ts';
import { Dropdown, MENU_ITEM } from '../../ui/Dropdown.tsx';
import { CheckboxIcon, EllipsisOutlineIcon, ItemIcon, MenuIcon, PlusIcon, TrashIcon, WarningIcon } from '../../ui/icons.tsx';
import { useSortable } from '../../ui/sortable.ts';

/**
 * The running order: one row per item, dragged by its handle, with the add button under the list.
 * The item shown live has a red pulsing dot. With `ticking` (Markera), rows are ticked instead
 * (Shift+click ticks a range) and the button under the list removes them (Sidebar.razor).
 */
export function RunningOrder({
  items,
  slides,
  overlays,
  selectedId,
  liveItemId,
  ticking,
  onSelect,
  onRemove,
  onRemoveTicked,
  onDoneTicking,
  onAdd,
}: {
  items: PresentationItem[];
  slides: Map<string, ItemSlides>;
  overlays: Overlay[];
  selectedId: string | null;
  liveItemId: string | null;
  ticking: boolean;
  onSelect: (itemId: string) => void;
  onRemove: (item: PresentationItem) => void;
  onRemoveTicked: (items: PresentationItem[]) => void;
  onDoneTicking: () => void;
  onAdd: () => void;
}) {
  const db = useDb();
  const saveFailed = useSaveFailed();
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const lastTicked = useRef<string | null>(null);
  // A new select mode starts with nothing ticked.
  const [wasTicking, setWasTicking] = useState(ticking);
  if (wasTicking !== ticking) {
    setWasTicking(ticking);
    setTicked(new Set());
  }
  const tick = (itemId: string, range: boolean) => {
    const next = new Set(ticked);
    const from = lastTicked.current ? items.findIndex((i) => i.id === lastTicked.current) : -1;
    const to = items.findIndex((i) => i.id === itemId);
    if (range && from >= 0 && to >= 0) for (let i = Math.min(from, to); i <= Math.max(from, to); i++) next.add(items[i]!.id);
    else if (!next.delete(itemId)) next.add(itemId);
    if (!range || from < 0) lastTicked.current = itemId;
    lastTicked.current = itemId;
    setTicked(next);
  };
  const allTicked = items.length > 0 && ticked.size === items.length;
  // The selected row comes into view when the selection moves, by the arrows or by an add (Sidebar.razor).
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!selectedId) return;
    scroller.current?.querySelector(`[data-item-id="${CSS.escape(selectedId)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);
  // Dragged by the handle (Sidebar.razor), saved by the same mutator as Alt+↑/↓.
  const { listRef, rowStyle, handle, dragging } = useSortable<HTMLOListElement>((from, to) =>
    afterWrite(db.mutate('moveItem', { itemId: items[from]!.id, by: to - from }), () => {}, saveFailed),
  );

  return (
    <div ref={scroller} className="flex-1 min-h-0 overflow-y-auto">
      {ticking && (
        <div className="flex items-center justify-between px-4 pb-2">
          <AppButton
            variant="plain"
            className="flex items-center gap-2 px-1 text-sm cursor-pointer select-none text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
            aria-pressed={allTicked}
            onClick={() => setTicked(allTicked ? new Set() : new Set(items.map((i) => i.id)))}
          >
            <CheckboxIcon checked={allTicked} filled className={allTicked ? 'size-5 text-sky-500' : 'size-5 text-neutral-300 dark:text-neutral-500'} />
            {t('presentation.tickAll')}
          </AppButton>
          <AppButton variant="plain" className="px-2 py-1.5 rounded-full text-xs cursor-pointer bg-sky-500 text-white hover:bg-sky-600" onClick={onDoneTicking}>
            {t('presentation.tickDone')}
          </AppButton>
        </div>
      )}
      <ol ref={listRef} className="pb-8" aria-label={t('presentation.items')}>
        {items.map((item, i) => {
          const problem = slides.get(item.id)?.problem;
          const carried = item.overlayId ? overlays.find((o) => o.id === item.overlayId) : undefined;
          const isSelected = item.id === selectedId;
          return (
            <li
              key={item.id}
              data-sort-row
              data-item-id={item.id}
              style={rowStyle(i)}
              className={`flex items-center mx-2 rounded-lg text-sm group scroll-mb-16 ${isSelected ? 'bg-sky-500 text-white' : 'text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700'} ${
                dragging === i ? `shadow-lg ${isSelected ? '' : 'bg-white dark:bg-neutral-700'}` : ''
              }`}
            >
              {/* The live dot's place is always there, so the rows line up whether one is live or not. */}
              <span
                className={`ml-2 -mr-2 size-2 shrink-0 rounded-full ${item.id === liveItemId ? 'bg-red-500 animate-pulse' : ''}`}
                data-testid={item.id === liveItemId ? 'live-dot' : undefined}
              />
              {ticking ? (
                <AppButton
                  variant="plain"
                  className="flex items-center gap-3 px-3 py-3 grow cursor-pointer min-w-0"
                  aria-pressed={ticked.has(item.id)}
                  onClick={(e) => tick(item.id, e.shiftKey)}
                >
                  <CheckboxIcon
                    checked={ticked.has(item.id)}
                    filled
                    className={ticked.has(item.id) ? 'size-5 shrink-0 text-sky-500' : 'size-5 shrink-0 text-neutral-300 dark:text-neutral-500'}
                  />
                  <span className="size-3 shrink-0">
                    <ItemIcon type={item.type} className="size-4" />
                  </span>
                  <span className="text-left truncate">{item.title}</span>
                </AppButton>
              ) : (
                <AppButton
                  variant="plain"
                  className="flex items-center space-x-3 px-3 py-3 grow cursor-pointer min-w-0 text-left rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500"
                  aria-pressed={isSelected}
                  onClick={() => onSelect(item.id)}
                >
                  <span className="size-3 shrink-0">
                    <ItemIcon type={item.type} className="size-4" />
                  </span>
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
              )}
              {isSelected && !ticking && (
                <Dropdown
                  className="shrink-0"
                  menuClassName="w-48"
                  button={{
                    className: 'p-2 rounded-full hover:bg-sky-400 cursor-pointer text-white/70 hover:text-white',
                    title: t('presentation.options'),
                    'aria-label': t('presentation.itemOptions', {
                      title: item.title,
                    }),
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
              {!ticking && (
                <div
                  {...handle(i)}
                  data-testid="drag-handle"
                  className={`px-3 py-2 shrink-0 cursor-grab active:cursor-grabbing touch-none select-none ${isSelected ? 'text-white/30' : 'text-neutral-300 dark:text-neutral-500'}`}
                >
                  <MenuIcon className="size-4" />
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <div className="sticky bottom-0 p-3 bg-white dark:bg-neutral-800">
        {ticking && ticked.size > 0 ? (
          <AppButton
            variant="plain"
            className="text-sm text-center w-full bg-red-500 text-white px-4 py-2.5 rounded-full hover:bg-red-600 cursor-pointer flex items-center justify-center gap-2"
            onClick={() => onRemoveTicked(items.filter((i) => ticked.has(i.id)))}
          >
            <TrashIcon className="size-4" strokeWidth={1.5} />
            {t('presentation.removeTicked', { n: ticked.size })}
          </AppButton>
        ) : ticking ? (
          <div className="text-sm text-center text-neutral-400 dark:text-neutral-500 py-2.5">{t('presentation.tickHint')}</div>
        ) : (
          <AppButton variant="secondary" onClick={onAdd} className="w-full flex items-center justify-center gap-2">
            <PlusIcon className="size-4" />
            {t('presentation.add')}
          </AppButton>
        )}
      </div>
    </div>
  );
}
