import { DEFAULT_LABELS, labelId, LIMITS, parsePartIds, type Label, type SongArrangement, type SongPart } from '@gp/core';
import { useData, useDb } from '../db/react.tsx';
import { arrangementsOf, getSong, listLabels, presentationsUsing, songPartsOf } from '../db/queries.ts';
import { t } from '../i18n.ts';
import { newId } from '../ids.ts';
import { Button } from '../ui/Button.tsx';
import { useConfirm } from '../ui/Dialog.tsx';
import { useToast } from '../ui/Toast.tsx';
import { href, navigate } from '../ui/router.ts';

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

/** How a part is named in arrangement chips: its label, else the start of its first line (spec 02). */
function partName(p: SongPart, labels: Map<string, Label>): string {
  const label = p.labelId ? labels.get(p.labelId) : undefined;
  if (label) return label.text;
  const line = p.content.split('\n')[0]!.trim();
  return line.length > 20 ? `${line.slice(0, 20)}...` : line || '...';
}

function PartPill({ part, labels }: { part: SongPart; labels: Map<string, Label> }) {
  const label = part.labelId ? labels.get(part.labelId) : undefined;
  return (
    <span className="pill" style={{ background: label?.color ?? '#6b7280' }}>
      {partName(part, labels)}
    </span>
  );
}

/** One arrangement: a list of part chips to reorder, remove and append to (spec 02 "Arrangemang"). */
function ArrangementCard({
  arrangement,
  index,
  named,
  parts,
  labels,
}: {
  arrangement: SongArrangement;
  index: number;
  named: boolean;
  parts: SongPart[];
  labels: Map<string, Label>;
}) {
  const db = useDb();
  const { dialog, ask } = useConfirm();
  const byId = new Map(parts.map((p) => [p.id, p]));
  // Ids of deleted parts are not shown (SONG-R18). Chip edits name the index in
  // the stored list, so they are counted with those ids in.
  const ids = parsePartIds(arrangement.partIds);
  const visible = ids.flatMap((id, i) => (byId.has(id) ? [i] : []));
  const title = arrangement.name ?? `${t('song.arrangement')} ${index + 1}`;

  return (
    <li className="card" role="group" aria-label={title}>
      {dialog}
      <div className="row">
        {named ? (
          <label className="field grow">
            {t('song.name')}
            <SaveOnBlur label={t('song.name')} value={arrangement.name ?? ''} onSave={(name) => void db.mutate('updateArrangement', { id: arrangement.id, name })} />
          </label>
        ) : (
          <span className="grow" />
        )}
        <Button
          variant="danger"
          aria-label={t('song.removeArrangement')}
          onClick={async () => {
            const ok = await ask({ title: t('song.removeArrangement'), text: t('song.removeArrangementConfirm'), confirm: t('common.delete') });
            if (ok) void db.mutate('removeArrangement', { id: arrangement.id });
          }}
        >
          🗑
        </Button>
      </div>
      <ol className="chips" aria-label={t('song.arrangementParts')}>
        {ids.map((id, i) => {
          const part = byId.get(id);
          if (!part) return null;
          const name = partName(part, labels);
          return (
            <li key={`${id}-${i}`} className="chip">
              <PartPill part={part} labels={labels} />
              <Button
                aria-label={`${t('common.moveUp')} ${name}`}
                disabled={i === visible[0]}
                onClick={() => void db.mutate('moveArrangementPart', { id: arrangement.id, index: i, partId: id, by: -1 })}
              >
                ↑
              </Button>
              <Button
                aria-label={`${t('common.moveDown')} ${name}`}
                disabled={i === visible.at(-1)}
                onClick={() => void db.mutate('moveArrangementPart', { id: arrangement.id, index: i, partId: id, by: 1 })}
              >
                ↓
              </Button>
              <Button
                aria-label={t('song.removeChip', { part: name })}
                onClick={() => void db.mutate('removeArrangementPart', { id: arrangement.id, index: i, partId: id })}
              >
                ×
              </Button>
            </li>
          );
        })}
      </ol>
      <select
        aria-label={t('song.addPart')}
        value=""
        onChange={(e) => {
          if (e.target.value) void db.mutate('appendArrangementPart', { id: arrangement.id, partId: e.target.value });
        }}
      >
        <option value="">{t('song.addPart')}</option>
        {parts.map((p, i) => (
          <option key={p.id} value={p.id}>
            {i + 1}. {partName(p, labels)}
          </option>
        ))}
      </select>
    </li>
  );
}

