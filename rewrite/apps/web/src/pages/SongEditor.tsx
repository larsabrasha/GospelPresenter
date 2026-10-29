import { DEFAULT_LABELS, labelId, LIMITS, parsePartIds, type Label, type SongArrangement, type SongPart } from '@gp/core';
import { useEffect, useEffectEvent, useRef, type ReactNode } from 'react';
import { useData, useDb } from '../db/react.tsx';
import { arrangementsOf, getSong, listLabels, presentationsUsing, songPartsOf } from '../db/queries.ts';
import { t } from '../i18n.ts';
import { newId } from '../ids.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { AutoSaveField, useSaveFailed, useSavedIndicator } from '../ui/AutoSave.tsx';
import { afterWrite } from '../ui/debounce.ts';
import { deleteAsk, useConfirm } from '../ui/Dialog.tsx';
import { ChevronDownIcon, ChevronUpIcon, CloseIcon, GripIcon, PlusIcon, TrashIcon } from '../ui/icons.tsx';
import { DetailHeader, PageContainer } from '../ui/PageContainer.tsx';
import { SelectMenu } from '../ui/SelectMenu.tsx';
import { useSortable } from '../ui/sortable.ts';
import { useToast } from '../ui/Toast.tsx';
import { href, navigate } from '../ui/router.ts';

// The song editor's look is Components/SongEditor.razor and the parts it is made of:
// SongFieldsEditor, SongPartsEditor and SongArrangementEditor.

/** The light card each block sits in. */
const CARD = 'bg-neutral-50 dark:bg-neutral-800 dark:text-neutral-100 rounded-xl shadow-sm border-t-[0.5px] border-white dark:border-neutral-700';

/** A label's coloured pill; grey when the part has none. */
const PILL = 'rounded-full px-2.5 py-0.5 text-xs font-semibold text-white whitespace-nowrap';

/** How a part is named in arrangement chips: its label, else the start of its first line (spec 02). */
function partName(p: SongPart, labels: Map<string, Label>): string {
  const label = p.labelId ? labels.get(p.labelId) : undefined;
  if (label) return label.text;
  const line = p.content.split('\n')[0]!.trim();
  return line.length > 20 ? `${line.slice(0, 20)}...` : line;
}

