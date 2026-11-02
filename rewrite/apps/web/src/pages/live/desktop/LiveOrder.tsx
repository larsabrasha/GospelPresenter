import type { PresentationItem } from '@gp/core';
import { useEffect, useRef, useState } from 'react';
import { useDb } from '../../../db/react.tsx';
import { t } from '../../../i18n.ts';
import type { ItemSlides } from '../../../live/live.ts';
import { itemActions } from '../../../live/liveList.ts';
import { AppButton } from '../../../ui/AppButton.tsx';
import { useSaveFailed } from '../../../ui/AutoSave.tsx';
import { CONTEXT_ROW, ContextMenu } from '../../../ui/ContextMenu.tsx';
import { afterWrite } from '../../../ui/debounce.ts';
import { CheckboxIcon, ChevronDownIcon, ChevronUpIcon, EllipsisOutlineIcon, ItemIcon, MenuIcon, PlusIcon, TrashIcon, WarningIcon } from '../../../ui/icons.tsx';
import { useSortable } from '../../../ui/sortable.ts';

/** An item's menu, open at a point: from a right click on its row, or under its …. */
type Menu = { item: PresentationItem; at: { x: number; y: number } };

/**
 * The left column on a computer or an iPad lying down, before and while presenting (docs/layout-2-0.md): the items, one row each,
 * the shown one marked by a red dot left of its name and a red tint across the row. A mouse drags a row straight
 * away (after 4 px, so a click still selects); a finger drags by ≡, so it still scrolls. A right click or the row's …
 * gives Lägg till efter, Flytta upp, Flytta ned and Ta bort; the shown item cannot be removed. A click selects the
 * item, which scrolls the slides to it. With `ticking` (Markera), rows are ticked instead (Shift+click ticks a range)
 * and the button under the list removes them (Sidebar.razor).
 */
