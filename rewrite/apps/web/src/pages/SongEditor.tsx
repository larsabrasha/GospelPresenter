import { DEFAULT_LABELS, labelId, LIMITS, parsePartIds, type Label, type SongArrangement, type SongPart } from '@gp/core';
import type { ReactNode, SelectHTMLAttributes } from 'react';
import { useData, useDb } from '../db/react.tsx';
import { arrangementsOf, getSong, listLabels, presentationsUsing, songPartsOf } from '../db/queries.ts';
import { t } from '../i18n.ts';
import { newId } from '../ids.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { useConfirm } from '../ui/Dialog.tsx';
import { FloatingInput, FloatingTextarea } from '../ui/Floating.tsx';
import { ChevronDownIcon, ChevronUpIcon, CloseIcon, PlusIcon, TrashIcon } from '../ui/icons.tsx';
import { DetailHeader, PageContainer } from '../ui/PageContainer.tsx';
import { useToast } from '../ui/Toast.tsx';
import { href, navigate } from '../ui/router.ts';

// The song editor's look is Components/SongEditor.razor and the parts it is made of:
// SongFieldsEditor, SongPartsEditor and SongArrangementEditor.

/** The light card each block sits in. */
const CARD = 'bg-neutral-50 dark:bg-neutral-800 dark:text-neutral-100 rounded-xl shadow-sm border-t-[0.5px] border-white dark:border-neutral-700';

/** A label's coloured pill; grey when the part has none. */
const PILL = 'rounded-full px-2.5 py-0.5 text-xs font-semibold text-white whitespace-nowrap';

/**
 * A text field that saves when it loses focus, and only if it changed. It is
 * keyed by the stored value, so a change that arrives by sync shows up.
 */
function SaveOnBlur({
  label,
  value,
  onSave,
  multiline,
  className,
}: {
  label: string;
  value: string;
  onSave: (v: string) => void;
  multiline?: boolean;
  className?: string;
}) {
  const onBlur = (e: { currentTarget: { value: string } }) => {
    if (e.currentTarget.value !== value) onSave(e.currentTarget.value);
  };
  // A part's text has no visible label, as in the current app; its name is for screen readers and tests.
  return multiline ? (
    <FloatingTextarea key={value} label="" aria-label={label} rows={8} defaultValue={value} onBlur={onBlur} className={className} />
  ) : (
    <FloatingInput key={value} label={label} defaultValue={value} onBlur={onBlur} className={className} />
  );
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
    <span className={`${PILL} ${label ? '' : 'bg-neutral-400'}`} style={label ? { background: label.color } : undefined}>
      {partName(part, labels)}
    </span>
  );
}

/**
 * A native select drawn as the current app's dropdown trigger: what shows is
 * `face`, and the select lies invisibly over it, so a click, the keyboard and
 * screen readers still get the select. The face can follow its focus with
 * `group-has-[select:focus-visible]:`.
 */
