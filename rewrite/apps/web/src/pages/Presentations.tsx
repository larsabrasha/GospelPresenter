import { useState, type FormEvent } from 'react';
import { useData, useDb } from '../db/react.tsx';
import { listPresentations } from '../db/queries.ts';
import { t } from '../i18n.ts';
import { newId } from '../ids.ts';
import { Button } from '../ui/Button.tsx';
import { href, navigate } from '../ui/router.ts';

export function Presentations() {
  const db = useDb();
  const presentations = useData(listPresentations, []);
  const [name, setName] = useState('');
  const [date, setDate] = useState('');

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const id = newId();
    await db.mutate('createPresentation', { id, name, eventDate: date || null });
    setName('');
    navigate({ page: 'presentation', id });
  };

  return (
    <section>
      <h1>{t('nav.presentations')}</h1>
      <form className="row" onSubmit={create}>
        <input aria-label={t('presentations.namePrompt')} placeholder={t('presentations.namePrompt')} value={name} onChange={(e) => setName(e.target.value)} />
        <input aria-label={t('presentation.date')} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <Button variant="primary" type="submit">
          {t('presentations.new')}
        </Button>
      </form>
      {presentations && !presentations.length && <p className="muted">{t('presentations.empty')}</p>}
      <ul className="list">
        {presentations?.map((p) => (
          <li key={p.id}>
            <a href={href({ page: 'presentation', id: p.id })}>{p.name}</a>
            {p.eventDate && <span className="muted"> · {p.eventDate}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
