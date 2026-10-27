import { listThemes, searchSongs, songSlides, sortedArrangements, type PresentationItem, type SongArrangement, type Theme } from '@gp/core';
import { useEffect, useEffectEvent, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { useBlobUrl, useData, useDb, useShownOverlay } from '../db/react.tsx';
import { arrangementsOf, getPresentation, getSong, itemsOf, listLabels, listOverlays, searchableSongs, songPartsOf, songsById, themeOf } from '../db/queries.ts';
import { t } from '../i18n.ts';
import { newId } from '../ids.ts';
import { slidesOf, type ItemSlides } from '../live/live.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { Dialog, DialogButtons, Modal, useConfirm } from '../ui/Dialog.tsx';
import { FloatingInput, FloatingSelect } from '../ui/Floating.tsx';
import { Highlight } from '../ui/Highlight.tsx';
import {
  BookOpenIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CloseIcon,
  EmptySlidesPicture,
  ItemIcon,
  MusicalNoteIcon,
  MusicalNoteOutlineIcon,
  PencilIcon,
  PhotoIcon,
  PlayIcon,
  PlusIcon,
  SpeakerWaveIcon,
  TrashIcon,
  WarningIcon,
} from '../ui/icons.tsx';
import { PillTabs } from '../ui/PillTabs.tsx';
import { AddFooter, EmptyTab, SearchField } from '../ui/Picker.tsx';
import { href, navigate } from '../ui/router.ts';
import { tileClass } from '../ui/SlideTile.tsx';
import { SlideView } from '../ui/SlideView.tsx';
import { useToast } from '../ui/Toast.tsx';
import { KeepOffline, MediaReadiness } from '../ui/MediaReadiness.tsx';
import { BibleTab } from './BibleTab.tsx';
import { AudioTab } from './AudioTab.tsx';
import { ImageTab } from './ImageTab.tsx';
import { CreateSongDialog } from './Songs.tsx';

/** "lör 1 nov. 2026" in the viewer's (Swedish) calendar; the date is a plain day, not an instant. */
export function formatEventDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString('sv-SE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

/** Arrangement pills, shown when a song has two or more (spec 02); unnamed ones read "Arrangemang". */
function ArrangementPills({ arrangements, chosen, onChoose, className }: { arrangements: SongArrangement[]; chosen: string | null; onChoose: (id: string) => void; className?: string }) {
  if (arrangements.length < 2) return null;
  return (
    <div className={`flex flex-wrap gap-1.5 ${className ?? ''}`} role="group" aria-label={t('song.arrangements')}>
      {arrangements.map((a) => (
        <AppButton
          key={a.id}
          variant="plain"
          aria-pressed={a.id === chosen}
          onClick={() => onChoose(a.id)}
          className={`${a.id === chosen ? 'bg-sky-500 text-white' : 'bg-neutral-200 dark:bg-neutral-700 text-neutral-700 dark:text-neutral-200 hover:bg-neutral-300 dark:hover:bg-neutral-600'} rounded-full px-3 py-1 text-xs font-medium cursor-pointer transition-colors`}
        >
          {a.name ?? t('song.arrangement')}
        </AppButton>
      ))}
    </div>
  );
}

/** An audio item in the editor: a player for the file (spec 03), once this device has it, in a card (AudioPlayer.razor). */
function AudioPreview({ hash, name }: { hash: string; name: string }) {
  const url = useBlobUrl(hash);
  return (
    <div className="w-full sm:max-w-lg sm:mx-auto bg-white dark:bg-neutral-800 rounded-xl p-4 shadow-sm space-y-3">
      <p className="text-sm font-medium truncate">{name}</p>
      {url ? <audio controls src={url} aria-label={name} data-testid="audio-preview" className="w-full" /> : <p className="text-sm text-neutral-400">{t('presentation.audioFetching')}</p>}
    </div>
  );
}

/**
 * The slides of an item, or a song in the add dialog; with the overlay the item
 * carries drawn above each. A wrapping grid of tiles (SlideGrid.razor), or with
 * `column` one under the other at full width, as the add dialog's preview.
 */
function SlideGrid({ slides, label, theme, overlayId = null, column }: { slides: ItemSlides['slides']; label: string; theme: Theme; overlayId?: string | null; column?: boolean }) {
  const overlay = useShownOverlay(overlayId);
  return (
    <ol className={column ? 'flex flex-col gap-2' : 'flex flex-wrap gap-3'} aria-label={label}>
      {slides.map((s, i) => (
        <li key={s.key} className={`${tileClass({ interactive: false })} ${column ? '' : 'w-full sm:w-[calc(50%-0.75rem)] lg:w-96 m-1'}`} aria-label={`${label} ${i + 1}`}>
          <SlideView slide={s} theme={theme} overlay={overlay} />
        </li>
      ))}
    </ol>
  );
}

interface TabProps {
  presentationId: string;
  afterItemId: string | null;
  theme: Theme;
  onAdded: (itemId: string) => void;
  onClose: () => void;
}

/**
 * The add-item modal (spec 03 2d): Sånger, Bibeltexter, Bilder and Ljud, Ctrl/⌘+1 to +4
 * switch. It never closes after an add (D15). The new item goes after the
 * selected one and becomes selected.
 */
function AddItemDialog(props: TabProps) {
  const [tab, setTab] = useState<'songs' | 'bible' | 'images' | 'audio'>('songs');
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && ['1', '2', '3', '4'].includes(e.key)) {
      e.preventDefault();
      setTab(({ '1': 'songs', '2': 'bible', '3': 'images', '4': 'audio' } as const)[e.key as '1' | '2' | '3' | '4']);
    }
  };
  const tabs: [typeof tab, string, (p: { className?: string }) => ReactNode][] = [
    ['songs', t('nav.songs'), MusicalNoteIcon],
    ['bible', t('bible.tab'), BookOpenIcon],
    ['images', t('presentation.imagesTab'), PhotoIcon],
    ['audio', t('presentation.audioTab'), SpeakerWaveIcon],
  ];
  return (
    <Modal title={t('presentation.addTitle')} onClose={props.onClose} className="max-w-4xl">
      <div className="flex-1 min-h-0 flex flex-col" onKeyDown={onKeyDown}>
        <div className="mb-4 md:flex md:justify-center">
          <PillTabs role="tablist">
            {tabs.map(([key, label, Icon]) => (
              <AppButton key={key} variant={tab === key ? 'pillActive' : 'pill'} role="tab" aria-selected={tab === key} onClick={() => setTab(key)}>
                <Icon className="hidden md:block size-4" />
                {label}
              </AppButton>
            ))}
          </PillTabs>
        </div>
        {tab === 'songs' && <SongTab key="songs" {...props} />}
        {tab === 'bible' && <BibleTab key="bible" {...props} />}
        {tab === 'images' && <ImageTab key="images" {...props} />}
        {tab === 'audio' && <AudioTab key="audio" {...props} />}
      </div>
    </Modal>
  );
}

