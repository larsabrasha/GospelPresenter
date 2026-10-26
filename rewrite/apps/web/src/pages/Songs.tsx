import { useState, type FormEvent } from 'react';
import { useData, useDb } from '../db/react.tsx';
import { listSongs } from '../db/queries.ts';
import { t } from '../i18n.ts';
import { newId } from '../ids.ts';
import { Button } from '../ui/Button.tsx';
import { href, navigate } from '../ui/router.ts';

export function Songs() {
  const db = useDb();
  const songs = useData(listSongs, []);
  const [search, setSearch] = useState('');
  const [name, setName] = useState('');

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const id = newId();
    await db.mutate('createSong', { id, name });
    setName('');
    navigate({ page: 'song', id });
  };

  const q = search.trim().toLocaleLowerCase('sv');
  const shown = songs?.filter((s) => !q || s.name.toLocaleLowerCase('sv').includes(q) || s.author?.toLocaleLowerCase('sv').includes(q));

  return (
    <section>
      <h1>{t('nav.songs')}</h1>
      <form className="row" onSubmit={create}>
        <input aria-label={t('songs.namePrompt')} placeholder={t('songs.namePrompt')} value={name} onChange={(e) => setName(e.target.value)} />
        <Button variant="primary" type="submit">
          {t('songs.new')}
        </Button>
      </form>
      <input className="search" type="search" aria-label={t('songs.search')} placeholder={t('songs.search')} value={search} onChange={(e) => setSearch(e.target.value)} />
      {shown && !shown.length && <p className="muted">{t('songs.empty')}</p>}
      <ul className="list">
        {shown?.map((s) => (
          <li key={s.id}>
            <a href={href({ page: 'song', id: s.id })}>{s.name}</a>
            {s.author && <span className="muted"> · {s.author}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
