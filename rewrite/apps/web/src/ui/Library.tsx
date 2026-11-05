import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../i18n.ts';
import { AppButton } from './AppButton.tsx';
import { useTrySave } from './AutoSave.tsx';
import { CONTEXT_ROW } from './ContextMenu.tsx';
import { Dropdown, MENU_ITEM } from './Dropdown.tsx';
import { deleteAsk, useConfirm } from './Dialog.tsx';
import { DropZone } from './DropZone.tsx';
import { EmptySmall } from './Empty.tsx';
import { LIFTED } from './glass.ts';
import { CAPTION } from './Group.tsx';
import { useHeaderFloat } from './headerFloat.ts';
import { saveFiles, type DownloadFile } from '../media/download.ts';
import { ArrowDownTrayIcon, CheckIcon, EllipsisIcon, PencilIcon, TrashIcon } from './icons.tsx';
import { useView, ViewPicker, type View } from './ViewPicker.tsx';
import { CARD, ROW_HOVER, RowChevron } from './List.tsx';
import { ListSearch, matches, NoMatch } from './ListSearch.tsx';
import { NameDialog } from './NameDialog.tsx';
import { PageContainer, PageHeader } from './PageContainer.tsx';
import { QuickLook, type QuickLookContent } from './QuickLook.tsx';
import { HoldMenu } from './RemoveMenu.tsx';
import { SortMenu, useStoredChoice } from './SortMenu.tsx';
import { useToast } from './Toast.tsx';

// Sånger, Biblar, Bilder, Ljud and Videor alike (Lars, 2026-11-04: "härma iOS 27"): the title, the search under it,
// the items as a list (Files) or a grid (Photos), how many in grey under them, and + floating at the bottom right.
// Välj, at the top right as iOS's, marks items with a round tick and floats a toolbar with Radera in place of +. Each
// item shows its ⋯ menu, Byt namn and Radera, which a finger held on it or a right click opens too; a tap on a
// picture, a video or a sound looks at it, as Quick Look does (ui/QuickLook.tsx).

export interface LibraryEntry {
  id: string;
  name: string;
}

/** A list row's parts: a thumbnail or icon, the title (the name if none), a grey line, and a control at its end. */
interface LibraryRow {
  leading?: ReactNode;
  title?: ReactNode;
  subtitle?: ReactNode;
  end?: ReactNode;
}

export interface LibraryProps<T extends LibraryEntry> {
  title: string;
  items: T[] | undefined;
  /** The search, when the page searches itself (Sånger searches the lyrics too); else by name and `words`. */
  search?: { query: string; onQuery: (query: string) => void; shown: T[] | undefined };
  words?: (item: T) => (string | null | undefined)[];
  /** How it shows at first; with `switchable`, the three views beside the order (ui/ViewPicker.tsx: Bilder, Videor, Bildspel). */
  layout: 'list' | 'grid';
  switchable?: boolean;
  renderRow?: (item: T, query: string) => LibraryRow;
  /** A grid item's picture; `large` in the large view, a picture a row, where a sharper one may be wanted. */
  renderTile?: (item: T, large: boolean) => ReactNode;
  /** Sections with a caption, while nothing is searched and the order is one that has them (Sånger's letters). */
  sections?: (shown: T[]) => { key: string; title: string; items: T[] }[];
  /** The orders to choose from, the first the default; `sections` says the list is in sections in that order. */
  sorts?: { key: string; label: string; compare: (a: T, b: T) => number; sections?: boolean }[];
  /** Where an item opens (a song's page). */
  open?: (item: T) => string;
  /** What a tap on an item looks at (a picture, a video, a sound). */
  preview?: (item: T) => QuickLookContent;
  manage: boolean;
  /** An item's own choices, first in its menu, each a `role="menuitem"` of class `row` (a deck's Ersätt med ny PDF). */
  renderActions?: (item: T, row: string) => ReactNode;
  rename?: { title: string; label: string; maxLength: number; run: (item: T, name: string) => Promise<unknown> };
  /** Ladda ner: an item's file, fetched if this device does not have it; several are saved as `zipName`.zip. */
  download?: { file: (item: T) => Promise<DownloadFile | null>; zipName: string };
  remove: {
    /** The question: one item named, or how many. */
    ask: (items: T[]) => { text: string; bold?: string };
    run: (item: T) => Promise<unknown>;
    done: (items: T[]) => string;
  };
  /** The heading row's + and the like, floating while Välj is off. */
  add?: ReactNode;
  /** Progress and failures of an import, under the title. */
  notices?: ReactNode;
  loading: string;
  /** The empty list: its icon and heading, what the page is for, and the first step's buttons, for one who manages. */
  empty: { icon: ReactNode; title: string; text?: string; action?: ReactNode };
  /** "Inga bilder matchar din sökning" (spec 05); else "Inga träffar för …". */
  noMatch?: string;
  count: (n: number) => string;
  /** Grey text under the count, as iOS's footers. */
  footer?: ReactNode;
  drop?: { label: string; accept: string; multiple?: boolean; onFiles: (files: File[]) => void };
  testId: string;
}

