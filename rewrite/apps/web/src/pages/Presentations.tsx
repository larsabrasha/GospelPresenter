import { useState } from 'react';
import { useData, useDb } from '../db/react.tsx';
import { listPresentations } from '../db/queries.ts';
import { t } from '../i18n.ts';
import { newId } from '../ids.ts';
import { Button } from '../ui/Button.tsx';
import { Dialog } from '../ui/Dialog.tsx';
import { href, navigate } from '../ui/router.ts';
import { formatEventDate } from './PresentationEditor.tsx';

/** "Skapa presentation": name (prefilled) and date; Enter saves (spec 03, PRES-A2). */
function CreatePresentationDialog({ onClose }: { onClose: () => void }) {
  const db = useDb();
  const [name, setName] = useState(t('presentations.defaultName'));
  const [date, setDate] = useState('');
  const [saving, setSaving] = useState(false);
  return (
    <Dialog title={t('presentations.createTitle')} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim() || saving) return;
          setSaving(true);
          const id = newId();
          await db.mutate('createPresentation', { id, name, eventDate: date || null });
          navigate({ page: 'presentation', id });
        }}
      >
        <label className="field">
          {t('presentation.name')}
          <input autoFocus maxLength={200} value={name} onFocus={(e) => e.currentTarget.select()} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          {t('presentation.date')}
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
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

export function Presentations() {
  const presentations = useData(listPresentations, []);
  const [creating, setCreating] = useState(false);

  return (
    <section>
      <div className="row">
        <h1 className="grow">{t('nav.presentations')}</h1>
        <a className="btn" href={href({ page: 'trash', kind: 'Presentation' })}>
          {t('nav.trash')}
        </a>
        <Button variant="primary" onClick={() => setCreating(true)}>
          {t('presentations.create')}
        </Button>
      </div>
      {creating && <CreatePresentationDialog onClose={() => setCreating(false)} />}
      {presentations && !presentations.length && (
        <div className="empty">
          <p>
            <strong>{t('presentations.emptyTitle')}</strong>
          </p>
          <p className="muted">{t('presentations.emptyText')}</p>
        </div>
      )}
      <ul className="list" aria-label={t('nav.presentations')}>
        {presentations?.map((p) => (
          <li key={p.id}>
            <a href={href({ page: 'presentation', id: p.id })}>{p.name}</a>
            {p.eventDate && <span className="muted"> · {formatEventDate(p.eventDate)}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
