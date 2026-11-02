import { LIMITS, parsePartIds, type Label, type SongArrangement, type SongPart } from '@gp/core';
import { useState } from 'react';
import { useDb } from '../db/react.tsx';
import { t } from '../i18n.ts';
import { newId } from '../ids.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { Dialog, DialogButtons } from '../ui/Dialog.tsx';
import { GROUP_ROW, Group, OpeningRow, TEXT_ACTION } from '../ui/Group.tsx';
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon } from '../ui/icons.tsx';
import { ArrangementCard, orderLine } from './ArrangementCard.tsx';

/** An arrangement's name where it shows: its own, "Arrangemang" when it is the only one, else "Arrangemang 2". */
function arrangementTitle(a: SongArrangement, index: number, count: number): string {
  return a.name ?? (count === 1 ? t('song.arrangement') : `${t('song.arrangement')} ${index + 1}`);
}


/**
 * Arrangemang on a song's page (spec 02; Lars, 2026-11-02): one row, its order in grey, that opens a sheet as iOS's
 * Settings opens a page. In the sheet a row for each arrangement with its parts in a line, or the parts' own order
 * while the song has none; what an arrangement is for in grey under them; and Lägg till arrangemang. A row opens its
 * arrangement in the same sheet to drag, repeat and remove parts, the first time making it.
 */
export function SongArrangements({
  songId,
  arrangements,
  parts,
  labels,
  saving,
  showSaved,
}: {
  songId: string;
  arrangements: SongArrangement[];
  parts: SongPart[];
  labels: Map<string, Label>;
  saving: (write: Promise<void>) => void;
  showSaved: () => void;
}) {
  const db = useDb();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  if (!parts.length) return null;
  /** A new arrangement of every part once, in order (SONG-A9), opened at once. */
  const create = () => {
    const id = newId();
    saving(db.mutate('createArrangement', { id, songId, partIds: parts.map((p) => p.id) }));
    setEditing(id);
  };
  const close = () => {
    setOpen(false);
    setEditing(null);
  };
  const partsLine = orderLine(
    parts.map((p) => p.id),
    parts,
    labels,
  );
  const line = (a: SongArrangement) => orderLine(parsePartIds(a.partIds), parts, labels);
  const summary = arrangements.length > 1 ? t('song.arrangementCount', { n: arrangements.length }) : arrangements[0] ? line(arrangements[0]) : partsLine;
  // An arrangement removed while open (here, or on another device) shows the list again.
  const at = arrangements.findIndex((a) => a.id === editing);
  const shown = at >= 0 ? arrangements[at]! : null;
  const title = shown ? arrangementTitle(shown, at, arrangements.length) : t('song.arrangements');
  return (
    <>
      <OpeningRow label={t('song.arrangements')} value={summary} onClick={() => setOpen(true)} />
      {open && (
        <Dialog title={title} onClose={close} maxWidthClass="max-w-lg">
          {shown ? (
            <>
              {/* Back to the list, as a sheet's own navigation does. */}
              <AppButton variant="plain" className={`${TEXT_ACTION} -mt-2 -ml-4`} onClick={() => setEditing(null)}>
                <ChevronLeftIcon className="size-4" />
                {t('song.arrangements')}
              </AppButton>
              <ArrangementCard arrangement={shown} title={title} named={arrangements.length >= 2} parts={parts} labels={labels} saving={saving} showSaved={showSaved} />
            </>
          ) : (
            <div className="space-y-1.5">
              <Group footer={t('song.orderHint')}>
                {arrangements.length ? (
                  arrangements.map((a, i) => (
                    <AppButton key={a.id} variant="plain" data-testid="arrangement-row" onClick={() => setEditing(a.id)} className={`${GROUP_ROW} w-full text-left cursor-pointer hover:bg-raised`}>
                      <span className="min-w-0">
                        {arrangements.length > 1 && <span className="block">{arrangementTitle(a, i, arrangements.length)}</span>}
                        <span className={`block truncate ${arrangements.length > 1 ? 'text-xs text-stone-500 dark:text-stone-400' : ''}`}>{line(a)}</span>
                      </span>
                      <ChevronRightIcon className="size-4 shrink-0 text-stone-400 dark:text-stone-600" />
                    </AppButton>
                  ))
                ) : (
                  <OpeningRow label={partsLine} onClick={create} testId="arrangement-row" />
                )}
              </Group>
              {arrangements.length > 0 && arrangements.length < LIMITS.arrangementsPerSong && (
                <AppButton variant="plain" className={TEXT_ACTION} onClick={create}>
                  <PlusIcon className="size-4" />
                  {t('song.createArrangement')}
                </AppButton>
              )}
            </div>
          )}
          <DialogButtons>
            <AppButton onClick={close}>{t('presentation.doneEditingImages')}</AppButton>
          </DialogButtons>
        </Dialog>
      )}
    </>
  );
}
