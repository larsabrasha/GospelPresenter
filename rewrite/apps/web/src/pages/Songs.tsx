import { searchSongs } from '@gp/core';
import { useState } from 'react';
import { useData, useDb } from '../db/react.tsx';
import { searchableSongs } from '../db/queries.ts';
import { t } from '../i18n.ts';
import { newId } from '../ids.ts';
import { Button } from '../ui/Button.tsx';
import { Dialog } from '../ui/Dialog.tsx';
import { Highlight } from '../ui/Highlight.tsx';
import { href, navigate } from '../ui/router.ts';

/** "Skapa sång": a name, then the editor (spec 02, SONG-A1, A2). */
export function CreateSongDialog({ initial = '', onClose, onCreated }: { initial?: string; onClose: () => void; onCreated: (id: string) => void }) {
  const db = useDb();
  const [name, setName] = useState(initial);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    const id = newId();
    await db.mutate('createSong', { id, name });
    onCreated(id);
  };
  return (
    <Dialog title={t('songs.createTitle')} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label className="field">
          {t('song.name')}
          <input autoFocus maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="row end">
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" type="submit" disabled={!name.trim() || saving}>
            {t('common.create')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** The song library (spec 02, `/admin/songs`). */
export function Songs() {
  const songs = useData(searchableSongs, []);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const shown = songs && searchSongs(songs, query);

  return (
    <section>
      <div className="row">
        <h1 className="grow">{t('nav.songs')}</h1>
        <Button variant="primary" onClick={() => setCreating(true)}>
          {t('common.create')}
        </Button>
      </div>
      {creating && <CreateSongDialog onClose={() => setCreating(false)} onCreated={(id) => navigate({ page: 'song', id })} />}
      <div className="row">
        <h2 className="grow">{t('songs.all', { n: songs?.length ?? 0 })}</h2>
        <a className="btn" href={href({ page: 'trash', kind: 'Song' })}>
          {t('nav.trash')}
        </a>
      </div>
      {songs && !songs.length && (
        <div className="empty">
          <p>
            <strong>{t('songs.emptyTitle')}</strong>
          </p>
          <p className="muted">{t('songs.emptyText')}</p>
        </div>
      )}
      {!!songs?.length && (
        <div className="row">
          <input
            className="search grow"
            type="search"
            maxLength={100}
            aria-label={t('songs.search')}
            placeholder={t('songs.search')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <Button aria-label={t('common.clear')} onClick={() => setQuery('')}>
              ×
            </Button>
          )}
        </div>
      )}
      {!!songs?.length && shown && !shown.length && <p className="muted">{t('songs.noHits')}</p>}
      <ul className="list" aria-label={t('nav.songs')}>
        {shown?.map((s) => (
          <li key={s.id}>
            <a href={href({ page: 'song', id: s.id })}>
              <strong>
                <Highlight text={s.name} query={query} />
              </strong>
            </a>
            <div className="muted">{s.author ? <Highlight text={s.author} query={query} /> : ' '}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}