/**
 * The song tab: Ctrl/Cmd+Enter and Shift+Enter add, and the search starts
 * over for the next song.
 */
function SongTab({ presentationId, afterItemId, theme, onAdded }: TabProps) {
  const db = useDb();
  const toast = useToast();
  const songs = useData(searchableSongs, []);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [arrangementId, setArrangementId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
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
    await db.mutate('addSongToPresentation', { itemId, presentationId, songId: selected.id, arrangementId, afterItemId });
    toast(t('presentation.added', { name: selected.name }));
    onAdded(itemId);
    setQuery('');
    select(null);
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
                  onClick={() => select(s.id)}
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
        </div>
        <div className="w-full md:w-1/2 min-w-0 md:min-h-0 md:overflow-y-auto overflow-x-hidden md:pl-3 pt-3 md:pt-0">
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
      <AddFooter hint={t('presentation.addHint')} name={selected?.name} label={selected ? t('presentation.addSong', { name: selected.name }) : undefined} onAdd={selected ? () => void add() : undefined} />
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

/** "Redigera detaljer": the name, the event date and the theme (spec 03 2a, spec 05). */
function DetailsDialog({
  id,
  name: initialName,
  eventDate,
  themeId,
  onClose,
}: {
  id: string;
  name: string;
  eventDate: string | null;
  themeId: string | null;
  onClose: () => void;
}) {
  const db = useDb();
  const [name, setName] = useState(initialName);
  const [date, setDate] = useState(eventDate ?? '');
  const [theme, setTheme] = useState(themeId ?? '');
  return (
    <Dialog title={t('presentation.editDetails')} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          void db.mutate('updatePresentation', { id, name, eventDate: date || null, themeId: theme || null });
          onClose();
        }}
      >
        <FloatingInput label={t('presentation.name')} autoFocus maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
        <FloatingInput label={t('presentation.date')} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <FloatingSelect label={t('presentation.theme')} value={theme} onChange={(e) => setTheme(e.target.value)}>
          <option value="">{t('presentation.themeDefault')}</option>
          {listThemes().map((th) => (
            <option key={th.id} value={th.id}>
              {th.name}
            </option>
          ))}
        </FloatingSelect>
        <DialogButtons>
          <AppButton variant="cancel" onClick={onClose}>
            {t('common.cancel')}
          </AppButton>
          <AppButton type="submit" disabled={!name.trim()}>
            {t('common.save')}
          </AppButton>
        </DialogButtons>
      </form>
    </Dialog>
  );
}

