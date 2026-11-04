import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../i18n.ts';
import { AppButton } from './AppButton.tsx';
import { useTrySave } from './AutoSave.tsx';
import { CONTEXT_ROW } from './ContextMenu.tsx';
import { deleteAsk, useConfirm } from './Dialog.tsx';
import { DropMore, DropZone } from './DropZone.tsx';
import { EmptySmall } from './Empty.tsx';
import { LIFTED } from './glass.ts';
import { CAPTION } from './Group.tsx';
import { useHeaderFloat } from './headerFloat.ts';
import { CheckIcon, PencilIcon } from './icons.tsx';
import { CARD, ROW_HOVER, RowChevron } from './List.tsx';
import { ListSearch, matches, NoMatch } from './ListSearch.tsx';
import { NameDialog } from './NameDialog.tsx';
import { PageContainer, PageHeader } from './PageContainer.tsx';
import { HoldMenu, RemoveRow } from './RemoveMenu.tsx';
import { useToast } from './Toast.tsx';

// Sånger, Biblar, Bilder, Ljud and Videor alike (Lars, 2026-11-04: "härma iOS 27"): the title, the search under it,
// the items as a list (Files) or a grid (Photos), how many in grey under them, and + floating at the bottom right.
// Välj, at the top right as iOS's, marks items with a round tick and floats a toolbar with Radera in place of +; a
// finger held on an item, or a right click, opens its menu: Byt namn and Radera.

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
  layout: 'list' | 'grid';
  renderRow?: (item: T, query: string) => LibraryRow;
  /** A grid item's picture. */
  renderTile?: (item: T) => ReactNode;
  /** Sections with a caption, while nothing is searched (Sånger's letters); an index along the edge when long. */
  sections?: (shown: T[]) => { key: string; title: string; items: T[] }[];
  /** Where an item opens (a song's page); else a tap does nothing but mark it while Välj is on. */
  open?: (item: T) => string;
  manage: boolean;
  rename?: { title: string; label: string; maxLength: number; run: (item: T, name: string) => Promise<unknown> };
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
  empty: { icon: ReactNode; title: string };
  /** "Inga bilder matchar din sökning" (spec 05); else "Inga träffar för …". */
  noMatch?: string;
  count: (n: number) => string;
  /** Grey text under the count, as iOS's footers. */
  footer?: ReactNode;
  drop?: { label: string; accept: string; multiple?: boolean; onFiles: (files: File[]) => void };
  testId: string;
}

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

  const query = p.search?.query ?? ownQuery;
  const shown = p.search ? p.search.shown : p.items?.filter((i) => matches(query, i.name, ...(p.words?.(i) ?? [])));
  const searching = !!query.trim();
  const sections = p.sections && shown && !searching ? p.sections(shown) : null;
  const pickedItems = (p.items ?? []).filter((i) => picked.has(i.id));
  const allPicked = !!shown?.length && shown.every((i) => picked.has(i.id));

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
  };

  const menu = (item: T) => (
    <>
      {p.rename && (
        <AppButton variant="plain" role="menuitem" className={CONTEXT_ROW} onClick={() => setRenaming(item)}>
          <PencilIcon className="size-4" />
          {t('library.rename')}
        </AppButton>
      )}
      <RemoveRow onRemove={() => void remove([item])} />
    </>
  );
  const held = (item: T, node: ReactNode, className?: string) =>
    p.manage ? (
      <HoldMenu label={t('images.more', { name: item.name })} menu={menu(item)} className={className}>
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
    const rowClass = `flex-1 min-w-0 flex items-center gap-3 px-5 py-3 text-left no-underline text-inherit ${ROW_HOVER}`;
    return (
      <li key={item.id} className="flex items-center border-b border-separator last:border-b-0" aria-label={item.name} data-testid={`${p.testId}-row`}>
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
            ) : (
              <div className={rowClass} tabIndex={p.manage ? 0 : undefined}>
                {body}
              </div>
            ),
            'flex-1 min-w-0 flex',
          )
        )}
        {!selecting && r.end && <div className="shrink-0 pr-4">{r.end}</div>}
      </li>
    );
  };

  const gridTile = (item: T) => (
    <li key={item.id} className="relative p-2 flex flex-col items-center min-w-0" data-testid={`${p.testId}-card`}>
      {selecting ? (
        <AppButton variant="plain" role="checkbox" aria-checked={picked.has(item.id)} aria-label={item.name} className="relative rounded-lg cursor-pointer" onClick={() => toggle(item)}>
          <span className={picked.has(item.id) ? 'block opacity-80' : 'block'}>{p.renderTile?.(item)}</span>
          <Tick on={picked.has(item.id)} className="absolute bottom-1.5 right-1.5" />
        </AppButton>
      ) : (
        held(
          item,
          <div className="relative rounded-lg" tabIndex={p.manage ? 0 : undefined} aria-label={item.name}>
            {p.renderTile?.(item)}
          </div>,
        )
      )}
      <p className="text-xs text-stone-500 dark:text-stone-400 truncate mt-1 text-center w-full" title={item.name}>
        {item.name}
      </p>
    </li>
  );

  const list = (items: T[], label?: string) =>
    p.layout === 'grid' ? (
      // Columns by its own width, not the window's: Inställningar's page column is narrow on an iPad held upright.
      <div className="@container">
        <ul className="grid grid-cols-2 @sm:grid-cols-3 @lg:grid-cols-4 @2xl:grid-cols-5 @4xl:grid-cols-6 gap-1 -mx-2" aria-label={label} data-testid={`${p.testId}-grid`}>
          {items.map(gridTile)}
        </ul>
      </div>
    ) : (
      <ul className={CARD} aria-label={label}>
        {items.map(listRow)}
      </ul>
    );

  const content = (
    <>
      {dialog}
      <PageHeader title={p.title}>
        {!!p.items?.length && p.manage && (
          <span className="flex items-center gap-1">
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
        {selecting ? <Toolbar count={pickedItems.length} onRemove={() => void remove(pickedItems)} /> : p.add}
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
      {p.notices}
      {!!p.items?.length && (p.search ? <ListSearch query={query} onChange={p.search.onQuery} /> : <ListSearch query={query} onChange={setOwnQuery} />)}
      {!p.items && <div className="loading-line px-5 py-4 text-stone-400 text-sm">{p.loading}</div>}
      {p.items && !p.items.length && <EmptySmall icon={p.empty.icon} title={p.empty.title} dropHint={p.drop && p.manage ? p.drop.label : undefined} />}
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
          {/* The index along the edge, as Contacts': a tap jumps to the caption. */}
          {shown!.length >= INDEX_FROM && (
            <nav aria-label={t('songs.index')} className="sticky top-2 self-start flex flex-col items-center py-1">
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
      {p.drop && p.manage && !!p.items?.length && <DropMore text={p.drop.label} />}
    </>
  );

  return (
    <PageContainer>
      {/* Escape ends Välj, and only that (one step at a time, as everywhere). */}
      <div
        onKeyDown={(e) => {
          if (e.key !== 'Escape' || !selecting) return;
          e.stopPropagation();
          stopSelecting();
        }}
      >
        {p.drop ? (
          <DropZone className="flex flex-col space-y-5" label={p.drop.label} accept={p.drop.accept} multiple={p.drop.multiple} enabled={p.manage && !selecting} onFiles={p.drop.onFiles}>
            {content}
          </DropZone>
        ) : (
          <div className="flex flex-col space-y-5">{content}</div>
        )}
      </div>
    </PageContainer>
  );
}

/** Välj, Klar and Markera alla: words in the app's colour, as iOS's bar buttons. */
const HEADER_TEXT = 'h-11 px-3 rounded-full text-[15px] text-sky-600 dark:text-sky-400 cursor-pointer hover:bg-raised-2';

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

/** What Välj floats where + floats: how many are marked, and Radera. */
function Toolbar({ count, onRemove }: { count: number; onRemove: () => void }) {
  const float = useHeaderFloat();
  const bar = (
    <div role="toolbar" aria-label={t('library.toolbar')} className={`h-14 pl-5 pr-2 rounded-full flex items-center gap-3 ${LIFTED}`}>
      <span className="text-[15px] text-stone-600 dark:text-stone-300 tabular-nums">{count ? t(count === 1 ? 'library.picked.one' : 'library.picked.many', { n: count }) : t('library.pickNone')}</span>
      <AppButton variant="danger" filled disabled={!count} onClick={onRemove}>
        {t('common.delete')}
      </AppButton>
    </div>
  );
  return float ? createPortal(bar, float) : <div className="sticky bottom-4 flex justify-center">{bar}</div>;
}
