import { songSlides, sortedArrangements, type Song } from '@gp/core';
import { memo, useCallback, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useData, useDb, useSongSearch } from '../../db/react.tsx';
import { arrangementsOf, getSong, listLabels, songPartsOf } from '../../db/queries.ts';
import { t } from '../../i18n.ts';
import { newId } from '../../ids.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { useTrySave } from '../../ui/AutoSave.tsx';
import { Highlight } from '../../ui/Highlight.tsx';
import { AdjustmentsIcon, ArrowDownTrayIcon, CloseIcon, MusicalNoteOutlineIcon, PencilIcon, PlusIcon } from '../../ui/icons.tsx';
import { AddFooter, EmptyTab, isAddKey, SearchField, useFocusWhenShown } from '../../ui/Picker.tsx';
import { DropZone } from '../../ui/DropZone.tsx';
import { useSongImport } from '../SongImport.tsx';
import { href } from '../../ui/router.ts';
import { ctrlLabel } from '../../ui/shortcuts.ts';
import { useToast } from '../../ui/Toast.tsx';
import { useStepped } from '../../ui/useStepped.ts';
import type { TabProps } from './AddItemDialog.tsx';
import { ArrangementPills, SlideGrid } from './SlideGrid.tsx';

const NONE: Song[] = [];

/** A hit in the song list; drawn again only when its song, its choice or the query changes. */
const SongRow = memo(function SongRow({ song: s, chosen, query, onPick }: { song: Song; chosen: boolean; query: string; onPick: (id: string) => void }) {
  return (
    <li>
      <AppButton
        variant="plain"
        aria-pressed={chosen}
        onClick={() => onPick(s.id)}
        className={`w-full text-left px-3 h-[52px] mb-1 flex flex-col justify-center rounded-lg cursor-pointer text-sm ${
          chosen ? 'bg-sky-500/15 dark:bg-sky-500/20 ring-1 ring-inset ring-sky-500/30' : 'bg-raised/70 dark:bg-raised/50 hover:bg-raised-2'
        }`}
      >
        <span className="block truncate w-full">
          <Highlight text={s.name} query={query} />
        </span>
        <span className="block text-xs text-stone-400 truncate w-full">{s.author ? <Highlight text={s.author} query={query} /> : '\u00a0'}</span>
      </AppButton>
    </li>
  );
});

/** Below `md`, as SongTab.razor's `window.innerWidth < 768`. */
const isPhone = () => matchMedia('(max-width: 767.98px)').matches;

/**
 * The song tab: Ctrl/⌘+Enter adds, and the search starts over for the next song. The arrows move
 * through the hits and keep the chosen one in view; the pencil opens the song's editor (SongTab.razor).
 */
