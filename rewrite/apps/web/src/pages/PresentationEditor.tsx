import { searchSongs, songSlides, sortedArrangements, type PresentationItem, type SongArrangement } from '@gp/core';
import { useEffect, useEffectEvent, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useData, useDb } from '../db/react.tsx';
import { arrangementsOf, getPresentation, getSong, itemsOf, listLabels, searchableSongs, songPartsOf, songsById } from '../db/queries.ts';
import { t } from '../i18n.ts';
import { newId } from '../ids.ts';
import { slidesOf, type ItemSlides } from '../live/live.ts';
import { Button } from '../ui/Button.tsx';
import { Dialog, useConfirm } from '../ui/Dialog.tsx';
import { Highlight } from '../ui/Highlight.tsx';
import { href, navigate } from '../ui/router.ts';
import { SlideView } from '../ui/SlideView.tsx';
import { useToast } from '../ui/Toast.tsx';
import { CreateSongDialog } from './Songs.tsx';

/** "lör 1 nov. 2026" in the viewer's (Swedish) calendar; the date is a plain day, not an instant. */
export function formatEventDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString('sv-SE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

/** Arrangement pills, shown when a song has two or more (spec 02); unnamed ones read "Arrangemang". */
function ArrangementPills({ arrangements, chosen, onChoose }: { arrangements: SongArrangement[]; chosen: string | null; onChoose: (id: string) => void }) {
  if (arrangements.length < 2) return null;
  return (
    <div className="row" role="group" aria-label={t('song.arrangements')}>
      {arrangements.map((a) => (
        <Button key={a.id} className="pill-button" aria-pressed={a.id === chosen} onClick={() => onChoose(a.id)}>
          {a.name ?? t('song.arrangement')}
        </Button>
      ))}
    </div>
  );
}

function SlideGrid({ slides, label }: { slides: ItemSlides['slides']; label: string }) {
  return (
    <ol className="thumbs grid" aria-label={label}>
      {slides.map((s, i) => (
        <li key={s.key} className="thumb" aria-label={`${label} ${i + 1}`}>
          <SlideView slide={s} />
        </li>
      ))}
    </ol>
  );
}

/**
 * The song picker (spec 03 2d, Sånger). It never closes after an add (D15):
 * Ctrl/Cmd+Enter and Shift+Enter add, and the search starts over for the next
 * song. The new item goes after the selected one and becomes selected.
 */
function AddSongDialog({
  presentationId,
  afterItemId,
  onAdded,
  onClose,
}: {
  presentationId: string;
  afterItemId: string | null;
  onAdded: (itemId: string) => void;
  onClose: () => void;
}) {
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

  return (
    <Dialog title={t('presentation.addTitle')} onClose={onClose} wide>
      <div className="picker" onKeyDown={onKeyDown}>
        <div className="picker-list">
          <div className="row">
            <input
              ref={search}
              autoFocus
              className="grow"
              type="search"
              maxLength={100}
              aria-label={t('presentation.searchSongs')}
              placeholder={t('presentation.searchSongs')}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                select(null);
              }}
            />
            {query && (
              <Button aria-label={t('common.clear')} onClick={() => setQuery('')}>
                ×
              </Button>
            )}
          </div>
          {songs && !shown.length && (
            <div className="empty">
              <p className="muted">{songs.length ? t('songs.noHits') : t('songs.emptyTitle')}</p>
              <Button onClick={() => setCreating(true)}>{t('common.create')}</Button>
            </div>
          )}
          <ul className="list selectable" aria-label={t('nav.songs')}>
            {shown.map((s) => (
              <li key={s.id}>
                <Button className="list-button" aria-pressed={s.id === effectiveId} onClick={() => select(s.id)}>
                  <strong>
                    <Highlight text={s.name} query={query} />
                  </strong>
                  {s.author && (
                    <span className="muted">
                      {' · '}
                      <Highlight text={s.author} query={query} />
                    </span>
                  )}
                </Button>
              </li>
            ))}
          </ul>
        </div>
        <div className="picker-preview">
          {!shownPreview && <p className="muted">{t('presentation.noSongSelected')}</p>}
          {shownPreview && (
            <>
              <h3>{shownPreview.song.name}</h3>
              {shownPreview.song.author && <p className="muted">{shownPreview.song.author}</p>}
              <ArrangementPills arrangements={shownPreview.arrangements} chosen={chosen} onChoose={setArrangementId} />
              <SlideGrid
                label={shownPreview.song.name}
                slides={songSlides(shownPreview.song, shownPreview.parts, shownPreview.labels, shownPreview.arrangements, chosen)}
              />
            </>
          )}
        </div>
      </div>
      <p className="muted small">{t('presentation.addHint')}</p>
      <div className="row end">
        <Button onClick={onClose}>{t('common.close')}</Button>
        {selected && (
          <Button variant="primary" onClick={() => void add()}>
            {t('presentation.addSong', { name: selected.name })}
          </Button>
        )}
      </div>
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
    </Dialog>
  );
}