function PartPill({ part, labels }: { part: SongPart; labels: Map<string, Label> }) {
  const label = part.labelId ? labels.get(part.labelId) : undefined;
  return (
    <span className={`${PILL} ${label ? '' : 'bg-neutral-400'}`} style={label ? { background: label.color } : undefined}>
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
  saving,
  showSaved,
}: {
  arrangement: SongArrangement;
  index: number;
  named: boolean;
  parts: SongPart[];
  labels: Map<string, Label>;
  /** Shows "Sparad" once the write is done, as every change to an arrangement does in the current app. */
  saving: (write: Promise<void>) => void;
  showSaved: () => void;
}) {
  const db = useDb();
  const { dialog, ask } = useConfirm();
  const byId = new Map(parts.map((p) => [p.id, p]));
  // Ids of deleted parts are not shown (SONG-R18). Chip edits name the index in
  // the stored list, so they are counted with those ids in.
  const ids = parsePartIds(arrangement.partIds);
  const visible = ids.flatMap((id, i) => (byId.has(id) ? [i] : []));
  const title = arrangement.name ?? `${t('song.arrangement')} ${index + 1}`;
  // The chip moved from the keyboard, by its place in the stored list, to focus again once it is there.
  const refocus = useRef<{ partId: string; index: number } | null>(null);

  /** Moves the chip shown `from`th to be shown `to`th; hidden ids keep their places. */
  const move = (from: number, to: number) => {
    const at = visible[from];
    const target = visible[to];
    if (at === undefined || target === undefined || at === target) return;
    const partId = ids[at]!;
    saving(db.mutate('moveArrangementPart', { id: arrangement.id, index: at, partId, by: target - at }));
    return { partId, index: target };
  };
  const { listRef, list, rowStyle, handle, dragging } = useSortable<HTMLOListElement>((from, to) => void move(from, to));

  useEffect(() => {
    const want = refocus.current;
    if (!want || ids[want.index] !== want.partId) return;
    refocus.current = null;
    list.current?.querySelector<HTMLElement>(`[data-index="${want.index}"]`)?.focus();
  });

  return (
    <li className="bg-neutral-50 dark:bg-neutral-800 rounded-xl shadow-sm border-t-[0.5px] border-white dark:border-neutral-700 p-4 space-y-3" role="group" aria-label={title}>
      {dialog}
      {named && (
        <div className="flex gap-4">
          <AutoSaveField
            label={t('song.name')}
            maxLength={100}
            value={arrangement.name ?? ''}
            onSave={(name) => db.mutate('updateArrangement', { id: arrangement.id, name })}
            onSaved={showSaved}
            className="flex-1"
          />
          <div className="flex-1" />
        </div>
      )}
      <ol
        ref={listRef}
        className="flex flex-col gap-1 max-w-[50%]"
        aria-label={t('song.arrangementParts')}
      >
        {visible.map((i, v) => {
          const id = ids[i]!;
          const part = byId.get(id)!;
          // The whole chip is the drag handle, as in the current app; with focus on it, Alt+↑/↓ moves it.
          return (
            <li
              key={`${id}-${i}`}
              data-sort-row
              data-index={i}
              tabIndex={0}
              aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
              style={rowStyle(v)}
              {...handle(v)}
              onKeyDown={(e) => {
                if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
                e.preventDefault();
                refocus.current = move(v, e.key === 'ArrowUp' ? v - 1 : v + 1) ?? null;
              }}
              className={`flex items-center gap-1.5 bg-white dark:bg-neutral-700 rounded-lg shadow-sm border-t-[0.5px] border-white dark:border-neutral-700 px-2 py-1.5 cursor-grab active:cursor-grabbing select-none [-webkit-touch-callout:none] focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
                dragging === v ? 'shadow-lg' : ''
              }`}
            >
              <GripIcon className="size-4 text-neutral-300 dark:text-neutral-500 shrink-0" />
              <PartPill part={part} labels={labels} />
              <span className="flex-1" />
              <AppButton
                variant="plain"
                className="p-0.5 text-neutral-300 hover:text-red-500 dark:text-neutral-500 dark:hover:text-red-400 cursor-pointer shrink-0"
                aria-label={t('song.removeChip', { part: partName(part, labels) })}
                onClick={() => saving(db.mutate('removeArrangementPart', { id: arrangement.id, index: i, partId: id }))}
              >
                <CloseIcon className="size-3.5" />
              </AppButton>
            </li>
          );
        })}
      </ol>
      <div className="flex items-center justify-between">
        {/* A list of actions: picking a part appends it, so nothing stays chosen. */}
        <SelectMenu
          label={t('song.addPart')}
          choices={parts.map((p, i) => ({ value: p.id, label: `${i + 1}. ${partName(p, labels)}`, content: <PartPill part={p} labels={labels} /> }))}
          onChoose={(partId) => saving(db.mutate('appendArrangementPart', { id: arrangement.id, partId }))}
          buttonClassName="flex items-center gap-1.5 text-xs text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 cursor-pointer transition-colors rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
          listClassName="left-0 w-48 max-h-60 overflow-y-auto"
          face={
            <>
              <span className="flex items-center justify-center size-6 rounded-lg border border-dashed border-neutral-300 dark:border-neutral-500">
                <PlusIcon className="size-3.5" />
              </span>
              {t('song.addPart')}
            </>
          }
        />
        <AppButton
          variant="dangerIcon"
          className="p-1.5"
          aria-label={t('song.removeArrangement')}
          title={t('song.removeArrangement')}
          onClick={async () => {
            await ask(deleteAsk(t('song.removeArrangementConfirm'), undefined, async () => saving(db.mutate('removeArrangement', { id: arrangement.id }))));
          }}
        >
          <TrashIcon className="size-4" />
        </AppButton>
      </div>
    </li>
  );
}

/**
 * The song editor (spec 02, `/admin/songs/{id}`; Pages/Admin/SongDetail.razor). With `onBack`,
 * inside the add dialog (EditSong.razor): its back button returns to the song list there, and
 * so does moving the song to the trash.
 */