function SelectOver({ face, className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { face: ReactNode }) {
  return (
    <div className={`group relative ${className ?? ''}`}>
      {face}
      <select {...rest} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer">
        {children}
      </select>
    </div>
  );
}

/** A small icon button on an arrangement chip. */
const CHIP_BUTTON = 'p-0.5 text-neutral-300 dark:text-neutral-500 cursor-pointer shrink-0 disabled:opacity-40 disabled:cursor-default';

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
    <li className="bg-neutral-50 dark:bg-neutral-800 rounded-xl shadow-sm border-t-[0.5px] border-white dark:border-neutral-700 p-4 space-y-3" role="group" aria-label={title}>
      {dialog}
      {named && (
        <div className="flex gap-4">
          <SaveOnBlur
            label={t('song.name')}
            value={arrangement.name ?? ''}
            onSave={(name) => void db.mutate('updateArrangement', { id: arrangement.id, name })}
            className="flex-1"
          />
          <div className="flex-1" />
        </div>
      )}
      <ol className="flex flex-col gap-1 max-w-[50%]" aria-label={t('song.arrangementParts')}>
        {ids.map((id, i) => {
          const part = byId.get(id);
          if (!part) return null;
          const name = partName(part, labels);
          // Moved with ↑ and ↓ rather than dragged, so the chip has no drag handle.
          return (
            <li
              key={`${id}-${i}`}
              className="flex items-center gap-1.5 bg-white dark:bg-neutral-700 rounded-lg shadow-sm border-t-[0.5px] border-white dark:border-neutral-700 px-2 py-1.5"
            >
              <PartPill part={part} labels={labels} />
              <span className="flex-1" />
              <AppButton
                variant="plain"
                className={`${CHIP_BUTTON} hover:text-neutral-600 dark:hover:text-neutral-200`}
                aria-label={`${t('common.moveUp')} ${name}`}
                title={t('common.moveUp')}
                disabled={i === visible[0]}
                onClick={() => void db.mutate('moveArrangementPart', { id: arrangement.id, index: i, partId: id, by: -1 })}
              >
                <ChevronUpIcon className="size-3.5" />
              </AppButton>
              <AppButton
                variant="plain"
                className={`${CHIP_BUTTON} hover:text-neutral-600 dark:hover:text-neutral-200`}
                aria-label={`${t('common.moveDown')} ${name}`}
                title={t('common.moveDown')}
                disabled={i === visible.at(-1)}
                onClick={() => void db.mutate('moveArrangementPart', { id: arrangement.id, index: i, partId: id, by: 1 })}
              >
                <ChevronDownIcon className="size-3.5" />
              </AppButton>
              <AppButton
                variant="plain"
                className={`${CHIP_BUTTON} hover:text-red-500 dark:hover:text-red-400`}
                aria-label={t('song.removeChip', { part: name })}
                onClick={() => void db.mutate('removeArrangementPart', { id: arrangement.id, index: i, partId: id })}
              >
                <CloseIcon className="size-3.5" />
              </AppButton>
            </li>
          );
        })}
      </ol>
      <div className="flex items-center justify-between">
        <SelectOver
          aria-label={t('song.addPart')}
          value=""
          onChange={(e) => {
            if (e.target.value) void db.mutate('appendArrangementPart', { id: arrangement.id, partId: e.target.value });
          }}
          face={
            <span className="flex items-center gap-1.5 text-xs text-neutral-400 group-hover:text-neutral-600 dark:group-hover:text-neutral-200 transition-colors group-has-[select:focus-visible]:text-neutral-600 dark:group-has-[select:focus-visible]:text-neutral-200">
              <span className="flex items-center justify-center size-6 rounded-lg border border-dashed border-neutral-300 dark:border-neutral-500">
                <PlusIcon className="size-3.5" />
              </span>
              {t('song.addPart')}
            </span>
          }
        >
          <option value="">{t('song.addPart')}</option>
          {parts.map((p, i) => (
            <option key={p.id} value={p.id}>
              {i + 1}. {partName(p, labels)}
            </option>
          ))}
        </SelectOver>
        <AppButton
          variant="dangerIcon"
          className="p-1.5"
          aria-label={t('song.removeArrangement')}
          title={t('song.removeArrangement')}
          onClick={async () => {
            const ok = await ask({ title: t('song.removeArrangement'), text: t('song.removeArrangementConfirm'), confirm: t('common.delete') });
            if (ok) void db.mutate('removeArrangement', { id: arrangement.id });
          }}
        >
          <TrashIcon className="size-4" />
        </AppButton>
      </div>
    </li>
  );
}

