import { parsePartIds, type Label, type SongArrangement, type SongPart } from '@gp/core';
import { useEffect, useRef } from 'react';
import { useDb } from '../db/react.tsx';
import { t } from '../i18n.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { AutoSaveField } from '../ui/AutoSave.tsx';
import { deleteAsk, useConfirm } from '../ui/Dialog.tsx';
import { CloseIcon, GripIcon, PlusIcon } from '../ui/icons.tsx';
import { SelectMenu } from '../ui/SelectMenu.tsx';
import { useSortable } from '../ui/sortable.ts';
import { CARD, PILL } from './songEditorLook.ts';
import { DANGER_ROW, Group, TEXT_ACTION } from '../ui/Group.tsx';

// An arrangement in the song editor (Components/SongArrangementEditor.razor).

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
    <span className={`${PILL} ${label ? '' : 'bg-stone-400'}`} style={label ? { background: label.color } : undefined}>
      {partName(part, labels)}
    </span>
  );
}

/** An arrangement's parts as the line under a song's parts reads them: "Verse 1 · Chorus · Verse 2 · Chorus". */
export function orderLine(partIds: string[], parts: SongPart[], labels: Map<string, Label>): string {
  const byId = new Map(parts.map((p) => [p.id, p]));
  return partIds.flatMap((id) => (byId.has(id) ? [partName(byId.get(id)!, labels)] : [])).join(' · ');
}

/**
 * One Ordning (spec 02 "Arrangemang"; Lars, 2026-11-02: the word is Ordning), in its dialog: its name when the song has
 * two or more, its parts as rows to drag, remove and append to, and Ta bort ordning as a red row.
 */
export function ArrangementCard({
  arrangement,
  title,
  named,
  parts,
  labels,
  saving,
  showSaved,
}: {
  arrangement: SongArrangement;
  title: string;
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
    <div className="space-y-3" role="group" aria-label={title}>
      {dialog}
      {named && (
        <AutoSaveField
          label={t('song.name')}
          maxLength={100}
          value={arrangement.name ?? ''}
          onSave={(name) => db.mutate('updateArrangement', { id: arrangement.id, name })}
          onSaved={showSaved}
        />
      )}
      <div className={`${CARD} overflow-hidden flex flex-col`}>
        <ol ref={listRef} className="flex flex-col empty:hidden [&>li+li]:border-t-[0.5px] [&>li+li]:border-separator" aria-label={t('song.arrangementParts')}>
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
              className={`flex items-center gap-2 bg-surface px-4 min-h-11 cursor-grab active:cursor-grabbing select-none [-webkit-touch-callout:none] focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
                dragging === v ? 'shadow-lg' : ''
              }`}
            >
              <GripIcon className="size-4 text-stone-300 dark:text-stone-500 shrink-0" />
              <PartPill part={part} labels={labels} />
              <span className="flex-1" />
              <AppButton
                variant="plain"
                className="p-0.5 text-stone-300 hover:text-red-500 dark:text-stone-500 dark:hover:text-red-400 cursor-pointer shrink-0"
                aria-label={t('song.removeChip', { part: partName(part, labels) })}
                onClick={() => saving(db.mutate('removeArrangementPart', { id: arrangement.id, index: i, partId: id }))}
              >
                <CloseIcon className="size-3.5" />
              </AppButton>
            </li>
          );
        })}
        </ol>
      </div>
      <div>
        {/* A list of actions: picking a part appends it, so nothing stays chosen. */}
        <SelectMenu
          label={t('song.addPart')}
          choices={parts.map((p, i) => ({ value: p.id, label: `${i + 1}. ${partName(p, labels)}`, content: <PartPill part={p} labels={labels} /> }))}
          onChoose={(partId) => saving(db.mutate('appendArrangementPart', { id: arrangement.id, partId }))}
          buttonClassName={`${TEXT_ACTION} rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500`}
          listClassName="left-0 w-48 max-h-60 overflow-y-auto"
          face={
            <>
              <PlusIcon className="size-4" />
              {t('song.addPart')}
            </>
          }
        />
      </div>
      <Group>
        <AppButton
          variant="plain"
          className={DANGER_ROW}
          onClick={() => void ask(deleteAsk(t('song.removeArrangementConfirm'), undefined, async () => saving(db.mutate('removeArrangement', { id: arrangement.id }))))}
        >
          {t('song.removeArrangement')}
        </AppButton>
      </Group>
    </div>
  );
}

