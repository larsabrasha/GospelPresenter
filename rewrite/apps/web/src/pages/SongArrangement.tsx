import { parsePartIds, type Label, type SongArrangement as Arrangement, type SongPart } from '@gp/core';
import { useEffect, useRef } from 'react';
import { useDb } from '../db/react.tsx';
import { t } from '../i18n.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { AutoSaveField, useSaveFailed, useSavedIndicator } from '../ui/AutoSave.tsx';
import { afterWrite } from '../ui/debounce.ts';
import { deleteAsk, useConfirm } from '../ui/Dialog.tsx';
import { DANGER_ROW, Group } from '../ui/Group.tsx';
import { GripIcon, MinusIcon, PlusIcon } from '../ui/icons.tsx';
import { DetailHeader, PageContainer } from '../ui/PageContainer.tsx';
import { href } from '../ui/router.ts';
import { useSortable } from '../ui/sortable.ts';
import { PartPill, partName } from './PartPill.tsx';
import { arrangementTitle, useArrangementData } from './SongArrangements.tsx';
import { useGoneSong, useGoneTo } from './songPage.ts';

/** iOS's round red ⊖ and green ⊕ of a list in edit mode. */
const ROUND = 'shrink-0 size-5 rounded-full flex items-center justify-center text-white cursor-pointer';

/**
 * One arrangement (spec 02 "Arrangemang"), pushed in from Arrangemang (Lars, 2026-11-03), as iOS lays out a list in
 * edit mode: its name when the song has two or more (SONG-A11); its parts, each with a red ⊖ and dragged by the row;
 * every part of the song under them with a green ⊕ that adds it last, so a chorus is repeated by adding it again; and
 * Radera arrangemang as a red row. Removed, here or elsewhere, Arrangemang takes its place.
 */
export function SongArrangement({ id, arrangementId }: { id: string; arrangementId: string }) {
  const data = useArrangementData(id);
  const saved = useSavedIndicator();
  const missing = useGoneSong(!!data, data?.song);
  const at = data?.arrangements.findIndex((a) => a.id === arrangementId) ?? -1;
  useGoneTo(!!data && !missing && at < 0, { page: 'songArrangements', id });
  const arrangement = data?.arrangements[at];
  const title = arrangement ? arrangementTitle(arrangement, at, data!.arrangements.length) : t('song.arrangement');
  return (
    <PageContainer className="pb-8">
      <DetailHeader backHref={href({ page: 'songArrangements', id })} title={title} saved={saved.node} className="px-5" />
      {arrangement ? (
        <ArrangementEditor arrangement={arrangement} title={title} named={data!.arrangements.length > 1} parts={data!.parts} labels={data!.labels} showSaved={saved.show} />
      ) : (
        <div className="px-7 text-stone-400">{t('common.loading')}</div>
      )}
    </PageContainer>
  );
}

function ArrangementEditor({
  arrangement,
  title,
  named,
  parts,
  labels,
  showSaved,
}: {
  arrangement: Arrangement;
  title: string;
  named: boolean;
  parts: SongPart[];
  labels: Map<string, Label>;
  showSaved: () => void;
}) {
  const db = useDb();
  const saveFailed = useSaveFailed();
  const { dialog, ask } = useConfirm();
  /** Shows "Sparad" once the write is done, as every change to an arrangement does in the current app. */
  const saving = (write: Promise<void>) => afterWrite(write, showSaved, saveFailed);
  const byId = new Map(parts.map((p) => [p.id, p]));
  // Ids of deleted parts are not shown (SONG-R18). Edits name the index in the stored list, so they are counted with
  // those ids in.
  const ids = parsePartIds(arrangement.partIds);
  const visible = ids.flatMap((id, i) => (byId.has(id) ? [i] : []));
  // The row moved from the keyboard, by its place in the stored list, to focus again once it is there.
  const refocus = useRef<{ partId: string; index: number } | null>(null);

  /** Moves the row shown `from`th to be shown `to`th; hidden ids keep their places. */
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
    <div className="space-y-6" role="group" aria-label={title}>
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
      <Group title={t('song.arrangementParts')}>
        <ol ref={listRef} className="flex flex-col [&>li+li]:border-t-[0.5px] [&>li+li]:border-separator" aria-label={t('song.arrangementParts')}>
          {visible.map((i, v) => {
            const id = ids[i]!;
            const part = byId.get(id)!;
            // The whole row is the drag handle; with focus on it, Alt+↑/↓ moves it.
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
                className={`flex items-center gap-3 bg-surface px-4 min-h-11 cursor-grab active:cursor-grabbing select-none [-webkit-touch-callout:none] focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 first:rounded-t-xl last:rounded-b-xl ${
                  dragging === v ? 'shadow-lg' : ''
                }`}
              >
                <AppButton
                  variant="plain"
                  className={`${ROUND} bg-red-500`}
                  aria-label={t('song.removeChip', { part: partName(part, labels) })}
                  onClick={() => saving(db.mutate('removeArrangementPart', { id: arrangement.id, index: i, partId: id }))}
                >
                  <MinusIcon className="size-3.5" strokeWidth={3} />
                </AppButton>
                <PartPill part={part} labels={labels} />
                <span className="flex-1" />
                <GripIcon className="size-4 text-stone-300 dark:text-stone-500 shrink-0" />
              </li>
            );
          })}
        </ol>
      </Group>
      {/* Every part of the song, as iOS's "more" list in edit mode: ⊕ adds it last, and it stays to add again. */}
      <Group title={t('song.songParts')}>
        {parts.map((p) => (
          <AppButton
            key={p.id}
            variant="plain"
            className="flex items-center gap-3 px-4 min-h-11 w-full text-left cursor-pointer hover:bg-raised"
            aria-label={t('song.appendPart', { part: partName(p, labels) })}
            onClick={() => saving(db.mutate('appendArrangementPart', { id: arrangement.id, partId: p.id }))}
          >
            <span className={`${ROUND} bg-green-500`}>
              <PlusIcon className="size-3.5" strokeWidth={3} />
            </span>
            <PartPill part={p} labels={labels} />
          </AppButton>
        ))}
      </Group>
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
