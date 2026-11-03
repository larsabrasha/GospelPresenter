import { sortedArrangements, type Overlay, type PresentationItem, type Song, type SongArrangement } from '@gp/core';
import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useDb } from '../../db/react.tsx';
import { t } from '../../i18n.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { useSaveFailed } from '../../ui/AutoSave.tsx';
import { CONTEXT_ROW, ContextMenu } from '../../ui/ContextMenu.tsx';
import { afterWrite } from '../../ui/debounce.ts';
import { CheckIcon, CheckSquareIcon, ChevronRightIcon, PencilIcon, PlusIcon, QueueListIcon, SquaresOverlapOutlineIcon, TrashIcon } from '../../ui/icons.tsx';

/** What an item's menu needs from the page it is on, the same wherever it opens. */
export interface ItemMenuSource {
  songs: Map<string, Song>;
  arrangements: SongArrangement[];
  overlays: Overlay[];
  /** The item shown, which cannot be removed. */
  shownId: string | null;
  /** A song's page, opened alone in Inställningar. */
  editHref: (item: PresentationItem) => string | undefined;
  /** A picture item's order and removal, in place. */
  onEditImages?: (item: PresentationItem) => void;
  onAddAfter: (item: PresentationItem) => void;
  /** Markera: select mode, this item ticked first. */
  onTick: (item: PresentationItem) => void;
  onRemove: (item: PresentationItem) => void;
}

/** An item's menu, open at a point: from its row at the left (a right click or its …) or its heading's …. */
export type OpenItemMenu = { item: PresentationItem; at: { x: number; y: number } };

const DIVIDER = 'h-px my-1 mx-1 bg-separator';
const PANEL = 'fixed z-[136] min-w-44 max-w-64 p-1.5 rounded-xl bg-surface dark:bg-raised shadow-2xl ring-[0.5px] ring-separator';

/** A submenu beside its row, kept on screen: at the row's right, else its left. It is inside the menu, so a press in it is the menu's. */
function Submenu({ anchor, label, children }: { anchor: RefObject<HTMLElement | null>; label: string; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const row = anchor.current?.getBoundingClientRect();
    const el = panel.current;
    if (!row || !el) return;
    const { width, height } = el.getBoundingClientRect();
    const margin = 8;
    el.style.left = `${row.right + width + margin > innerWidth ? Math.max(margin, row.left - width - 4) : row.right + 4}px`;
    el.style.top = `${Math.max(margin, Math.min(row.top - 6, innerHeight - height - margin))}px`;
  }, [anchor]);
  return (
    <div ref={panel} role="menu" aria-label={label} className={PANEL} data-submenu>
      {children}
    </div>
  );
}

/**
 * A choice with a current value, as macOS's and iOS's menus have one: its name, the value in grey, and ›, its choices
 * opening beside it on a pointer resting on it or a tap.
 */
function SubmenuRow({ icon, label, value, open, onOpen, children }: { icon: ReactNode; label: string; value: string; open: boolean; onOpen: () => void; children: ReactNode }) {
  const row = useRef<HTMLButtonElement>(null);
  return (
    <div data-submenu>
      <AppButton
        ref={row}
        variant="plain"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        className={`${CONTEXT_ROW} ${open ? 'bg-raised dark:bg-raised-2' : ''}`}
        onPointerEnter={(e) => e.pointerType === 'mouse' && onOpen()}
        // A tap opens the choices rather than closing the menu.
        onClick={(e) => {
          e.stopPropagation();
          onOpen();
        }}
      >
        {icon}
        <span className="flex-1 truncate">{label}</span>
        <span className="max-w-28 truncate text-stone-400 dark:text-stone-500">{value}</span>
        <ChevronRightIcon className="size-3.5 shrink-0 text-stone-400 dark:text-stone-500" />
      </AppButton>
      {open && (
        <Submenu anchor={row} label={label}>
          {children}
        </Submenu>
      )}
    </div>
  );
}

/** The choices of a submenu, the chosen one ticked. */
function Choices({ choices, chosen, onChoose }: { choices: { id: string; title: string }[]; chosen: string; onChoose: (id: string) => void }) {
  return choices.map((c) => (
    <AppButton
      key={c.id}
      variant="plain"
      role="menuitemradio"
      aria-checked={chosen === c.id}
      data-choice={c.id}
      className={CONTEXT_ROW}
      // Read from the row, so what is chosen is what the row names.
      onClick={(e) => onChoose(e.currentTarget.dataset.choice ?? '')}
    >
      <span className="size-4 shrink-0">{chosen === c.id && <CheckIcon className="size-4 text-sky-500" />}</span>
      <span className="truncate">{c.title}</span>
    </AppButton>
  ));
}

