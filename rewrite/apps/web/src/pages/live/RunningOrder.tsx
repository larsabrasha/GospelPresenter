import type { PresentationItem } from '@gp/core';
import { useEffect, useRef, useState } from 'react';
import { useDb } from '../../db/react.tsx';
import { t } from '../../i18n.ts';
import type { ItemSlides } from '../../live/live.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { useSaveFailed } from '../../ui/AutoSave.tsx';
import { useConfirm } from '../../ui/Dialog.tsx';
import { useToast } from '../../ui/Toast.tsx';
import { afterWrite } from '../../ui/debounce.ts';
import { CheckboxIcon, EllipsisOutlineIcon, ItemIcon, MenuIcon, PlusIcon, TrashIcon, WarningIcon } from '../../ui/icons.tsx';
import { Dropdown } from '../../ui/Dropdown.tsx';
import { SKY_TINT } from '../../ui/glass.ts';
import { useSortable } from '../../ui/sortable.ts';
import type { AddChoice } from '../presentation-editor/AddItemDialog.tsx';
import { AddChoices } from './AddChoices.tsx';
import { ItemContextMenu, type ItemMenuSource, type OpenItemMenu } from './ItemContextMenu.tsx';


/**
 * The running order, one on a computer and a phone (Lars, 2026-11-02): on a computer or an iPad lying down the left
 * column, before and while presenting (docs/layout-2-0.md); on a phone its edit mode, select mode from the start, as
 * iOS's lists edit. The items, one row each,
 * the shown one marked by a red dot in the room left of its row (Lars, 2026-11-02) and a red tint across the row. A mouse drags a row straight
 * away (after 4 px, so a click still selects); a finger drags by ≡, so it still scrolls. A right click or the row's …
 * gives the item's menu, the same as its heading's (ItemContextMenu); the shown item cannot be removed. A click selects
 * the item, which scrolls the slides to it. With `ticking` (Markera, which ticks the row it was chosen on), rows are
 * ticked instead (Shift+click ticks a range), a finger moves them by ≡, and the button under the list removes them after a
 * question (Sidebar.razor); the shown item cannot be ticked. `tickFirst` ticks a row when select mode starts from outside.
 */