/** "Redigera detaljer": the name and the event date (spec 03 2a). */
function DetailsDialog({ id, name: initialName, eventDate, onClose }: { id: string; name: string; eventDate: string | null; onClose: () => void }) {
  const db = useDb();
  const [name, setName] = useState(initialName);
  const [date, setDate] = useState(eventDate ?? '');
  return (
    <Dialog title={t('presentation.editDetails')} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          void db.mutate('updatePresentation', { id, name, eventDate: date || null });
          onClose();
        }}
      >
        <label className="field">
          {t('presentation.name')}
          <input autoFocus maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          {t('presentation.date')}
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <div className="row end">
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" type="submit" disabled={!name.trim()}>
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** The selected item's title: click or F2 to rename; Enter or leaving saves, Escape cancels (PRES-A18). */
function ItemTitle({ item, editing, setEditing }: { item: PresentationItem; editing: boolean; setEditing: (on: boolean) => void }) {
  const db = useDb();
  if (!editing) {
    return (
      <h2 className="grow item-title" onClick={() => setEditing(true)} title={t('presentation.rename')}>
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
      className="title-input grow"
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

/** The presentation editor (spec 03 2): the running order on the left, the selected item on the right. */
export function PresentationEditor({ id }: { id: string }) {
  const db = useDb();
  const toast = useToast();
  const { dialog, ask } = useConfirm();
  const data = useData(
    async (d) => {
      const items = await itemsOf(d, id);
      const songIds = [...new Set(items.map((i) => i.sourceId))];
      const slides = new Map<string, ItemSlides>();
      for (const item of items) slides.set(item.id, await slidesOf(d, item));
      return {
        presentation: await getPresentation(d, id),
        items,
        slides,
        songs: await songsById(d, songIds),
        arrangements: await arrangementsOf(d, songIds),
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
  const { presentation, slides, songs } = data;
  if (!presentation || presentation.deletedAt !== null) return <p>{t('presentation.notFound')}</p>;

  const trash = async () => {
    // To the trash without a dialog, with a toast that says where it went (PRES-R29).
    await db.mutate('trashPresentation', { id, at: Date.now() });
    toast(t('presentation.trashed', { name: presentation.name }));
    navigate({ page: 'presentations' });
  };

  const selectedSong = selected ? songs.get(selected.sourceId) : undefined;
  const selectedArrangements = selectedSong ? sortedArrangements(data.arrangements, selectedSong.id) : [];
  const selectedSlides = selected ? slides.get(selected.id) : undefined;

  return (
    <section className="editor">
      {dialog}
      <aside className="sidebar">
        <div className="row">
          <h1 className="grow">{presentation.name}</h1>
        </div>
        {presentation.eventDate && (
          <p className="muted" data-testid="schedule">
            {formatEventDate(presentation.eventDate)}
          </p>
        )}
        <div className="row">
          <Button onClick={() => setDetails(true)}>{t('presentation.editDetails')}</Button>
          <Button variant="danger" onClick={() => void trash()}>
            {t('presentation.trash')}
          </Button>
        </div>
        {!items.length && (
          <div className="empty">
            <p>
              <strong>{t('presentation.empty')}</strong>
            </p>
            <p className="muted">{t('presentation.emptyText')}</p>
          </div>
        )}
        <ol className="list items" aria-label={t('presentation.items')}>
          {items.map((item, i) => {
            const problem = slides.get(item.id)?.problem;
            return (
              <li key={item.id} className={item.id === selectedId ? 'item selected' : 'item'}>
                <Button
                  className="list-button grow"
                  aria-pressed={item.id === selectedId}
                  onClick={() => {
                    setSelectedId(item.id);
                    setRenaming(false);
                  }}
                >
                  {item.title}
                  {(problem === 'song-trashed' || problem === 'song-missing') && <span className="warning"> ⚠</span>}
                </Button>
                <Button aria-label={`${t('common.moveUp')} ${item.title}`} disabled={i === 0} onClick={() => void db.mutate('moveItem', { itemId: item.id, by: -1 })}>
                  ↑
                </Button>
                <Button aria-label={`${t('common.moveDown')} ${item.title}`} disabled={i === items.length - 1} onClick={() => void db.mutate('moveItem', { itemId: item.id, by: 1 })}>
                  ↓
                </Button>
                <Button variant="danger" aria-label={`${t('presentation.remove')} ${item.title}`} onClick={() => void removeItem(item)}>
                  ×
                </Button>
              </li>
            );
          })}
        </ol>
        <Button variant="primary" onClick={() => setAdding(true)}>
          {t('presentation.add')}
        </Button>
      </aside>
      <div className="editor-main">
        <div className="row">
          {selected ? <ItemTitle key={selected.id} item={selected} editing={renaming} setEditing={setRenaming} /> : <span className="grow" />}
          <a className="btn btn-primary" href={href({ page: 'live', id })}>
            {t('presentation.start')}
          </a>
        </div>
        {!selected && !!items.length && <p className="muted">{t('presentation.selectItem')}</p>}
        {selected && selectedSlides?.problem === 'song-trashed' && (
          <p className="warning row">
            {t('presentation.songTrashed')}
            <Button
              onClick={async () => {
                await db.mutate('restoreSong', { id: selected.sourceId });
                toast(t('presentation.songRestored', { name: selectedSong?.name ?? selected.title }));
              }}
            >
              {t('common.restore')}
            </Button>
          </p>
        )}
        {selected && selectedSlides?.problem === 'song-missing' && <p className="warning">{t('presentation.songMissing')}</p>}
        {selected && selectedSong?.deletedAt === null && (
          <ArrangementPills
            arrangements={selectedArrangements}
            chosen={selected.arrangementId ?? selectedArrangements[0]?.id ?? null}
            onChoose={(arrangementId) => void db.mutate('setItemArrangement', { itemId: selected.id, arrangementId })}
          />
        )}
        {selected && selectedSlides && <SlideGrid label={selected.title} slides={selectedSlides.slides} />}
      </div>
      {adding && <AddSongDialog presentationId={id} afterItemId={selectedId} onAdded={setSelectedId} onClose={() => setAdding(false)} />}
      {details && <DetailsDialog id={id} name={presentation.name} eventDate={presentation.eventDate} onClose={() => setDetails(false)} />}
    </section>
  );
}