/** The selected item's title: click or F2 to rename; Enter or leaving saves, Escape cancels (PRES-A18). */
function ItemTitle({ item, editing, setEditing }: { item: PresentationItem; editing: boolean; setEditing: (on: boolean) => void }) {
  const db = useDb();
  if (!editing) {
    return (
      <h2 className="text-xl/7 font-semibold cursor-pointer hover:text-sky-500 truncate min-w-0" onClick={() => setEditing(true)} title={t('presentation.rename')}>
        {item.title}
      </h2>
    );
  }
  const save = (v: string) => {
    setEditing(false);
    if (v.trim() && v.trim() !== item.title) void db.mutate('renameItem', { itemId: item.id, title: v });
  };
  return (
    <input
      autoFocus
      className="min-w-0 flex-1 text-xl font-semibold px-2 py-1 -mx-2 rounded-lg border border-sky-500 bg-transparent dark:bg-neutral-700 focus:outline-none focus:ring-2 focus:ring-sky-500"
      maxLength={200}
      aria-label={t('presentation.rename')}
      defaultValue={item.title}
      onBlur={(e) => save(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') save(e.currentTarget.value);
        else if (e.key === 'Escape') setEditing(false);
      }}
    />
  );
}

/** A warning about the selected item, in the main area, with an action at its end when there is one. */
function ItemWarning({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
      <WarningIcon className="size-5 shrink-0" />
      <p className="flex-1 min-w-0">{children}</p>
      {action}
    </div>
  );
}