export function RunningOrder({
  items,
  slides,
  selectedId,
  shownId,
  onSelect,
  onAdd,
  menuSource,
  ticking,
  tickFirst = null,
  onTicking,
}: {
  items: PresentationItem[];
  slides: Map<string, ItemSlides>;
  selectedId: string | null;
  shownId: string | null;
  onSelect: (itemId: string) => void;
  /** Lägg till at the foot, a kind or a heading: by the live list's rule (liveList.ts `addAfter`). */
  onAdd: (choice: AddChoice) => void;
  /** What a row's menu needs (ItemContextMenu); its Markera ticks the row it was chosen on here. */
  menuSource: ItemMenuSource;
  /** Select mode: Markera in a row's … starts it, Klar ends it. */
  ticking: boolean;
  tickFirst?: string | null;
  onTicking: (on: boolean) => void;
}) {
  const db = useDb();
  const saveFailed = useSaveFailed();
  const { dialog, ask } = useConfirm();
  const toast = useToast();
  const [menu, setMenu] = useState<OpenItemMenu | null>(null);
  const move = (itemId: string, by: number) => afterWrite(db.mutate('moveItem', { itemId, by }), () => {}, saveFailed);
  const { listRef, rowStyle, handle, wholeRow, dragging } = useSortable<HTMLOListElement>((from, to) => move(items[from]!.id, to - from));
  // The selected row comes into view when the selection moves, by the arrows or by an add.
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selectedId) scroller.current?.querySelector(`[data-item-id="${CSS.escape(selectedId)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  // Where Shift+click ticks a range from.
  const [lastTicked, setLastTicked] = useState<string | null>(null);
  // A new select mode starts with the row Markera was chosen on ticked, or none.
  const [first, setFirst] = useState<string | null>(null);
  const order = items.map((i) => i.id);
  // The shown item cannot be removed, so it cannot be ticked either (docs/layout-2-0.md).
  const tickable = order.filter((id) => id !== shownId);
  const [wasTicking, setWasTicking] = useState(false);
  if (wasTicking !== ticking) {
    setWasTicking(ticking);
    const start = first ?? tickFirst;
    setTicked(new Set(ticking && start && tickable.includes(start) ? [start] : []));
    setLastTicked(ticking ? start : null);
    setFirst(null);
  }
  const tick = (itemId: string, range: boolean) => {
    const next = new Set(ticked);
    const from = lastTicked ? items.findIndex((i) => i.id === lastTicked) : -1;
    const to = items.findIndex((i) => i.id === itemId);
    if (range && from >= 0 && to >= 0) for (let i = Math.min(from, to); i <= Math.max(from, to); i++) next.add(items[i]!.id);
    else if (!next.delete(itemId)) next.add(itemId);
    if (shownId) next.delete(shownId);
    setLastTicked(itemId);
    setTicked(next);
  };
  const allTicked = tickable.length > 0 && ticked.size === tickable.length;
  const removeTicked = async () => {
    const chosen = items.filter((i) => ticked.has(i.id));
    const ok = await ask({
      title: t('common.delete'),
      text: chosen.length === 1 ? t('presentation.removeOne') : t('presentation.removeMany', { n: chosen.length }),
      confirm: t('common.delete'),
      compact: true,
      run: async () => {
        try {
          for (const item of chosen) await db.mutate('removeItem', { itemId: item.id });
        } catch (e) {
          console.error('save failed', e);
          saveFailed();
        }
      },
    });
    if (!ok) return;
    onTicking(false);
    toast(chosen.length === 1 ? t('presentation.removedOne') : t('presentation.removedMany', { n: chosen.length }));
  };

  // The scrollbar keeps its room at the right, the padding there making up the rest of 20px (app.css `--beside-scrollbar`).
  return (
    <div ref={scroller} className="flex-1 min-h-0 overflow-y-auto">
      {dialog}
      {ticking && (
        <div className="flex items-center justify-between pl-5 pr-(--beside-scrollbar) pb-2">
          <AppButton
            variant="plain"
            // Its box over the rows' boxes: the row's own padding and its button's.
            className="flex items-center gap-2.5 pl-3.5 pr-1 text-sm cursor-pointer select-none text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-200"
            aria-pressed={allTicked}
            onClick={() => setTicked(allTicked ? new Set() : new Set(tickable))}
          >
            <CheckboxIcon checked={allTicked} filled className={allTicked ? 'size-5 text-sky-500' : 'size-5 text-stone-300 dark:text-stone-500'} />
            {t('presentation.tickAll')}
          </AppButton>
          <AppButton variant="plain" className="px-2 py-1.5 rounded-full text-xs cursor-pointer bg-sky-500 text-white hover:bg-sky-600" onClick={() => onTicking(false)}>
            {t('presentation.tickDone')}
          </AppButton>
        </div>
      )}
      {/* As wide as the description's box above; the live dot sits in the room at the left, outside the row. */}
      <ol ref={listRef} className="pb-8 pl-5 pr-(--beside-scrollbar) select-none" aria-label={t('presentation.items')}>
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
              // The row is the hover's room, edge to edge with the next; its pill is drawn 2 px in from top and bottom, so
              // the rows stand apart and the pointer still never falls between them (Lars, 2026-11-02): the row's button
              // reaches over those 2 px (its `before`), and the pointer is a hand all the way.
              className="group relative py-0.5 text-sm scroll-mb-16 cursor-pointer"
            >
              {/* Centred in the 20px room left of the row. */}
              {shown && <span className="absolute -left-3.5 top-1/2 -translate-y-1/2 size-2 rounded-full bg-red-500" data-testid="live-dot" />}
              <div
                className={`flex items-center pl-1 pr-1.5 touch:pr-0 ${item.note ? 'rounded-2xl' : 'rounded-full'} ${
                  // Chosen as Inställningar's list marks its row (Lars, 2026-11-02): blue, its words white. While ticking, as
                  // iOS's lists in edit mode, only the ticks and a light tint mark rows (Lars, 2026-11-03: the blue hid the tick).
                  ticking ? (ticked.has(item.id) ? 'bg-sky-500/12 dark:bg-sky-400/18' : 'group-hover:bg-black/5 dark:group-hover:bg-white/10')
                  : selected ? 'bg-sky-500 text-white [&_*]:text-white!' : shown ? 'bg-red-500/12 dark:bg-red-500/18' : 'group-hover:bg-black/5 dark:group-hover:bg-white/10'
                } ${dragging === i ? `shadow-lg ${selected && !ticking ? '' : 'bg-surface dark:bg-raised'}` : ''} ${menu?.item.id === item.id ? 'ring-2 ring-inset ring-sky-500' : ''} has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-inset has-[:focus-visible]:ring-sky-500`}
              >
                {ticking ? (
                  <AppButton
                    variant="plain"
                    className="relative before:absolute before:inset-x-0 before:-inset-y-0.5 flex items-center gap-2.5 px-2.5 min-h-9 py-1.5 touch:min-h-11 grow min-w-0 cursor-pointer text-left text-stone-700 dark:text-stone-200"
                    aria-pressed={ticked.has(item.id)}
                    disabled={shown}
                    onClick={(e) => tick(item.id, e.shiftKey)}
                  >
                    <CheckboxIcon checked={ticked.has(item.id)} filled className={ticked.has(item.id) ? 'size-5 shrink-0 text-sky-500' : `size-5 shrink-0 text-stone-300 dark:text-stone-500 ${shown ? 'opacity-40' : ''}`} />
                    <ItemIcon type={item.type} className="size-4 shrink-0 text-stone-400" />
                    <RowTitle item={item} />
                  </AppButton>
                ) : (
                  <>
                  <AppButton
                    variant="plain"
                    className="relative before:absolute before:inset-x-0 before:-inset-y-0.5 flex items-center gap-2.5 px-2.5 min-h-9 py-1.5 touch:min-h-11 grow min-w-0 cursor-pointer text-left text-stone-700 dark:text-stone-200 rounded-[inherit] focus:outline-none"
                    aria-pressed={selected}
                    aria-current={shown ? 'true' : undefined}
                    onClick={() => onSelect(item.id)}
                  >
                    <ItemIcon type={item.type} className="size-4 shrink-0 text-stone-400" />
                    <RowTitle item={item} />
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
                {/* A finger drags by ≡ (a mouse drags the whole row); in select mode, where a row ticks, everyone does, as
                    iOS's edit mode has its grips. Alt+↑/↓ moves the selected item from the keyboard. */}
                <div {...handle(i)} data-no-drag data-testid="drag-handle" title={t('live.moveItem', { title: item.title })} className={`${ticking ? 'flex cursor-grab' : 'hidden touch:flex'} items-center justify-center size-11 shrink-0 touch-none text-stone-400 dark:text-stone-500`}>
                  <MenuIcon className="size-4" />
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      <div className="sticky bottom-0 pl-5 pr-(--beside-scrollbar) py-3 bg-ground lg:bg-sidebar">
        {ticking && ticked.size > 0 ? (
          <AppButton
            variant="plain"
            className="text-sm text-center w-full bg-red-500 text-white px-4 h-9 touch:h-11 rounded-full hover:bg-red-600 cursor-pointer flex items-center justify-center gap-2"
            onClick={() => void removeTicked()}
          >
            <TrashIcon className="size-4" strokeWidth={1.5} />
            {t('presentation.removeTicked', { n: ticked.size })}
          </AppButton>
        ) : ticking ? (
          <div className="text-sm text-center text-stone-400 dark:text-stone-500 py-2.5">{t('presentation.tickHint')}</div>
        ) : (
          // A menu, as a phone's + (Lars, 2026-11-05): the kinds, then Rubrik.
          <Dropdown
            className="w-full"
            menuClassName="w-56 p-1.5 rounded-xl!"
            button={{ className: `w-full flex items-center justify-center gap-2 h-9 touch:h-11 rounded-full text-sm cursor-pointer ${SKY_TINT}` }}
            trigger={
              <>
                <PlusIcon className="size-4" />
                {t('presentation.add')}
              </>
            }
          >
            <AddChoices onChoose={onAdd} />
          </Dropdown>
        )}
      </div>
      {menu && (
        <ItemContextMenu
          menu={menu}
          source={{
            ...menuSource,
            onTick: (item) => {
              setFirst(item.id);
              onTicking(true);
            },
          }}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

/**
 * A row's name, and under it its comment in grey on one line (spec 03 2f): what those who run the service need as the
 * item comes, seen without a hover, as Reminders shows a note (Lars, 2026-11-05).
 */
function RowTitle({ item }: { item: PresentationItem }) {
  return (
    <span className="min-w-0 flex flex-col">
      <span className="truncate">{item.title}</span>
      {item.note && <span className="truncate text-xs text-stone-500 dark:text-stone-400" data-testid="row-note">{item.note}</span>}
    </span>
  );
}
