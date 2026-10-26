import { DEFAULT_LABELS, labelId, type Label, type SongPart } from '@gp/core';
import { useData, useDb } from '../db/react.tsx';
import { getSong, listLabels, songPartsOf } from '../db/queries.ts';
import { t } from '../i18n.ts';
import { newId } from '../ids.ts';
import { Button } from '../ui/Button.tsx';
import { navigate } from '../ui/router.ts';

/**
 * A text field that saves when it loses focus, and only if it changed. It is
 * keyed by the stored value, so a change that arrives by sync shows up.
 */
function SaveOnBlur({ label, value, onSave, multiline }: { label: string; value: string; onSave: (v: string) => void; multiline?: boolean }) {
  const props = {
    'aria-label': label,
    defaultValue: value,
    onBlur: (e: { currentTarget: { value: string } }) => {
      if (e.currentTarget.value !== value) onSave(e.currentTarget.value);
    },
  };
  return multiline ? <textarea key={value} rows={Math.max(3, value.split('\n').length + 1)} {...props} /> : <input key={value} {...props} />;
}

export function SongEditor({ id }: { id: string }) {
  const db = useDb();
  const data = useData(async (d) => ({ song: await getSong(d, id), parts: await songPartsOf(d, [id]), labels: await listLabels(d) }), [id]);
  if (!data) return null;
  const { song, parts, labels } = data;
  if (!song || song.deletedAt !== null) return <p>{t('song.notFound')}</p>;

  const update = (fields: Record<string, string | number | null>) => void db.mutate('updateSong', { id, ...fields });
  const labelChoices: Label[] = [
    ...DEFAULT_LABELS.map((l) => ({ id: labelId(l.text), ...l })).filter((l) => !labels.has(l.id)),
    ...labels.values(),
  ].toSorted((a, b) => a.sort - b.sort || a.text.localeCompare(b.text, 'sv'));

  const partRow = (p: SongPart, i: number) => (
    <li key={p.id} className="part">
      <div className="row">
        <select
          aria-label={t('song.parts')}
          value={p.labelId ?? ''}
          onChange={(e) => void db.mutate('updateSongPart', { id: p.id, labelText: labelChoices.find((l) => l.id === e.target.value)?.text ?? null })}
        >
          <option value="">{t('song.noLabel')}</option>
          {labelChoices.map((l) => (
            <option key={l.id} value={l.id}>
              {l.text}
            </option>
          ))}
        </select>
        <Button disabled={i === 0} onClick={() => void db.mutate('moveSongPart', { id: p.id, toIndex: i - 1 })}>
          {t('song.moveUp')}
        </Button>
        <Button disabled={i === parts.length - 1} onClick={() => void db.mutate('moveSongPart', { id: p.id, toIndex: i + 1 })}>
          {t('song.moveDown')}
        </Button>
        <Button variant="danger" onClick={() => void db.mutate('removeSongPart', { id: p.id })}>
          {t('song.removePart')}
        </Button>
      </div>
      <SaveOnBlur label={`${t('song.parts')} ${i + 1}`} value={p.content} multiline onSave={(content) => void db.mutate('updateSongPart', { id: p.id, content })} />
    </li>
  );

  return (
    <section>
      <h1>{song.name}</h1>
      <div className="fields">
        <label>
          {t('song.name')}
          <SaveOnBlur label={t('song.name')} value={song.name} onSave={(v) => v.trim() && update({ name: v })} />
        </label>
        <label>
          {t('song.author')}
          <SaveOnBlur label={t('song.author')} value={song.author ?? ''} onSave={(v) => update({ author: v })} />
        </label>
        <label>
          {t('song.publisher')}
          <SaveOnBlur label={t('song.publisher')} value={song.publisher ?? ''} onSave={(v) => update({ publisher: v })} />
        </label>
        <label>
          {t('song.year')}
          <SaveOnBlur
            label={t('song.year')}
            value={song.year === null ? '' : String(song.year)}
            onSave={(v) => {
              const year = v.trim() === '' ? null : Number(v);
              if (year === null || (Number.isInteger(year) && year >= 0 && year <= 9999)) update({ year });
            }}
          />
        </label>
        <label>
          {t('song.ccli')}
          <SaveOnBlur label={t('song.ccli')} value={song.ccli ?? ''} onSave={(v) => update({ ccli: v })} />
        </label>
      </div>
      <h2>{t('song.parts')}</h2>
      <ol className="parts">{parts.map(partRow)}</ol>
      <div className="row">
        <Button variant="primary" onClick={() => void db.mutate('addSongPart', { id: newId(), songId: id, labelText: null, content: '' })}>
          {t('song.addPart')}
        </Button>
        <Button
          variant="danger"
          onClick={async () => {
            await db.mutate('trashSong', { id, at: Date.now() });
            navigate({ page: 'songs' });
          }}
        >
          {t('song.trash')}
        </Button>
      </div>
    </section>
  );
}