/** The presentation editor (spec 03 2): the running order on the left, the selected item on the right. */
export function PresentationEditor({ id }: { id: string }) {
  const db = useDb();
  const toast = useToast();
  const { dialog, ask } = useConfirm();
  const data = useData(
    async (d) => {
      const items = await itemsOf(d, id);
      const songIds = [...new Set(items.filter((i) => i.type === 'song').map((i) => i.sourceId))];
      const slides = new Map<string, ItemSlides>();
      for (const item of items) slides.set(item.id, await slidesOf(d, item));
      const presentation = await getPresentation(d, id);
      return {
        presentation,
        theme: await themeOf(d, presentation),
        items,
        slides,
        songs: await songsById(d, songIds),
        arrangements: await arrangementsOf(d, songIds),
        overlays: await listOverlays(d),
      };
    },
    [id],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [details, setDetails] = useState(false);
  const [renaming, setRenaming] = useState(false);

  const items = data?.items ?? [];
  const selected = items.find((i) => i.id === selectedId) ?? null;

  const removeItem = async (item: PresentationItem) => {
    const ok = await ask({ title: t('presentation.removeTitle'), text: t('presentation.removeConfirm', { title: item.title }), confirm: t('common.delete') });
    if (ok) void db.mutate('removeItem', { itemId: item.id });
  };

  // Page shortcuts (spec 03 section 6). A dialog stops its keys, so these never fire behind one.
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (document.querySelector('[aria-modal="true"]')) return; // a dialog is open, even if focus slipped behind it (PRES-R37)
    if (e.key === 'a') setAdding(true);
    else if (e.key === 'F2' && selected) setRenaming(true);
    else if (e.key === 'Delete' && selected) void removeItem(selected);
    else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && items.length && !e.shiftKey) {
      // PRES-R41: no wrap; the first ↓ lands on the first item, the first ↑ on the last.
      const at = items.findIndex((i) => i.id === selected?.id);
      const next = at === -1 ? (e.key === 'ArrowDown' ? 0 : items.length - 1) : Math.min(items.length - 1, Math.max(0, at + (e.key === 'ArrowDown' ? 1 : -1)));
      setSelectedId(items[next]!.id);
    } else return;
    e.preventDefault();
  });
  useEffect(() => {
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  if (!data) return null;
  const { presentation, slides, songs, theme, overlays } = data;
  if (!presentation || presentation.deletedAt !== null) return <p className="p-6 text-center text-sm text-neutral-500 dark:text-neutral-400">{t('presentation.notFound')}</p>;

  const trash = async () => {
    // To the trash without a dialog, with a toast that says where it went (PRES-R29).
    await db.mutate('trashPresentation', { id, at: Date.now() });
    toast(t('presentation.trashed', { name: presentation.name }));
    navigate({ page: 'presentations' });
  };

  const selectedSong = selected?.type === 'song' ? songs.get(selected.sourceId) : undefined;
  const selectedArrangements = selectedSong ? sortedArrangements(data.arrangements, selectedSong.id) : [];
  const selectedSlides = selected ? slides.get(selected.id) : undefined;

  const moveButton = 'size-7 flex items-center justify-center rounded-full cursor-pointer disabled:opacity-30 disabled:cursor-default';

  return (
    <section className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden">
      {dialog}
      <aside className="w-full lg:w-[300px] shrink-0 lg:h-full flex flex-col bg-white dark:bg-neutral-800 lg:shadow-xl lg:z-10 lg:overflow-y-auto">
        <div className="shrink-0 px-4 pt-4 pb-2 space-y-2">
          <h1 className="font-semibold text-lg/7 px-1 line-clamp-2">{presentation.name}</h1>
          {presentation.eventDate && (
            <p className="px-1 -mt-1 text-xs text-neutral-500 dark:text-neutral-400" data-testid="schedule">
              {formatEventDate(presentation.eventDate)}
            </p>
          )}
          <div className="px-1 space-y-1">
            <KeepOffline presentationId={id} />
            <MediaReadiness presentationId={id} audio />
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <AppButton variant="neutral" onClick={() => setDetails(true)} className="text-xs! px-3! py-1.5! inline-flex items-center gap-1.5">
              <PencilIcon className="size-4" />
              {t('presentation.editDetails')}
            </AppButton>
            <AppButton variant="danger" onClick={() => void trash()} className="text-xs! px-3! py-1.5! inline-flex items-center gap-1.5">
              <TrashIcon className="size-4" />
              {t('presentation.trash')}
            </AppButton>
          </div>
        </div>
        <div className="lg:flex-1 lg:min-h-0 lg:overflow-y-auto">
          <ol className="pb-8" aria-label={t('presentation.items')}>
            {items.map((item, i) => {
              const problem = slides.get(item.id)?.problem;
              const carried = item.overlayId ? overlays.find((o) => o.id === item.overlayId) : undefined;
              const isSelected = item.id === selectedId;
              return (
                <li
                  key={item.id}
                  className={`flex items-center mx-2 rounded-lg text-sm group ${isSelected ? 'bg-sky-500 text-white' : 'text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700'}`}
                >
                  <AppButton
                    variant="plain"
                    className="flex items-center gap-3 px-3 py-3 grow cursor-pointer min-w-0 text-left rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500"
                    aria-pressed={isSelected}
                    onClick={() => {
                      setSelectedId(item.id);
                      setRenaming(false);
                    }}
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
                  <span className={`flex items-center shrink-0 pr-1 ${isSelected ? 'text-white/70' : 'text-neutral-300 dark:text-neutral-500'}`}>
                    <AppButton
                      variant="plain"
                      className={`${moveButton} ${isSelected ? 'hover:bg-sky-400 hover:text-white' : 'hover:bg-neutral-200 dark:hover:bg-neutral-600 hover:text-neutral-600 dark:hover:text-neutral-300'}`}
                      aria-label={`${t('common.moveUp')} ${item.title}`}
                      disabled={i === 0}
                      onClick={() => void db.mutate('moveItem', { itemId: item.id, by: -1 })}
                    >
                      <ChevronUpIcon className="size-3.5" />
                    </AppButton>
                    <AppButton
                      variant="plain"
                      className={`${moveButton} ${isSelected ? 'hover:bg-sky-400 hover:text-white' : 'hover:bg-neutral-200 dark:hover:bg-neutral-600 hover:text-neutral-600 dark:hover:text-neutral-300'}`}
                      aria-label={`${t('common.moveDown')} ${item.title}`}
                      disabled={i === items.length - 1}
                      onClick={() => void db.mutate('moveItem', { itemId: item.id, by: 1 })}
                    >
                      <ChevronDownIcon className="size-3.5" />
                    </AppButton>
                    <AppButton
                      variant="plain"
                      className={`${moveButton} ${isSelected ? 'hover:bg-sky-400 hover:text-white' : 'hover:bg-red-100 dark:hover:bg-red-950/60 hover:text-red-500'}`}
                      aria-label={`${t('presentation.remove')} ${item.title}`}
                      onClick={() => void removeItem(item)}
                    >
                      <CloseIcon className="size-3.5" />
                    </AppButton>
                  </span>
                </li>
              );
            })}
          </ol>
          <div className="sticky bottom-0 p-3 bg-white dark:bg-neutral-800">
            <AppButton variant="secondary" onClick={() => setAdding(true)} className="w-full flex items-center justify-center gap-2">
              <PlusIcon className="size-4" />
              {t('presentation.add')}
            </AppButton>
          </div>
        </div>
      </aside>
      <div className="flex-1 min-w-0 flex flex-col bg-neutral-100 dark:bg-neutral-900 lg:overflow-y-auto">
        <div className="flex items-center justify-between gap-3 px-5 py-3 lg:pr-3">
          {selected ? <ItemTitle key={selected.id} item={selected} editing={renaming} setEditing={setRenaming} /> : <span />}
          <AppButton
            variant="plain"
            href={href({ page: 'live', id })}
            className="fixed bottom-3 right-3 z-30 lg:static shrink-0 px-4 py-2.5 rounded-full flex items-center gap-2 shadow-lg cursor-pointer bg-emerald-500 text-white hover:bg-emerald-600"
          >
            <PlayIcon className="size-5" />
            <span className="text-sm font-medium">{t('presentation.start')}</span>
          </AppButton>
        </div>
        <div className="flex-1 flex flex-col gap-3 px-3 pb-24 lg:pb-3">
          {!items.length && (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-12 select-none">
              <EmptySlidesPicture className="w-48 h-auto mb-6 text-neutral-300 dark:text-neutral-600" />
              <h2 className="text-lg/7 font-semibold text-neutral-500 dark:text-neutral-400 mb-2">{t('presentation.empty')}</h2>
              <p className="text-sm text-neutral-400 dark:text-neutral-500 max-w-xs leading-relaxed">{t('presentation.emptyText')}</p>
            </div>
          )}
          {!selected && !!items.length && (
            <div className="flex-1 flex items-center justify-center py-12 select-none">
              <p className="text-sm text-neutral-400 dark:text-neutral-500 italic">{t('presentation.selectItem')}</p>
            </div>
          )}
          {selected && selectedSlides?.problem === 'song-trashed' && (
            <ItemWarning
              action={
                <AppButton
                  variant="secondary"
                  onClick={async () => {
                    await db.mutate('restoreSong', { id: selected.sourceId });
                    toast(t('presentation.songRestored', { name: selectedSong?.name ?? selected.title }));
                  }}
                >
                  {t('common.restore')}
                </AppButton>
              }
            >
              {t('presentation.songTrashed')}
            </ItemWarning>
          )}
          {selected && selectedSlides?.problem === 'song-missing' && <ItemWarning>{t('presentation.songMissing')}</ItemWarning>}
          {selected && selectedSlides?.problem === 'image-missing' && <ItemWarning>{t('presentation.imageMissing')}</ItemWarning>}
          {selected && selectedSlides?.problem === 'audio-missing' && <ItemWarning>{t('presentation.audioMissing')}</ItemWarning>}
          {selected && selectedSlides?.audio && <AudioPreview hash={selectedSlides.audio.hash} name={selectedSlides.audio.fileName} />}
          {selected && (selectedSong?.deletedAt === null || !!overlays.length) && (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-1 empty:hidden">
              {selectedSong?.deletedAt === null && (
                <ArrangementPills
                  arrangements={selectedArrangements}
                  chosen={selected.arrangementId ?? selectedArrangements[0]?.id ?? null}
                  onChoose={(arrangementId) => void db.mutate('setItemArrangement', { itemId: selected.id, arrangementId })}
                />
              )}
              {!!overlays.length && (
                <label className="flex flex-wrap items-center gap-2 text-sm text-neutral-500 dark:text-neutral-400" title={t('overlays.itemHint')}>
                  {t('overlays.itemOverlay')}
                  <span className="relative">
                    <select
                      aria-label={t('overlays.itemOverlay')}
                      value={selected.overlayId ?? ''}
                      onChange={(e) => void db.mutate('setItemOverlay', { itemId: selected.id, overlayId: e.target.value || null })}
                      className="appearance-none py-1.5 pl-3 pr-8 rounded-full border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-700 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
                    >
                      <option value="">{t('overlays.itemNone')}</option>
                      {overlays.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.title}
                        </option>
                      ))}
                    </select>
                    <ChevronDownIcon className="size-4 absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
                  </span>
                  <span className="text-xs text-neutral-400 dark:text-neutral-500">{t('overlays.itemHint')}</span>
                </label>
              )}
            </div>
          )}
          {selected && selectedSlides && <SlideGrid theme={theme} label={selected.title} slides={selectedSlides.slides} overlayId={selected.overlayId} />}
        </div>
      </div>
      {adding && <AddItemDialog presentationId={id} afterItemId={selectedId} theme={theme} onAdded={setSelectedId} onClose={() => setAdding(false)} />}
      {details && (
        <DetailsDialog id={id} name={presentation.name} eventDate={presentation.eventDate} themeId={presentation.themeId} onClose={() => setDetails(false)} />
      )}
    </section>
  );
}