/**
 * An item's menu, one and the same from its row at the left and its heading's … (Lars, 2026-11-03), grouped as Apple
 * groups one: opening the item (Redigera: a song's page, or a picture item's pictures); how it shows, its arrangement
 * and its overlay as rows with the chosen one in grey whose choices open beside them; the list around it, Lägg till
 * efter and Markera; and Radera last, in red, which the shown item cannot. No Flytta upp or ned: a row is dragged, or
 * moved with Alt+↑ and ↓ (Lars, 2026-11-03: as Apple's lists have it). An empty group leaves no line.
 */
export function ItemContextMenu({ menu, source, onClose }: { menu: OpenItemMenu; source: ItemMenuSource; onClose: () => void }) {
  const db = useDb();
  const saveFailed = useSaveFailed();
  const failing = (write: Promise<void>) => afterWrite(write, () => {}, saveFailed);
  const [sub, setSub] = useState<'arrangement' | 'overlay' | null>(null);
  const { item, at } = menu;
  const songHref = source.editHref(item);
  const song = item.type === 'song' ? source.songs.get(item.sourceId) : undefined;
  const arrangements = song && song.deletedAt === null ? sortedArrangements(source.arrangements, song.id) : [];
  const arrangementChoices = arrangements.map((a, i) => ({ id: a.id, title: a.name ?? `${t('song.arrangement')} ${i + 1}` }));
  const arrangementId = item.arrangementId ?? arrangements[0]?.id ?? '';
  const overlayChoices = [{ id: '', title: t('overlays.itemNone') }, ...source.overlays.map((o) => ({ id: o.id, title: o.title }))];
  const overlayId = item.overlayId ?? '';
  const editImages = item.type === 'image' && source.onEditImages;
  const removable = item.id !== source.shownId;

  const opening = (songHref || editImages) && (
    <>
      {songHref && (
        <AppButton variant="plain" role="menuitem" href={songHref} className={CONTEXT_ROW}>
          <PencilIcon className="size-4" />
          {t('presentation.editSong')}
        </AppButton>
      )}
      {editImages && (
        <AppButton variant="plain" role="menuitem" className={CONTEXT_ROW} onClick={() => editImages(item)}>
          <PencilIcon className="size-4" />
          {t('presentation.editImages')}
        </AppButton>
      )}
    </>
  );
  const showing = (arrangements.length > 1 || !!source.overlays.length) && (
    <>
      {arrangements.length > 1 && (
        <SubmenuRow icon={<QueueListIcon className="size-4" />} label={t('song.arrangements')} value={arrangementChoices.find((c) => c.id === arrangementId)?.title ?? ''} open={sub === 'arrangement'} onOpen={() => setSub('arrangement')}>
          <Choices choices={arrangementChoices} chosen={arrangementId} onChoose={(id) => failing(db.mutate('setItemArrangement', { itemId: item.id, arrangementId: id }))} />
        </SubmenuRow>
      )}
      {!!source.overlays.length && (
        <SubmenuRow icon={<SquaresOverlapOutlineIcon className="size-4" />} label={t('overlays.itemOverlay')} value={overlayChoices.find((c) => c.id === overlayId)?.title ?? ''} open={sub === 'overlay'} onOpen={() => setSub('overlay')}>
          <Choices choices={overlayChoices} chosen={overlayId} onChoose={(id) => failing(db.mutate('setItemOverlay', { itemId: item.id, overlayId: id || null }))} />
        </SubmenuRow>
      )}
    </>
  );
  const listing = (
    <>
      <AppButton variant="plain" role="menuitem" className={CONTEXT_ROW} onClick={() => source.onAddAfter(item)}>
        <PlusIcon className="size-4" />
        {t('live.addAfter')}
      </AppButton>
      <AppButton variant="plain" role="menuitem" className={CONTEXT_ROW} onClick={() => source.onTick(item)}>
        <CheckSquareIcon className="size-4" />
        {t('presentation.tick')}
      </AppButton>
    </>
  );
  const removing = (
    <AppButton variant="plain" role="menuitem" className={`${CONTEXT_ROW} text-red-600 dark:text-red-400`} disabled={!removable} onClick={() => source.onRemove(item)}>
      <TrashIcon className="size-4" strokeWidth={1.5} />
      {removable ? t('common.delete') : t('live.shownCannotRemove')}
    </AppButton>
  );

  return (
    <ContextMenu at={at} label={t('presentation.itemOptions', { title: item.title })} onClose={onClose}>
      {/* A pointer on any other row closes an open submenu, as on macOS. */}
      <div onPointerOver={(e) => !(e.target as Element).closest('[data-submenu]') && setSub(null)}>
        {opening}
        {opening && <div className={DIVIDER} />}
        {showing}
        {showing && <div className={DIVIDER} />}
        {listing}
        <div className={DIVIDER} />
        {removing}
      </div>
    </ContextMenu>
  );
}