/** The song editor (spec 02, `/admin/songs/{id}`; Pages/Admin/SongDetail.razor). */
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
  if (!song || song.deletedAt !== null)
    return (
      <PageContainer>
        <p className="px-5 text-neutral-500 dark:text-neutral-400">{t('song.notFound')}</p>
      </PageContainer>
    );

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

  const partRow = (p: SongPart, i: number) => {
    const label = p.labelId ? labelChoices.find((l) => l.id === p.labelId) : undefined;
    return (
      <li key={p.id} className={`${CARD} p-4 space-y-3`}>
        <div className="flex items-center gap-2">
          <SelectOver
            aria-label={t('song.parts')}
            value={p.labelId ?? ''}
            onChange={(e) => void db.mutate('updateSongPart', { id: p.id, labelText: labelChoices.find((l) => l.id === e.target.value)?.text ?? null })}
            className="flex-1 max-w-[50%]"
            face={
              <span className="w-full flex items-center gap-2 rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-700 text-neutral-900 dark:text-neutral-100 px-3 py-2.5 text-sm text-left group-has-[select:focus-visible]:ring-2 group-has-[select:focus-visible]:ring-sky-500 group-has-[select:focus-visible]:border-sky-500">
                {label ? (
                  <>
                    <span className={`${PILL} shrink-0`} style={{ background: label.color }}>
                      {label.text}
                    </span>
                    <span className="flex-1" />
                  </>
                ) : (
                  <span className="flex-1 truncate text-neutral-400">{t('song.noLabel')}</span>
                )}
                <ChevronDownIcon className="size-4 text-neutral-400 shrink-0" />
              </span>
            }
          >
            <option value="">{t('song.noLabel')}</option>
            {labelChoices.map((l) => (
              <option key={l.id} value={l.id}>
                {l.text}
              </option>
            ))}
          </SelectOver>
          <div className="flex-1" />
          <div className="flex items-center gap-1">
            <AppButton
              variant="icon"
              className="p-1.5 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 disabled:cursor-default"
              aria-label={t('common.moveUp')}
              title={t('common.moveUp')}
              disabled={i === 0}
              onClick={() => void db.mutate('moveSongPart', { id: p.id, toIndex: i - 1 })}
            >
              <ChevronUpIcon className="size-4" />
            </AppButton>
            <AppButton
              variant="icon"
              className="p-1.5 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 disabled:cursor-default"
              aria-label={t('common.moveDown')}
              title={t('common.moveDown')}
              disabled={i === parts.length - 1}
              onClick={() => void db.mutate('moveSongPart', { id: p.id, toIndex: i + 1 })}
            >
              <ChevronDownIcon className="size-4" />
            </AppButton>
          </div>
        </div>
        <SaveOnBlur label={`${t('song.parts')} ${i + 1}`} value={p.content} multiline onSave={(content) => void db.mutate('updateSongPart', { id: p.id, content })} />
        <div className="flex justify-end">
          <AppButton variant="dangerIcon" className="p-1.5" aria-label={t('song.removePart')} title={t('song.removePart')} onClick={() => void removePart(p)}>
            <TrashIcon className="size-4" />
          </AppButton>
        </div>
      </li>
    );
  };

  return (
    <PageContainer className="pb-8">
      {dialog}
      <DetailHeader backHref={href({ page: 'songs' })} title={song.name} className="px-5" />
      <div className="space-y-4">
        <div className={`${CARD} p-5 space-y-4`}>
          <SaveOnBlur label={t('song.name')} value={song.name} onSave={(v) => v.trim() && update({ name: v })} />
          <div className="flex gap-4">
            <SaveOnBlur label={t('song.author')} value={song.author ?? ''} onSave={(v) => update({ author: v })} className="flex-1" />
            <SaveOnBlur label={t('song.publisher')} value={song.publisher ?? ''} onSave={(v) => update({ publisher: v })} className="flex-1" />
          </div>
          <div className="flex gap-4">
            <SaveOnBlur
              label={t('song.year')}
              value={song.year === null ? '' : String(song.year)}
              onSave={(v) => {
                const year = v.trim() === '' ? null : Number(v);
                if (year === null || (Number.isInteger(year) && year >= 0 && year <= 9999)) update({ year });
              }}
              className="flex-1"
            />
            <SaveOnBlur label={t('song.ccli')} value={song.ccli ?? ''} onSave={(v) => update({ ccli: v })} className="flex-1" />
          </div>
        </div>
        {/* The current app has no heading over the parts; this one stays until that is decided. */}
        <h2 className="text-lg font-bold text-neutral-800 dark:text-neutral-100 pt-4">{t('song.parts')}</h2>
        <ol className="space-y-4">{parts.map(partRow)}</ol>
        <AppButton
          variant="secondary"
          className="flex items-center gap-1.5 self-start"
          disabled={parts.length >= LIMITS.partsPerSong}
          onClick={() => void db.mutate('addSongPart', { id: newId(), songId: id, labelText: null, content: '' })}
        >
          <PlusIcon className="size-4" />
          {t('song.addPart')}
        </AppButton>
        <div className="pt-4">
          <h2 className="text-lg font-bold text-neutral-800 dark:text-neutral-100 pb-3">{t('song.arrangements')}</h2>
          <div className="space-y-4">
            {arrangements.length > 0 && (
              <ol className="space-y-4">
                {arrangements.map((a, i) => (
                  <ArrangementCard key={a.id} arrangement={a} index={i} named={arrangements.length >= 2} parts={parts} labels={labels} />
                ))}
              </ol>
            )}
            {arrangements.length < LIMITS.arrangementsPerSong && (
              <AppButton
                variant="secondary"
                className="flex items-center gap-1.5 self-start"
                onClick={() => void db.mutate('createArrangement', { id: newId(), songId: id, partIds: parts.map((p) => p.id) })}
              >
                <PlusIcon className="size-4" />
                {t('song.createArrangement')}
              </AppButton>
            )}
          </div>
        </div>
        {/* The current app has Historik at the left; the history is not built yet. */}
        <div className="flex items-center justify-between">
          <div />
          <AppButton variant="danger" onClick={() => void trash()}>
            {t('song.trash')}
          </AppButton>
        </div>
      </div>
    </PageContainer>
  );
}