export function LiveOrder({
  items,
  slides,
  selectedId,
  shownId,
  onSelect,
  onAddAfter,
  onRemove,
  ticking,
  onDoneTicking,
  onRemoveTicked,
}: {
  items: PresentationItem[];
  slides: Map<string, ItemSlides>;
  selectedId: string | null;
  shownId: string | null;
  onSelect: (itemId: string) => void;
  /** Lägg till: after the item named, or by the live list's rule (liveList.ts `addAfter`) with none. */
  onAddAfter: (itemId: string | null) => void;
  onRemove: (item: PresentationItem) => void;
  ticking: boolean;
  onDoneTicking: () => void;
  onRemoveTicked: (items: PresentationItem[]) => void;
}) {
  const db = useDb();
  const saveFailed = useSaveFailed();
  const [menu, setMenu] = useState<Menu | null>(null);
  const move = (itemId: string, by: number) => afterWrite(db.mutate('moveItem', { itemId, by }), () => {}, saveFailed);
  const { listRef, rowStyle, handle, wholeRow, dragging } = useSortable<HTMLOListElement>((from, to) => move(items[from]!.id, to - from));
  // The selected row comes into view when the selection moves, by the arrows or by an add.
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selectedId) scroller.current?.querySelector(`[data-item-id="${CSS.escape(selectedId)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);
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
    lastTicked.current = itemId;
    setTicked(next);
  };
  const allTicked = items.length > 0 && ticked.size === items.length;
  const order = items.map((i) => i.id);
  const can = menu ? itemActions(order, menu.item.id, shownId) : null;

  // The scrollbar's room on both sides, so the column is as wide at the right as at the left.
  return (
    <div ref={scroller} className="flex-1 min-h-0 overflow-y-auto [scrollbar-gutter:stable_both-edges]">
      {ticking && (
        <div className="flex items-center justify-between px-4 pb-2">
          <AppButton
            variant="plain"
            className="flex items-center gap-2 px-1 text-sm cursor-pointer select-none text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-200"
            aria-pressed={allTicked}
            onClick={() => setTicked(allTicked ? new Set() : new Set(order))}
          >
            <CheckboxIcon checked={allTicked} filled className={allTicked ? 'size-5 text-sky-500' : 'size-5 text-stone-300 dark:text-stone-500'} />
            {t('presentation.tickAll')}
          </AppButton>
          <AppButton variant="plain" className="px-2 py-1.5 rounded-full text-xs cursor-pointer bg-sky-500 text-white hover:bg-sky-600" onClick={onDoneTicking}>
            {t('presentation.tickDone')}
          </AppButton>
        </div>
      )}
      <ol ref={listRef} className="pb-8 px-2 select-none" aria-label={t('presentation.items')}>
        {items.map((item, i) => {
          const problem = slides.get(item.id)?.problem;
          const shown = item.id === shownId;
          const selected = item.id === selectedId;
          return (
            <li
              key={item.id}
              data-sort-row
              data-item-id={item.id}
              style={rowStyle(i)}
              {...(ticking ? {} : wholeRow(i))}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ item, at: { x: e.clientX, y: e.clientY } });
              }}
              className={`group flex items-center pr-1.5 touch:pr-0 rounded-full text-sm scroll-mb-16 ${
                // Chosen as Inställningar's list marks its row (Lars, 2026-11-02): blue, its words white.
                selected ? 'bg-sky-500 text-white [&_*]:text-white!' : shown ? 'bg-red-500/12 dark:bg-red-500/18' : 'hover:bg-black/5 dark:hover:bg-white/10'
              } ${dragging === i ? `shadow-lg ${selected ? '' : 'bg-surface dark:bg-raised'}` : ''} ${menu?.item.id === item.id ? 'ring-2 ring-inset ring-sky-500' : ''}`}
            >
              {/* The dot's place is always there, so the rows line up whether one is shown or not. */}
              <span className={`ml-3 size-2 shrink-0 rounded-full ${shown ? 'bg-red-500' : ''}`} data-testid={shown ? 'live-dot' : undefined} />
              {ticking ? (
                <AppButton
                  variant="plain"
                  className="flex items-center gap-2.5 px-2.5 min-h-9 py-1.5 touch:min-h-11 grow min-w-0 cursor-pointer text-left text-stone-700 dark:text-stone-200"
                  aria-pressed={ticked.has(item.id)}
                  onClick={(e) => tick(item.id, e.shiftKey)}
                >
                  <CheckboxIcon checked={ticked.has(item.id)} filled className={ticked.has(item.id) ? 'size-5 shrink-0 text-sky-500' : 'size-5 shrink-0 text-stone-300 dark:text-stone-500'} />
                  <ItemIcon type={item.type} className="size-4 shrink-0 text-stone-400" />
                  <span className="truncate">{item.title}</span>
                </AppButton>
              ) : (
                <>
                <AppButton
                  variant="plain"
                  className="flex items-center gap-2.5 px-2.5 min-h-9 py-1.5 touch:min-h-11 grow min-w-0 cursor-pointer text-left text-stone-700 dark:text-stone-200 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500"
                  aria-pressed={selected}
                  aria-current={shown ? 'true' : undefined}
                  onClick={() => onSelect(item.id)}
                >
                  <ItemIcon type={item.type} className="size-4 shrink-0 text-stone-400" />
                  <span className={`truncate ${shown ? 'font-semibold' : ''}`}>{item.title}</span>
                  {problem && problem !== 'no-parts' && (
                    <span className="text-amber-500">
                      <WarningIcon className="size-4" />
                      <span className="sr-only">⚠</span>
                    </span>
                  )}
                </AppButton>
                <AppButton
                  variant="plain"
                  data-no-drag
                  aria-label={t('presentation.itemOptions', { title: item.title })}
                  title={t('presentation.options')}
                  className="shrink-0 size-7 touch:size-11 flex items-center justify-center rounded-full cursor-pointer text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-black/8 dark:hover:bg-white/12 aria-expanded:bg-black/8 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 touch:opacity-100 aria-expanded:opacity-100"
                  aria-expanded={menu?.item.id === item.id}
                  onClick={(e) => {
                    const box = e.currentTarget.getBoundingClientRect();
                    setMenu({ item, at: { x: box.left, y: box.bottom + 4 } });
                  }}
                >
                  <EllipsisOutlineIcon className="size-4" />
                </AppButton>
                </>
              )}
              {/* A finger drags by ≡ (a mouse drags the whole row); Alt+↑/↓ moves the selected item from the keyboard. */}
              <div {...handle(i)} data-no-drag data-testid="drag-handle" className={`${ticking ? 'hidden' : 'hidden touch:flex'} items-center justify-center size-11 shrink-0 touch-none text-stone-400 dark:text-stone-500`}>
                <MenuIcon className="size-4" />
              </div>
            </li>
          );
        })}
      </ol>
      <div className="sticky bottom-0 p-3 bg-sidebar">
        {ticking && ticked.size > 0 ? (
          <AppButton
            variant="plain"
            className="text-sm text-center w-full bg-red-500 text-white px-4 h-9 touch:h-11 rounded-full hover:bg-red-600 cursor-pointer flex items-center justify-center gap-2"
            onClick={() => onRemoveTicked(items.filter((i) => ticked.has(i.id)))}
          >
            <TrashIcon className="size-4" strokeWidth={1.5} />
            {t('presentation.removeTicked', { n: ticked.size })}
          </AppButton>
        ) : ticking ? (
          <div className="text-sm text-center text-stone-400 dark:text-stone-500 py-2.5">{t('presentation.tickHint')}</div>
        ) : (
          <AppButton variant="secondary" onClick={() => onAddAfter(null)} className="w-full flex items-center justify-center gap-2 touch:min-h-11">
            <PlusIcon className="size-4" />
            {t('presentation.add')}
          </AppButton>
        )}
      </div>
      {menu && can && (
        <ContextMenu at={menu.at} label={t('presentation.itemOptions', { title: menu.item.title })} onClose={() => setMenu(null)}>
          <AppButton variant="plain" role="menuitem" className={CONTEXT_ROW} onClick={() => onAddAfter(menu.item.id)}>
            <PlusIcon className="size-4" />
            {t('live.addAfter')}
          </AppButton>
          <AppButton variant="plain" role="menuitem" className={CONTEXT_ROW} disabled={!can.up} onClick={() => move(menu.item.id, -1)}>
            <ChevronUpIcon className="size-4" />
            {t('common.moveUp')}
          </AppButton>
          <AppButton variant="plain" role="menuitem" className={CONTEXT_ROW} disabled={!can.down} onClick={() => move(menu.item.id, 1)}>
            <ChevronDownIcon className="size-4" />
            {t('common.moveDown')}
          </AppButton>
          <div className="h-px my-1 mx-1 bg-separator" />
          <AppButton variant="plain" role="menuitem" className={`${CONTEXT_ROW} text-red-600 dark:text-red-400`} disabled={!can.remove} onClick={() => onRemove(menu.item)}>
            <TrashIcon className="size-4" strokeWidth={1.5} />
            {can.remove ? t('common.delete') : t('live.shownCannotRemove')}
          </AppButton>
        </ContextMenu>
      )}
    </div>
  );
}