/** A grid item's picture: the cell's width, the picture in its middle (a video's still fills it). */
const TILE = 'relative w-full flex justify-center rounded-lg';

/** Radera in an item's ⋯ menu: as its other choices, in red. */
const MENU_DANGER = MENU_ITEM.replace('text-stone-700 dark:text-stone-200', 'text-red-600 dark:text-red-400');

const searching = (query: string) => !!query.trim();

/** From how many items a sectioned list has an index along its edge to jump by its captions. */
const INDEX_FROM = 20;

export function Library<T extends LibraryEntry>(p: LibraryProps<T>) {
  const trySave = useTrySave();
  const toast = useToast();
  const { dialog, ask } = useConfirm();
  const [ownQuery, setOwnQuery] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [renaming, setRenaming] = useState<T | null>(null);
  const [looking, setLooking] = useState<string | null>(null);

  const query = p.search?.query ?? ownQuery;
  const [sortKey, setSortKey] = useStoredChoice(`${p.testId}:sort`, p.sorts?.map((s) => s.key) ?? []);
  const [chosenView, setView] = useView(`${p.testId}:layout`, p.layout);
  const view: View = p.switchable ? chosenView : p.layout;
  const sort = p.sorts?.find((s) => s.key === sortKey);
  const found = p.search ? p.search.shown : p.items?.filter((i) => matches(query, i.name, ...(p.words?.(i) ?? [])));
  // A search keeps its own order, best hit first, as Sånger's does.
  const shown = sort && !(p.search && searching(query)) ? found?.toSorted(sort.compare) : found;
  const searchingNow = searching(query);
  const sections = p.sections && shown && !searchingNow && (!p.sorts || sort?.sections) ? p.sections(shown) : null;
  const pickedItems = (p.items ?? []).filter((i) => picked.has(i.id));
  const allPicked = !!shown?.length && shown.every((i) => picked.has(i.id));
  const lookedIndex = looking ? (shown ?? []).findIndex((i) => i.id === looking) : -1;
  const lookedAt = lookedIndex >= 0 ? { item: shown![lookedIndex]!, before: shown![lookedIndex - 1], after: shown![lookedIndex + 1] } : null;

  const stopSelecting = () => {
    setSelecting(false);
    setPicked(new Set());
  };
  const toggle = (item: T) =>
    setPicked((now) => {
      const next = new Set(now);
      if (!next.delete(item.id)) next.add(item.id);
      return next;
    });
  const remove = async (items: T[]) => {
    if (!items.length) return;
    const question = p.remove.ask(items);
    let removed: T[] = [];
    const confirmed = await ask(
      deleteAsk(question.text, question.bold, async () => {
        for (const item of items) if (await trySave(p.remove.run(item))) removed = [...removed, item];
      }),
    );
    if (!confirmed || !removed.length) return;
    toast(p.remove.done(removed));
    stopSelecting();
    if (removed.some((i) => i.id === looking)) setLooking(null);
  };

  const download = async (items: T[]) => {
    if (!p.download || !items.length) return;
    if (items.length > 1) toast(t('library.downloading', { n: items.length }));
    const files: DownloadFile[] = [];
    for (const item of items) {
      const file = await p.download.file(item).catch(() => null);
      if (file) files.push(file);
      else toast(t('library.downloadFailed', { name: item.name }));
    }
    saveFiles(files, p.download.zipName);
  };

  /** An item's choices: in its ⋯ menu (`row` MENU_ITEM) or in the menu a held finger opens (CONTEXT_ROW). */
  const menu = (item: T, row: string, danger: string) => (
    <>
      {p.renderActions?.(item, row)}
      {p.rename && (
        <AppButton variant="plain" role="menuitem" className={row} onClick={() => setRenaming(item)}>
          <PencilIcon className="size-4" />
          {t('library.rename')}
        </AppButton>
      )}
      {p.download && (
        <AppButton variant="plain" role="menuitem" className={row} onClick={() => void download([item])}>
          <ArrowDownTrayIcon className="size-4" />
          {t('library.download')}
        </AppButton>
      )}
      {/* Radera in a group of its own, under a line, as every menu has it (ItemContextMenu's DIVIDER). */}
      {(p.renderActions || p.rename || p.download) && <div role="separator" className="h-px my-1 bg-separator" />}
      <AppButton variant="plain" role="menuitem" className={danger} onClick={() => void remove([item])}>
        <TrashIcon className="size-4" strokeWidth={1.5} />
        {t('images.remove')}
      </AppButton>
    </>
  );
  // Not on what opens a page (a song): its page renames and deletes it (Lars, 2026-11-04); held, it has the menu still.
  const more = (item: T) =>
    p.manage && !p.open && (
      <Dropdown
        menuClassName="min-w-40 right-0"
        className="relative shrink-0"
        button={{ className: 'size-8 flex items-center justify-center rounded-full text-stone-400 hover:text-stone-600 dark:hover:text-stone-300 hover:bg-raised-2 cursor-pointer', 'aria-label': t('images.more', { name: item.name }) }}
        trigger={<EllipsisIcon className="size-4" />}
      >
        {menu(item, MENU_ITEM, MENU_DANGER)}
      </Dropdown>
    );
  const held = (item: T, node: ReactNode, className?: string) =>
    p.manage ? (
      <HoldMenu label={t('images.more', { name: item.name })} menu={menu(item, CONTEXT_ROW, `${CONTEXT_ROW} text-red-600 dark:text-red-400`)} className={className}>
        {node}
      </HoldMenu>
    ) : (
      node
    );

  const listRow = (item: T) => {
    const r = p.renderRow?.(item, query) ?? {};
    const body = (
      <>
        {r.leading}
        <span className="flex-1 min-w-0">
          <span className="block truncate">{r.title ?? item.name}</span>
          {r.subtitle && <span className="block text-xs text-stone-500 dark:text-stone-400 truncate">{r.subtitle}</span>}
        </span>
      </>
    );
    // The card does not clip, so a ⋯ menu reaches past its edge: the first and last rows round their own corners.
    const rowClass = `flex-1 min-w-0 flex items-center gap-3 px-5 py-3 text-left no-underline text-inherit group-first:rounded-t-xl group-last:rounded-b-xl ${ROW_HOVER}`;
    return (
      <li key={item.id} className="group flex items-center border-b border-separator last:border-b-0" aria-label={item.name} data-testid={`${p.testId}-row`}>
        {selecting ? (
          <AppButton variant="plain" role="checkbox" aria-checked={picked.has(item.id)} className={`${rowClass} cursor-pointer`} onClick={() => toggle(item)}>
            <Tick on={picked.has(item.id)} />
            {body}
          </AppButton>
        ) : (
          held(
            item,
            p.open ? (
              <a href={p.open(item)} className={rowClass}>
                {body}
                {!r.end && <RowChevron />}
              </a>
            ) : p.preview ? (
              <AppButton variant="plain" className={`${rowClass} cursor-pointer`} onClick={() => setLooking(item.id)}>
                {body}
              </AppButton>
            ) : (
              <div className={rowClass} tabIndex={p.manage ? 0 : undefined}>
                {body}
              </div>
            ),
            'flex-1 min-w-0 flex',
          )
        )}
        {!selecting && r.end && <div className={`shrink-0 ${p.manage ? 'pr-1' : 'pr-4'}`}>{r.end}</div>}
        {!selecting && p.manage && <div className="shrink-0 pr-2">{more(item)}</div>}
      </li>
    );
  };

  const gridTile = (item: T) => (
    <li key={item.id} className="relative p-2 flex flex-col items-center min-w-0" data-testid={`${p.testId}-card`}>
      {selecting ? (
        <AppButton variant="plain" role="checkbox" aria-checked={picked.has(item.id)} aria-label={item.name} className={`${TILE} cursor-pointer`} onClick={() => toggle(item)}>
          {/* The cell's width, as the tile has it outside Välj: a tile drawn at its width (a slide's page) is not 0 wide. */}
          <span className={`flex w-full justify-center ${picked.has(item.id) ? 'opacity-80' : ''}`}>{p.renderTile?.(item, view === 'large')}</span>
          <Tick on={picked.has(item.id)} className="absolute bottom-1.5 right-1.5" />
        </AppButton>
      ) : (
        held(
          item,
          p.open ? (
            <a href={p.open(item)} className={`${TILE} no-underline`} aria-label={item.name}>
              {p.renderTile?.(item, view === 'large')}
            </a>
          ) : p.preview ? (
            <AppButton variant="plain" className={`${TILE} cursor-pointer`} aria-label={item.name} onClick={() => setLooking(item.id)}>
              {p.renderTile?.(item, view === 'large')}
            </AppButton>
          ) : (
            <div className={TILE} tabIndex={p.manage ? 0 : undefined} aria-label={item.name}>
              {p.renderTile?.(item, view === 'large')}
            </div>
          ),
          'w-full',
        )
      )}
      {/* The name, and the ⋯ that says there is a menu (Lars, 2026-11-04: seen, not only held for). */}
      <div className="mt-1 h-8 w-full min-w-0 flex items-center justify-center gap-0.5">
        <p className="text-xs text-stone-500 dark:text-stone-400 truncate" title={item.name}>
          {item.name}
        </p>
        {!selecting && more(item)}
      </div>
    </li>
  );

  const list = (items: T[], label?: string) =>
    view === 'large' ? (
      // A picture a row, at a size to see it by, as Photos' largest zoom (Lars, 2026-11-05).
      <ul className="flex flex-col gap-4 max-w-2xl mx-auto w-full" aria-label={label} data-testid={`${p.testId}-large`}>
        {items.map(gridTile)}
      </ul>
    ) : view === 'grid' ? (
      // Columns by its own width, not the window's: Inställningar's page column is narrow on an iPad held upright.
      <div className="@container">
        <ul className="grid grid-cols-2 @sm:grid-cols-3 @lg:grid-cols-4 @2xl:grid-cols-5 @4xl:grid-cols-6 gap-1 -mx-2" aria-label={label} data-testid={`${p.testId}-grid`}>
          {items.map(gridTile)}
        </ul>
      </div>
    ) : (
      <ul className={CARD.replace(' overflow-hidden', '')} aria-label={label}>
        {items.map(listRow)}
      </ul>
    );

  const content = (
    <>
      {dialog}
      <PageHeader title={p.title}>
        {selecting ? (
          <Toolbar count={pickedItems.length} onRemove={() => void remove(pickedItems)} onDownload={p.download ? () => void download(pickedItems) : undefined} />
        ) : (
          p.add
        )}
      </PageHeader>
      {renaming && p.rename && (
        <NameDialog
          title={p.rename.title}
          label={p.rename.label}
          maxLength={p.rename.maxLength}
          initial={renaming.name}
          onClose={() => setRenaming(null)}
          submit={async (name) => {
            if (await trySave(p.rename!.run(renaming, name))) setRenaming(null);
          }}
        />
      )}
      {lookedAt && p.preview && (
        <QuickLook
          name={lookedAt.item.name}
          content={p.preview(lookedAt.item)}
          menu={p.manage && menu(lookedAt.item, MENU_ITEM, MENU_DANGER)}
          onPrevious={lookedAt.before ? () => setLooking(lookedAt.before!.id) : undefined}
          onNext={lookedAt.after ? () => setLooking(lookedAt.after!.id) : undefined}
          onClose={() => setLooking(null)}
        />
      )}
      {p.notices}
      {/* The search first, then a row with the order at the left and Välj at the right (Lars, 2026-11-04). */}
      {!!p.items?.length && (p.search ? <ListSearch query={query} onChange={p.search.onQuery} /> : <ListSearch query={query} onChange={setOwnQuery} />)}
      {!!p.items?.length && (p.sorts || p.manage || p.switchable) && (
        <div className="flex items-center justify-between gap-2 px-4 -mt-3 mb-3">
          <span className="flex items-center gap-1">
            {p.sorts && sort && <SortMenu choices={p.sorts} value={sort.key} onChange={setSortKey} />}
            {/* The three views as a segmented control, as Photos' and Finder's (Lars, 2026-11-04, three 2026-11-05). */}
            {p.switchable && <ViewPicker className="ml-2" value={view} onChange={setView} />}
          </span>
          {p.manage && (
            <span className="flex items-center gap-1 -mr-3">
              {selecting && (
                <AppButton variant="plain" className={HEADER_TEXT} onClick={() => setPicked(allPicked ? new Set() : new Set(shown?.map((i) => i.id)))}>
                  {t(allPicked ? 'library.deselectAll' : 'library.selectAll')}
                </AppButton>
              )}
              <AppButton variant="plain" className={`${HEADER_TEXT} font-semibold`} onClick={() => (selecting ? stopSelecting() : setSelecting(true))}>
                {t(selecting ? 'library.done' : 'library.select')}
              </AppButton>
            </span>
          )}
        </div>
      )}
      {!p.items && <div className="loading-line px-5 py-4 text-stone-400 text-sm">{p.loading}</div>}
      {p.items && !p.items.length && (
        <EmptySmall icon={p.empty.icon} title={p.empty.title} text={p.empty.text} dropHint={p.drop && p.manage ? p.drop.label : undefined}>
          {p.manage && p.empty.action}
        </EmptySmall>
      )}
      {!!p.items?.length && shown && !shown.length && (p.noMatch ? <p className="px-5 text-sm text-stone-400">{p.noMatch}</p> : <NoMatch query={query} />)}
      {sections && !!sections.length ? (
        <div className="flex gap-1">
          <ul className="flex-1 min-w-0 space-y-4" aria-label={p.title}>
            {sections.map((s) => (
              <li key={s.key} id={`${p.testId}-${s.key}`} className="space-y-1.5 scroll-mt-4">
                <h2 className={CAPTION}>{s.title}</h2>
                {list(s.items)}
              </li>
            ))}
          </ul>
          {/* The index along the edge, as Contacts' on an iPhone: a tap jumps to the caption. Only on a touch screen,
              where a long list is slow to scroll; with a mouse or a trackpad, as Contacts on a Mac, there is none. */}
          {shown!.length >= INDEX_FROM && (
            <nav aria-label={t('songs.index')} className="sticky top-2 self-start hidden pointer-coarse:flex flex-col items-center py-1">
              {sections.map((s) => (
                <AppButton
                  key={s.key}
                  variant="plain"
                  onClick={() => document.getElementById(`${p.testId}-${s.key}`)?.scrollIntoView({ block: 'start' })}
                  className="w-5 text-[11px]/4 font-semibold text-sky-600 dark:text-sky-400 cursor-pointer hover:underline"
                >
                  {s.title}
                </AppButton>
              ))}
            </nav>
          )}
        </div>
      ) : (
        !!shown?.length && list(shown, p.title)
      )}
      {!!shown?.length && <p className="text-center text-sm text-stone-500 dark:text-stone-400">{p.count(shown.length)}</p>}
      {p.footer}
    </>
  );

  const page = (
    <PageContainer>
      {/* Escape ends Välj, and only that (one step at a time, as everywhere). */}
      <div
        onKeyDown={(e) => {
          if (e.key !== 'Escape' || !selecting) return;
          e.stopPropagation();
          stopSelecting();
        }}
      >
        <div className="flex flex-col space-y-5">{content}</div>
      </div>
    </PageContainer>
  );
  // Files dropped anywhere on the page import, as Photos and Music take them anywhere in their window (Lars, 2026-11-05):
  // its heading and the room under a short list too, not only the list.
  return p.drop ? (
    <DropZone inset className="flex-1 min-h-0 flex flex-col" label={p.drop.label} accept={p.drop.accept} multiple={p.drop.multiple} enabled={p.manage && !selecting} onFiles={p.drop.onFiles}>
      {page}
    </DropZone>
  ) : (
    page
  );
}

