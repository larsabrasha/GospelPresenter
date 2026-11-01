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
import { ChevronDownIcon, ChevronUpIcon, EllipsisOutlineIcon, ItemIcon, MenuIcon, PlusIcon, TrashIcon, WarningIcon } from '../../../ui/icons.tsx';
import { useSortable } from '../../../ui/sortable.ts';

/** An item's menu, open at a point: from a right click on its row, or under its …. */
type Menu = { item: PresentationItem; at: { x: number; y: number } };

/**
 * The left column while presenting on a computer or an iPad lying down (docs/layout-2-0.md): the items, one row each,
 * the shown one marked by a red dot left of its name and a red tint across the row. A mouse drags a row straight
 * away (after 4 px, so a click still selects); a finger drags by ≡, so it still scrolls. A right click or the row's …
 * gives Lägg till efter, Flytta upp, Flytta ned and Ta bort; the shown item cannot be removed. A click selects the
 * item, which scrolls the slides to it.
 */
export function LiveOrder({
  items,
  slides,
  selectedId,
  shownId,
  onSelect,
  onAddAfter,
  onRemove,
}: {
  items: PresentationItem[];
  slides: Map<string, ItemSlides>;
  selectedId: string | null;
  shownId: string | null;
  onSelect: (itemId: string) => void;
  /** Lägg till: after the item named, or by the live list's rule (liveList.ts `addAfter`) with none. */
  onAddAfter: (itemId: string | null) => void;
  onRemove: (item: PresentationItem) => void;
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
  const order = items.map((i) => i.id);
  const can = menu ? itemActions(order, menu.item.id, shownId) : null;

  return (
    <div ref={scroller} className="flex-1 min-h-0 overflow-y-auto">
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
              {...wholeRow(i)}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ item, at: { x: e.clientX, y: e.clientY } });
              }}
              className={`group flex items-center rounded-full text-sm scroll-mb-16 ${
                shown ? 'bg-red-500/12 dark:bg-red-500/18' : selected ? 'bg-raised dark:bg-raised-2' : 'hover:bg-raised'
              } ${dragging === i ? 'shadow-lg bg-surface dark:bg-raised' : ''} ${menu?.item.id === item.id ? 'ring-2 ring-inset ring-sky-500' : ''}`}
            >
              {/* The dot's place is always there, so the rows line up whether one is shown or not. */}
              <span className={`ml-3 size-2 shrink-0 rounded-full ${shown ? 'bg-red-500' : ''}`} data-testid={shown ? 'live-dot' : undefined} />
              <AppButton
                variant="plain"
                className="flex items-center gap-2.5 px-2.5 py-2.5 touch:min-h-11 grow min-w-0 cursor-pointer text-left text-neutral-700 dark:text-neutral-200 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500"
                aria-pressed={selected}
                aria-current={shown ? 'true' : undefined}
                onClick={() => onSelect(item.id)}
              >
                <ItemIcon type={item.type} className="size-4 shrink-0 text-neutral-400" />
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
                className="shrink-0 size-7 touch:size-11 flex items-center justify-center rounded-full cursor-pointer text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-raised-2 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 touch:opacity-100 aria-expanded:opacity-100"
                aria-expanded={menu?.item.id === item.id}
                onClick={(e) => {
                  const box = e.currentTarget.getBoundingClientRect();
                  setMenu({ item, at: { x: box.left, y: box.bottom + 4 } });
                }}
              >
                <EllipsisOutlineIcon className="size-4" />
              </AppButton>
              {/* A finger drags by ≡ (a mouse drags the whole row); Alt+↑/↓ moves the selected item from the keyboard. */}
              <div {...handle(i)} data-no-drag data-testid="drag-handle" className="hidden touch:flex items-center justify-center size-11 shrink-0 touch-none text-neutral-400 dark:text-neutral-500">
                <MenuIcon className="size-4" />
              </div>
            </li>
          );
        })}
      </ol>
      <div className="sticky bottom-0 p-3 bg-surface">
        <AppButton variant="secondary" onClick={() => onAddAfter(null)} className="w-full flex items-center justify-center gap-2 touch:min-h-11">
          <PlusIcon className="size-4" />
          {t('presentation.add')}
        </AppButton>
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
