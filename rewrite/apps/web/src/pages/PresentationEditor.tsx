import { useState } from 'react';
import { useData, useDb } from '../db/react.tsx';
import { getPresentation, itemsOf, listSongs } from '../db/queries.ts';
import { t } from '../i18n.ts';
import { newId } from '../ids.ts';
import { Button } from '../ui/Button.tsx';
import { href } from '../ui/router.ts';

/**
 * The song picker. It never closes by itself after an add (D15): the user adds
 * as many songs as they like and closes it.
 */
function AddSong({ presentationId, onClose }: { presentationId: string; onClose: () => void }) {
  const db = useDb();
  const songs = useData(listSongs, []);
  const [search, setSearch] = useState('');
  const [added, setAdded] = useState<string[]>([]);
  const q = search.trim().toLocaleLowerCase('sv');
  return (
    <div className="panel" role="dialog" aria-label={t('presentation.addSong')}>
      <div className="row">
        <input type="search" aria-label={t('songs.search')} placeholder={t('songs.search')} value={search} onChange={(e) => setSearch(e.target.value)} />
        <Button onClick={onClose}>{t('presentation.close')}</Button>
      </div>
      <ul className="list">
        {songs
          ?.filter((s) => !q || s.name.toLocaleLowerCase('sv').includes(q))
          .map((s) => (
            <li key={s.id} className="row">
              <span className="grow">{s.name}</span>
              {added.includes(s.id) && <span className="muted">{t('presentation.added')}</span>}
              <Button
                onClick={async () => {
                  await db.mutate('addSongToPresentation', { itemId: newId(), presentationId, songId: s.id });
                  setAdded((a) => [...a, s.id]);
                }}
              >
                {t('presentation.add')}
              </Button>
            </li>
          ))}
      </ul>
    </div>
  );
}

export function PresentationEditor({ id }: { id: string }) {
  const db = useDb();
  const data = useData(async (d) => ({ presentation: await getPresentation(d, id), items: await itemsOf(d, id) }), [id]);
  const [adding, setAdding] = useState(false);
  if (!data) return null;
  const { presentation, items } = data;
  if (!presentation || presentation.deletedAt !== null) return <p>{t('presentation.notFound')}</p>;

  const move = (from: number, to: number) => {
    const order = items.map((i) => i.id);
    const [moved] = order.splice(from, 1);
    order.splice(to, 0, moved!);
    void db.mutate('reorderItems', { presentationId: id, itemIds: order });
  };

  return (
    <section>
      <div className="row">
        <input
          key={presentation.name}
          className="title-input"
          aria-label={t('presentation.name')}
          defaultValue={presentation.name}
          onBlur={(e) => {
            const v = e.currentTarget.value;
            if (v.trim() && v !== presentation.name) void db.mutate('renamePresentation', { id, name: v });
          }}
        />
        {presentation.eventDate && <span className="muted">{presentation.eventDate}</span>}
        <a className="btn btn-primary" href={href({ page: 'live', id })}>
          {t('presentation.start')}
        </a>
      </div>
      <h2>{t('presentation.items')}</h2>
      {!items.length && <p className="muted">{t('presentation.empty')}</p>}
      <ol className="list">
        {items.map((item, i) => (
          <li key={item.id} className="row">
            <span className="grow">{item.title}</span>
            <Button disabled={i === 0} onClick={() => move(i, i - 1)}>
              {t('song.moveUp')}
            </Button>
            <Button disabled={i === items.length - 1} onClick={() => move(i, i + 1)}>
              {t('song.moveDown')}
            </Button>
            <Button variant="danger" onClick={() => void db.mutate('removeItem', { itemId: item.id })}>
              {t('presentation.remove')}
            </Button>
          </li>
        ))}
      </ol>
      {adding ? (
        <AddSong presentationId={id} onClose={() => setAdding(false)} />
      ) : (
        <Button variant="primary" onClick={() => setAdding(true)}>
          {t('presentation.addSong')}
        </Button>
      )}
    </section>
  );
}