export function SongTab({
  presentationId,
  afterItemId,
  theme,
  onAdded,
  active,
  onEditSong,
  onNewSong,
}: TabProps & { onEditSong: (songId: string) => void; /** Skapa: a new song named as the search, in its editor. */ onNewSong: (query: string) => void }) {
  const db = useDb();
  const trySave = useTrySave();
  const toast = useToast();
  const [query, setQuery] = useState('');
  // Searched in the database's worker: `shown` answers `shownQuery`, which trails `query` until it has answered.
  const { songs, shown: found, shownQuery } = useSongSearch(query);
  // ProPresenter files imported here, in the moment, as in Sånger (Lars, 2026-11-05): beside the search, or dropped.
  const songImport = useSongImport(songs);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [arrangementId, setArrangementId] = useState<string | null>(null);
  // On a phone a tapped song opens its preview over the add dialog, with the add button there (SongTab.razor).
  const [fullScreen, setFullScreen] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const previewPane = useRef<HTMLDivElement>(null);
  const adding = useRef(false);
  useFocusWhenShown(search, active);
  const shown = found ?? NONE;
  // Typing selects the first hit, also when the library loads after the typing; never a hit of an earlier search.
  const answered = !query.trim() || shownQuery === query;
  const fresh = shown.find((s) => s.id === selectedId) ?? (query.trim() && answered ? (shown[0] ?? null) : null);
  // While a key's search is under way the song before it stays selected, so the preview does not blink empty.
  const [held, setHeld] = useState<Song | null>(null);
  if (answered && held !== fresh) setHeld(fresh);
  const selected = answered ? fresh : (fresh ?? held);
  const effectiveId = selected?.id ?? null;
  // A long list is drawn in steps: 3 000 rows at once (a cleared search, after an add) held up the running order 300 ms.
  const rows = useStepped(shown);
  // Stable, so a row is not drawn again for a new handler.
  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    setArrangementId(null); // the first arrangement is preselected (SONG-R19)
    previewPane.current?.scrollTo(0, 0);
  }, []);
  const onPick = useCallback(
    (id: string) => {
      select(id);
      if (isPhone()) setFullScreen(true);
    },
    [select],
  );

  const preview = useData(
    async (d) => {
      if (!effectiveId) return null;
      const song = await getSong(d, effectiveId);
      if (!song) return null;
      const arrangements = sortedArrangements(await arrangementsOf(d, [song.id]), song.id);
      return { song, arrangements, parts: await songPartsOf(d, [song.id]), labels: await listLabels(d) };
    },
    [effectiveId],
  );
  const shownPreview = preview?.song.id === effectiveId ? preview : null;
  const chosen = arrangementId ?? shownPreview?.arrangements[0]?.id ?? null;

  // A new search, or a cleared one, starts both lists at the top and selects the first hit.
  const searchFor = (v: string) => {
    setQuery(v);
    select(v.trim() ? null : (songs?.[0]?.id ?? null));
    list.current?.scrollTo(0, 0);
  };

  const add = async () => {
    // Once at a time: a double click or a held key adds one item, not two (SongTab.razor's isAdding).
    if (!selected || adding.current) return;
    adding.current = true;
    try {
      const itemId = newId();
      // No pick stores null: the item then follows the song's first arrangement, whatever it becomes.
      if (!(await trySave(db.mutate('addSongToPresentation', { itemId, presentationId, songId: selected.id, arrangementId, afterItemId })))) return;
      toast(t('presentation.added', { name: selected.name }));
      onAdded(itemId);
      setQuery('');
      select(null);
      setFullScreen(false);
      search.current?.focus();
    } finally {
      adding.current = false;
    }
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (isAddKey(e)) {
      e.preventDefault();
      void add();
    } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && shown.length && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      const at = shown.findIndex((s) => s.id === effectiveId);
      const next = at === -1 ? (e.key === 'ArrowDown' ? 0 : shown.length - 1) : Math.min(shown.length - 1, Math.max(0, at + (e.key === 'ArrowDown' ? 1 : -1)));
      select(shown[next]!.id);
      list.current?.querySelectorAll('li')[next]?.scrollIntoView({ block: 'nearest' });
    }
  };

  const create = (
    <AppButton variant="secondary" onClick={() => onNewSong(query.trim())} className="flex items-center gap-1.5">
      <PlusIcon className="size-4" />
      {t('common.create')}
    </AppButton>
  );
  const importing = (
    <AppButton variant="secondary" disabled={songImport.busy} onClick={songImport.pick} className="shrink-0 flex items-center gap-1.5">
      <ArrowDownTrayIcon className="size-4 shrink-0" />
      {songImport.busy ? t('songs.import.busy') : t('songs.import.short')}
    </AppButton>
  );
  const notices = (
    <>
      {songImport.input}
      {songImport.dialog}
    </>
  );
  const drop = { label: t('songs.import.drop'), accept: '.pro', onFiles: (files: File[]) => void (songImport.busy || songImport.files(files)) };

  // An empty library: the line, Hantera sånger (every role manages songs) and Skapa, in the middle of the whole tab.
  if (songs && !songs.length)
    return (
      <DropZone className="flex-1 min-h-0 flex flex-col items-center justify-center text-center text-sm gap-3 select-none" {...drop}>
        {notices}
        <MusicalNoteOutlineIcon className="size-12 mb-1 text-stone-300 dark:text-stone-600" />
        <p className="text-stone-400 dark:text-stone-500">{t('songs.emptyTitle')}</p>
        <AppButton variant="secondary" href={href({ page: 'songs' })} className="flex items-center gap-1.5">
          <AdjustmentsIcon className="size-4" />
          {t('presentation.manageSongs')}
        </AppButton>
        {create}
        {importing}
        {songImport.status}
      </DropZone>
    );

  // The phone's preview is outside the drop area: it covers the whole add dialog, not the area the drop frames.
  return (
    <>
    <DropZone className="flex-1 min-h-0 flex flex-col" {...drop}>
    {notices}
    <div className="flex-1 min-h-0 flex flex-col" onKeyDown={onKeyDown}>
      <div className="shrink-0 flex items-center gap-3">
        <SearchField inputRef={search} label={t('presentation.searchSongs')} value={query} onChange={searchFor} />
        {importing}
      </div>
      {songImport.status && <div className="shrink-0 mt-3">{songImport.status}</div>}
      <div className="mt-3 flex-1 min-h-0 flex flex-col md:flex-row overflow-y-auto md:overflow-hidden">
        <div className="w-full md:w-1/2 min-w-0 flex flex-col md:pr-3 md:min-h-0">
          {songs && !shown.length && (
            <EmptyTab icon={<MusicalNoteOutlineIcon className="size-12 mb-1 text-stone-300 dark:text-stone-600" />}>
              <p>{t('songs.noHits')}</p>
              {create}
            </EmptyTab>
          )}
          <ul ref={list} className="md:flex-1 md:min-h-0 md:overflow-y-auto" aria-label={t('nav.songs')}>
            {rows.map((s) => (
              <SongRow key={s.id} song={s} chosen={s.id === effectiveId} query={shownQuery} onPick={onPick} />
            ))}
          </ul>
          {/* Under the list whenever it has songs, as the current app's; an empty list has its own. */}
          {/* Room under it for its shadow, which the scrolling column would cut. */}
          {!!shown.length && <div className="shrink-0 pt-3 pb-4">{create}</div>}
        </div>
        <div ref={previewPane} className="hidden md:block md:w-1/2 min-w-0 md:min-h-0 md:overflow-y-auto overflow-x-hidden md:pl-3">
          {!shownPreview && (
            <div className="flex flex-col items-center justify-center h-full py-8 text-sm text-stone-400 dark:text-stone-500 select-none">
              <MusicalNoteOutlineIcon className="size-12 mb-3 text-stone-300 dark:text-stone-600" />
              <p>{t('presentation.noSongSelected')}</p>
            </div>
          )}
          {shownPreview && (
            <>
              <div className="mb-4 px-1 flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-sm/5">
                    <Highlight text={shownPreview.song.name} query={query} />
                  </h3>
                  {shownPreview.song.author && (
                    <p className="text-xs text-stone-400">
                      <Highlight text={shownPreview.song.author} query={query} />
                    </p>
                  )}
                </div>
                <AppButton
                  variant="icon"
                  className="shrink-0 size-7! text-stone-400 hover:text-stone-600 dark:hover:text-stone-200"
                  title={t('presentation.editSong')}
                  aria-label={t('presentation.editSong')}
                  onClick={() => onEditSong(shownPreview.song.id)}
                >
                  <PencilIcon className="size-4" />
                </AppButton>
              </div>
              <ArrangementPills arrangements={shownPreview.arrangements} chosen={chosen} onChoose={setArrangementId} className="mb-3 px-1" />
              <SlideGrid
                column
                theme={theme}
                label={shownPreview.song.name}
                slides={songSlides(shownPreview.song, shownPreview.parts, shownPreview.labels, shownPreview.arrangements, chosen)}
                highlight={query}
              />
            </>
          )}
        </div>
      </div>
      <div className="hidden md:block">
        <AddFooter
          hint={t('presentation.addHint', { key: ctrlLabel('Enter') })}
          name={selected?.name}
          label={selected ? t('presentation.addSong', { name: selected.name }) : undefined}
          onAdd={selected ? () => void add() : undefined}
        />
      </div>
    </div>
    </DropZone>
    {/* On a phone the preview covers the add dialog, a sheet over the dimmed page: the old dialog's transform made its `fixed inset-0` the dialog's box (SongTab.razor). */}
    {fullScreen && shownPreview && selected && (
      <div
        className="md:hidden absolute inset-0 z-50 flex flex-col bg-surface"
        role="dialog"
        aria-modal="true"
        aria-label={shownPreview.song.name}
        data-testid="song-preview-full"
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return;
          e.stopPropagation(); // Escape closes the preview, not the whole add dialog
          setFullScreen(false);
        }}
      >
        <div className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-separator">
          <AppButton variant="icon" autoFocus aria-label={t('common.close')} title={t('common.close')} onClick={() => setFullScreen(false)}>
            <CloseIcon className="size-5" />
          </AppButton>
          <div className="flex-1 min-w-0 text-left">
            <h3 className="font-semibold text-sm truncate">{shownPreview.song.name}</h3>
            {shownPreview.song.author && <p className="text-xs text-stone-400 truncate">{shownPreview.song.author}</p>}
          </div>
          <AppButton
            variant="icon"
            className="shrink-0"
            title={t('presentation.editSong')}
            aria-label={t('presentation.editSong')}
            onClick={() => onEditSong(shownPreview.song.id)}
          >
            <PencilIcon className="size-4" />
          </AppButton>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <ArrangementPills arrangements={shownPreview.arrangements} chosen={chosen} onChoose={setArrangementId} className="mb-3" />
          <SlideGrid
            column
            theme={theme}
            label={shownPreview.song.name}
            slides={songSlides(shownPreview.song, shownPreview.parts, shownPreview.labels, shownPreview.arrangements, chosen)}
          />
        </div>
        <div className="shrink-0 flex items-center justify-end gap-4 px-4 py-3 border-t-[0.5px] border-separator">
          <AppButton aria-label={t('presentation.addSong', { name: selected.name })} onClick={() => void add()} className="min-w-0 inline-flex items-center gap-1">
            <span className="shrink-0">{t('presentation.add')}</span> <span className="font-bold truncate">{selected.name}</span>
          </AppButton>
        </div>
      </div>
    )}
    </>
  );
}