/** Välj, Klar and Markera alla: words in the app's colour, as iOS's bar buttons. */
export const HEADER_TEXT = 'h-11 px-3 rounded-full text-[15px] text-sky-600 dark:text-sky-400 cursor-pointer hover:bg-raised-2';

/** A round tick, as iOS marks a chosen item: empty, or filled in the app's colour with a check. */
function Tick({ on, className }: { on: boolean; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`size-6 shrink-0 rounded-full flex items-center justify-center ${on ? 'bg-sky-500 text-white' : 'border-2 border-stone-300 dark:border-stone-600 bg-white/80 dark:bg-black/30'} ${className ?? ''}`}
    >
      {on && <CheckIcon className="size-4" />}
    </span>
  );
}

/** What Välj floats where + floats: how many are marked, Ladda ner where the items are files, and Radera. */
function Toolbar({ count, onRemove, onDownload }: { count: number; onRemove: () => void; onDownload?: () => void }) {
  const float = useHeaderFloat();
  const bar = (
    <div role="toolbar" aria-label={t('library.toolbar')} className={`h-14 pl-5 pr-2 rounded-full flex items-center gap-3 ${LIFTED}`}>
      <span className="text-[15px] text-stone-600 dark:text-stone-300 tabular-nums">{count ? t(count === 1 ? 'library.picked.one' : 'library.picked.many', { n: count }) : t('library.pickNone')}</span>
      {onDownload && (
        <AppButton variant="secondary" disabled={!count} onClick={onDownload}>
          {t('library.download')}
        </AppButton>
      )}
      <AppButton variant="danger" filled disabled={!count} onClick={onRemove}>
        {t('common.delete')}
      </AppButton>
    </div>
  );
  return float ? createPortal(bar, float) : <div className="sticky bottom-4 flex justify-center">{bar}</div>;
}