/** The song editor (spec 02, `/admin/songs/{id}`). */
export function SongEditor({ id }: { id: string }) {
  const db = useDb();
  const toast = useToast();
  const { dialog, ask } = useConfirm();
  const data = useData(
    async (d) => ({
      song: await getSong(d, id),
      parts: await songPartsOf(d, [id]),
      arrangements: await arrangementsOf(d, [id]),
      labels: await listLabels(d),
    }),
    [id],
  );
  if (!data) return null;
  const { song, parts, arrangements, labels } = data;
  if (!song || song.deletedAt !== null) return <p>{t('song.notFound')}</p>;

  const update = (fields: Record<string, string | number | null>) => void db.mutate('updateSong', { id, ...fields });
  const labelChoices: Label[] = [
    ...DEFAULT_LABELS.map((l) => ({ id: labelId(l.text), ...l })).filter((l) => !labels.has(l.id)),
    ...labels.values(),
  ].toSorted((a, b) => a.sort - b.sort || a.text.localeCompare(b.text, 'sv'));

  const removePart = async (p: SongPart) => {
    const label = p.labelId ? (labels.get(p.labelId)?.text ?? t('song.noLabel')) : t('song.noLabel');
    const ok = await ask({ title: t('song.removePart'), text: t('song.removePartConfirm', { label }), confirm: t('common.delete') });
    if (ok) void db.mutate('removeSongPart', { id: p.id });
  };

  const trash = async () => {
    // D17: say where the song is used before it goes.
    const using = await presentationsUsing(db, id);
    const text = [t('song.trashConfirm', { name: song.name }), using.length ? t('song.usedIn', { names: using.map((p) => p.name).join(', ') }) : '']
      .filter(Boolean)
      .join(' ');
    if (!(await ask({ title: t('song.trash'), text, confirm: t('song.trash') }))) return;
    await db.mutate('trashSong', { id, at: Date.now() });
    toast(t('song.trashed', { name: song.name }));
    navigate({ page: 'songs' });
  };

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
          {t('common.moveUp')}
        </Button>
        <Button disabled={i === parts.length - 1} onClick={() => void db.mutate('moveSongPart', { id: p.id, toIndex: i + 1 })}>
          {t('common.moveDown')}
        </Button>
        <Button variant="danger" onClick={() => void removePart(p)}>
          {t('song.removePart')}
        </Button>
      </div>
      <SaveOnBlur label={`${t('song.parts')} ${i + 1}`} value={p.content} multiline onSave={(content) => void db.mutate('updateSongPart', { id: p.id, content })} />
    </li>
  );

  return (
    <section>
      {dialog}
      <div className="row">
        <a href={href({ page: 'songs' })} aria-label={t('common.back')}>
          ←
        </a>
        <h1 className="grow">{song.name}</h1>
      </div>
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
        <Button
          variant="primary"
          disabled={parts.length >= LIMITS.partsPerSong}
          onClick={() => void db.mutate('addSongPart', { id: newId(), songId: id, labelText: null, content: '' })}
        >
          {t('song.addPart')}
        </Button>
      </div>
      <h2>{t('song.arrangements')}</h2>
      <ol className="arrangements">
        {arrangements.map((a, i) => (
          <ArrangementCard key={a.id} arrangement={a} index={i} named={arrangements.length >= 2} parts={parts} labels={labels} />
        ))}
      </ol>
      {arrangements.length < LIMITS.arrangementsPerSong && (
        <Button onClick={() => void db.mutate('createArrangement', { id: newId(), songId: id, partIds: parts.map((p) => p.id) })}>
          {t('song.createArrangement')}
        </Button>
      )}
      <div className="row footer">
        <Button variant="danger" onClick={() => void trash()}>
          {t('song.trash')}
        </Button>
      </div>
    </section>
  );
}
