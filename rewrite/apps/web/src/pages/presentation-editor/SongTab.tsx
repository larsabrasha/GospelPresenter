import { searchSongs, songSlides, sortedArrangements } from '@gp/core';
import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useData, useDb } from '../../db/react.tsx';
import { arrangementsOf, getSong, listLabels, searchableSongs, songPartsOf } from '../../db/queries.ts';
import { t } from '../../i18n.ts';
import { newId } from '../../ids.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { useTrySave } from '../../ui/AutoSave.tsx';
import { Highlight } from '../../ui/Highlight.tsx';
import { CloseIcon, MusicalNoteOutlineIcon, PlusIcon } from '../../ui/icons.tsx';
import { AddFooter, EmptyTab, SearchField } from '../../ui/Picker.tsx';
import { useToast } from '../../ui/Toast.tsx';
import { CreateSongDialog } from '../Songs.tsx';
import type { TabProps } from './AddItemDialog.tsx';
import { ArrangementPills, SlideGrid } from './SlideGrid.tsx';

/** Below `md`, as SongTab.razor's `window.innerWidth < 768`. */
const isPhone = () => matchMedia('(max-width: 767.98px)').matches;

/**
 * The song tab: Ctrl/Cmd+Enter and Shift+Enter add, and the search starts
 * over for the next song.
 */