export function SongEditor({ id, onBack }: { id: string; onBack?: () => void }) {
  const db = useDb();
  const toast = useToast();
  const { dialog, ask } = useConfirm();
  const saved = useSavedIndicator();
  const saveFailed = useSaveFailed();
  const data = useData(
    async (d) => ({
      song: await getSong(d, id),
      parts: await songPartsOf(d, [id]),
      arrangements: await arrangementsOf(d, [id]),
      labels: await listLabels(d),
    }),
    [id],
  );
  // "Lägg till del" brings the new part into view once it is there (SongEditor.razor's scrollToElement).
  const scrollTo = useRef<string | null>(null);
  useEffect(() => {
    if (!scrollTo.current) return;
    const target = document.querySelector(`[data-part-id="${CSS.escape(scrollTo.current)}"]`);
    if (!target) return;
    scrollTo.current = null;
    target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
  // A song that is not there (gone, or in the trash) sends back to the list (SongDetail.razor).
  const missing = !!data && (!data.song || data.song.deletedAt !== null);
  const leave = useEffectEvent(() => (onBack ? onBack() : navigate({ page: 'songs' })));
  useEffect(() => {
    if (missing) leave();
  }, [missing]);
  if (!data) return null;
  const { song, parts, arrangements, labels } = data;
  if (!song || song.deletedAt !== null) return null;

  const update = (fields: Record<string, string | number | null>) => db.mutate('updateSong', { id, ...fields });
  // "Sparad" after the writes the current app flags: fields, a part's text and label, and arrangements;
  // "Kunde inte spara" when one of them is refused.
  const saving = (write: Promise<void>) => afterWrite(write, saved.show, saveFailed);
  // The writes it does not flag ("Sparad") still say when they are refused.
  const failing = (write: Promise<void>) => afterWrite(write, () => {}, saveFailed);
  const labelChoices: Label[] = [
    ...DEFAULT_LABELS.map((l) => ({ id: labelId(l.text), ...l })).filter((l) => !labels.has(l.id)),
    ...labels.values(),
  ].toSorted((a, b) => a.sort - b.sort || a.text.localeCompare(b.text, 'sv'));

  const removePart = async (p: SongPart) => {
    const label = p.labelId ? (labels.get(p.labelId)?.text ?? t('song.noLabel')) : t('song.noLabel');
    await ask(deleteAsk(t('song.removePartConfirm', { label }), label, async () => failing(db.mutate('removeSongPart', { id: p.id }))));
  };

  const trash = async () => {
    // D17: say where the song is used before it goes.
    const using = await presentationsUsing(db, id);
    const text = [t('song.trashConfirm', { name: song.name }), using.length ? t('song.usedIn', { names: using.map((p) => p.name).join(', ') }) : '']
      .filter(Boolean)
      .join(' ');
    if (!(await ask({ title: t('common.delete'), text, bold: song.name, confirm: t('common.delete') }))) return;
    try {
      await db.mutate('trashSong', { id, at: Date.now() });
    } catch (e) {
      // Refused: the song stays, and so does the page.
      console.error('save failed', e);
      saveFailed();
      return;
    }
    toast(t('song.trashed', { name: song.name }));
    if (onBack) onBack();
    else navigate({ page: 'songs' });
  };

  const partRow = (p: SongPart, i: number) => {
    const label = p.labelId ? labelChoices.find((l) => l.id === p.labelId) : undefined;
    return (
      <li key={p.id} data-part-id={p.id} className={`${CARD} p-4 space-y-3`}>
        <div className="flex items-center gap-2">
          <SelectMenu
            label={t('song.label')}
            value={p.labelId ?? ''}
            choices={[
              { value: '', label: t('song.noLabel'), content: <span className="text-neutral-400">{t('song.noLabel')}</span> },
              ...labelChoices.map((l) => ({
                value: l.id,
                label: l.text,
                content: (
                  <span className={PILL} style={{ background: l.color }}>
                    {l.text}
                  </span>
                ),
              })),
            ]}
            onChoose={(v) => saving(db.mutate('updateSongPart', { id: p.id, labelText: labelChoices.find((l) => l.id === v)?.text ?? null }))}
            className="flex-1 max-w-[50%]"
            buttonClassName="w-full flex items-center gap-2 rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-700 text-neutral-900 dark:text-neutral-100 px-3 py-2.5 text-sm text-left cursor-pointer focus:ring-2 focus:ring-sky-500 focus:border-sky-500 outline-none"
            listClassName="left-0 w-full max-h-60 overflow-y-auto"
            face={
              <>
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
              </>
            }
          />
          <div className="flex-1" />
          <div className="flex items-center gap-1">
            <AppButton
              variant="icon"
              className="p-1.5 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 disabled:cursor-default"
              aria-label={t('common.moveUp')}
              title={t('common.moveUp')}
              disabled={i === 0}
              onClick={() => failing(db.mutate('moveSongPart', { id: p.id, toIndex: i - 1 }))}
            >
              <ChevronUpIcon className="size-4" />
            </AppButton>
            <AppButton
              variant="icon"
              className="p-1.5 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 disabled:cursor-default"
              aria-label={t('common.moveDown')}
              title={t('common.moveDown')}
              disabled={i === parts.length - 1}
              onClick={() => failing(db.mutate('moveSongPart', { id: p.id, toIndex: i + 1 }))}
            >
              <ChevronDownIcon className="size-4" />
            </AppButton>
          </div>
        </div>
        <AutoSaveField
          label={`${t('song.parts')} ${i + 1}`}
          value={p.content}
          maxLength={5000}
          multiline
          onSave={(content) => db.mutate('updateSongPart', { id: p.id, content })}
          onSaved={saved.show}
        />
        <div className="flex justify-end">
          <AppButton variant="dangerIcon" className="p-1.5" aria-label={t('song.removePart')} title={t('song.removePart')} onClick={() => void removePart(p)}>
            <TrashIcon className="size-4" />
          </AppButton>
        </div>
      </li>
    );
  };

  const Frame = onBack ? EmbeddedFrame : PageFrame;
  return (
    <Frame>
      {dialog}
      <DetailHeader {...(onBack ? { onBack } : { backHref: href({ page: 'songs' }) })} title={song.name} saved={saved.node} className={onBack ? 'shrink-0' : 'px-5'} />
      <div className="space-y-4">
        <div className={`${CARD} p-5 space-y-4`}>
          {/* A blank name is not saved (spec 02). */}
          <AutoSaveField label={t('song.name')} maxLength={200} value={song.name} onSave={(v) => (v.trim() ? update({ name: v }) : undefined)} onSaved={saved.show} />
          <div className="flex gap-4">
            <AutoSaveField label={t('song.author')} maxLength={200} value={song.author ?? ''} onSave={(v) => update({ author: v })} onSaved={saved.show} className="flex-1" />
            <AutoSaveField label={t('song.publisher')} maxLength={200} value={song.publisher ?? ''} onSave={(v) => update({ publisher: v })} onSaved={saved.show} className="flex-1" />
          </div>
          <div className="flex gap-4">
            <AutoSaveField
              label={t('song.year')}
              type="number"
              min={0}
              max={9999}
              value={song.year === null ? '' : String(song.year)}
              onSave={(v) => {
                const year = v.trim() === '' ? null : Number(v);
                return year === null || (Number.isInteger(year) && year >= 0 && year <= 9999) ? update({ year }) : undefined;
              }}
              onSaved={saved.show}
              className="flex-1"
            />
            <AutoSaveField label={t('song.ccli')} maxLength={20} value={song.ccli ?? ''} onSave={(v) => update({ ccli: v })} onSaved={saved.show} className="flex-1" />
          </div>
        </div>
        {/* The current app shows no heading over the parts; this one is for screen readers. */}
        <h2 className="sr-only">{t('song.parts')}</h2>
        <ol className="space-y-4">{parts.map(partRow)}</ol>
        <AppButton
          variant="secondary"
          className="flex items-center gap-1.5 self-start"
          disabled={parts.length >= LIMITS.partsPerSong}
          onClick={() => {
            const partId = newId();
            scrollTo.current = partId;
            failing(db.mutate('addSongPart', { id: partId, songId: id, labelText: null, content: '' }));
          }}
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
                  <ArrangementCard key={a.id} arrangement={a} index={i} named={arrangements.length >= 2} parts={parts} labels={labels} saving={saving} showSaved={saved.show} />
                ))}
              </ol>
            )}
            {arrangements.length < LIMITS.arrangementsPerSong && (
              <AppButton
                variant="secondary"
                className="flex items-center gap-1.5 self-start"
                onClick={() => saving(db.mutate('createArrangement', { id: newId(), songId: id, partIds: parts.map((p) => p.id) }))}
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
    </Frame>
  );
}

function PageFrame({ children }: { children: ReactNode }) {
  return <PageContainer className="pb-8">{children}</PageContainer>;
}

/** Inside the add dialog: its own scrolling column, with the dialog's padding (EditSong.razor). */
function EmbeddedFrame({ children }: { children: ReactNode }) {
  return <div className="flex-1 min-h-0 overflow-y-auto flex flex-col space-y-5 pb-6">{children}</div>;
}