export function SongTab({ presentationId, afterItemId, theme, onAdded }: TabProps) {
  const db = useDb();
  const trySave = useTrySave();
  const toast = useToast();
  const songs = useData(searchableSongs, []);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [arrangementId, setArrangementId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // On a phone a tapped song opens its preview full screen, with the add button there (SongTab.razor).
  const [fullScreen, setFullScreen] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const shown = songs ? searchSongs(songs, query) : [];
  // Typing selects the first hit, also when the library loads after the typing.
  const selected = shown.find((s) => s.id === selectedId) ?? (query.trim() ? (shown[0] ?? null) : null);
  const effectiveId = selected?.id ?? null;

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

  const select = (id: string | null) => {
    setSelectedId(id);
    setArrangementId(null); // the first arrangement is preselected (SONG-R19)
  };

  const add = async () => {
    if (!selected) return;
    const itemId = newId();
    // No pick stores null: the item then follows the song's first arrangement, whatever it becomes.
    if (!(await trySave(db.mutate('addSongToPresentation', { itemId, presentationId, songId: selected.id, arrangementId, afterItemId })))) return;
    toast(t('presentation.added', { name: selected.name }));
    onAdded(itemId);
    setQuery('');
    select(null);
    setFullScreen(false);
    search.current?.focus();
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || e.shiftKey)) {
      e.preventDefault();
      void add();
    } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && shown.length && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      const at = shown.findIndex((s) => s.id === effectiveId);
      const next = at === -1 ? (e.key === 'ArrowDown' ? 0 : shown.length - 1) : Math.min(shown.length - 1, Math.max(0, at + (e.key === 'ArrowDown' ? 1 : -1)));
      select(shown[next]!.id);
    }
  };

  const create = (
    <AppButton variant="secondary" onClick={() => setCreating(true)} className="flex items-center gap-1.5">
      <PlusIcon className="size-4" />
      {t('common.create')}
    </AppButton>
  );

  return (
    <div className="flex-1 min-h-0 flex flex-col" onKeyDown={onKeyDown}>
      <div className="shrink-0 flex">
        <SearchField
          inputRef={search}
          autoFocus
          label={t('presentation.searchSongs')}
          value={query}
          onChange={(v) => {
            setQuery(v);
            select(null);
          }}
        />
      </div>
      <div className="mt-3 flex-1 min-h-0 flex flex-col md:flex-row overflow-y-auto md:overflow-hidden">
        <div className="w-full md:w-1/2 min-w-0 flex flex-col md:pr-3 md:min-h-0">
          {songs && !shown.length && (
            <EmptyTab icon={<MusicalNoteOutlineIcon className="size-12 mb-1 text-neutral-300 dark:text-neutral-600" />}>
              <p>{songs.length ? t('songs.noHits') : t('songs.emptyTitle')}</p>
              {create}
            </EmptyTab>
          )}
          <ul className="md:flex-1 md:min-h-0 md:overflow-y-auto" aria-label={t('nav.songs')}>
            {shown.map((s) => (
              <li key={s.id}>
                <AppButton
                  variant="plain"
                  aria-pressed={s.id === effectiveId}
                  onClick={() => {
                    select(s.id);
                    if (isPhone()) setFullScreen(true);
                  }}
                  className={`w-full text-left px-3 h-[52px] mb-1 flex flex-col justify-center rounded-lg cursor-pointer text-sm ${
                    s.id === effectiveId ? 'bg-sky-500/15 dark:bg-sky-500/20 ring-1 ring-inset ring-sky-500/30' : 'bg-neutral-50 dark:bg-neutral-700/50 hover:bg-neutral-200 dark:hover:bg-neutral-600'
                  }`}
                >
                  <span className="block truncate w-full">
                    <Highlight text={s.name} query={query} />
                  </span>
                  <span className="block text-xs text-neutral-400 truncate w-full">{s.author ? <Highlight text={s.author} query={query} /> : '\u00a0'}</span>
                </AppButton>
              </li>
            ))}
          </ul>
          {/* Under the list whenever it has songs, as the current app's; an empty list has its own. */}
          {!!shown.length && <div className="shrink-0 pt-3">{create}</div>}
        </div>
        <div className="hidden md:block md:w-1/2 min-w-0 md:min-h-0 md:overflow-y-auto overflow-x-hidden md:pl-3">
          {!shownPreview && (
            <div className="flex flex-col items-center justify-center h-full py-8 text-sm text-neutral-400 dark:text-neutral-500 select-none">
              <MusicalNoteOutlineIcon className="size-12 mb-3 text-neutral-300 dark:text-neutral-600" />
              <p>{t('presentation.noSongSelected')}</p>
            </div>
          )}
          {shownPreview && (
            <>
              <div className="mb-4 px-1">
                <h3 className="font-semibold text-sm/5">{shownPreview.song.name}</h3>
                {shownPreview.song.author && <p className="text-xs text-neutral-400">{shownPreview.song.author}</p>}
              </div>
              <ArrangementPills arrangements={shownPreview.arrangements} chosen={chosen} onChoose={setArrangementId} className="mb-3 px-1" />
              <SlideGrid
                column
                theme={theme}
                label={shownPreview.song.name}
                slides={songSlides(shownPreview.song, shownPreview.parts, shownPreview.labels, shownPreview.arrangements, chosen)}
              />
            </>
          )}
        </div>
      </div>
      <div className="hidden md:block">
        <AddFooter hint={t('presentation.addHint')} name={selected?.name} label={selected ? t('presentation.addSong', { name: selected.name }) : undefined} onAdd={selected ? () => void add() : undefined} />
      </div>
      {fullScreen && shownPreview && selected && (
        <div
          className="md:hidden fixed inset-0 z-50 flex flex-col bg-white dark:bg-neutral-800"
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
          <div className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-neutral-200 dark:border-neutral-700">
            <AppButton variant="icon" autoFocus aria-label={t('common.close')} title={t('common.close')} onClick={() => setFullScreen(false)}>
              <CloseIcon className="size-5" />
            </AppButton>
            <div className="flex-1 min-w-0 text-left">
              <h3 className="font-semibold text-sm truncate">{shownPreview.song.name}</h3>
              {shownPreview.song.author && <p className="text-xs text-neutral-400 truncate">{shownPreview.song.author}</p>}
            </div>
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
          <div className="shrink-0 flex items-center justify-end gap-4 px-4 py-3 border-t-[0.5px] border-neutral-200 dark:border-neutral-700">
            <AppButton aria-label={t('presentation.addSong', { name: selected.name })} onClick={() => void add()} className="min-w-0 inline-flex items-center gap-1">
              <span className="shrink-0">{t('presentation.add')}</span> <span className="font-bold truncate">{selected.name}</span>
            </AppButton>
          </div>
        </div>
      )}
      {creating && (
        <CreateSongDialog
          initial={query}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            setQuery('');
            select(id);
          }}
        />
      )}
    </div>
  );
}
