import { LIMITS, parsePartIds, type Label, type SongArrangement, type SongPart } from '@gp/core';
import { useState } from 'react';
import { useDb } from '../db/react.tsx';
import { t } from '../i18n.ts';
import { newId } from '../ids.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { Dialog, DialogButtons } from '../ui/Dialog.tsx';
import { CAPTION, GROUP_ROW, Group, TEXT_ACTION } from '../ui/Group.tsx';
import { ChevronRightIcon, PlusIcon } from '../ui/icons.tsx';
import { ArrangementCard, orderLine } from './ArrangementCard.tsx';

/** An arrangement's name where it shows: its own, "Ordning" when it is the only one, else "Ordning 2". */
function orderTitle(a: SongArrangement, index: number, count: number): string {
  return a.name ?? (count === 1 ? t('song.arrangement') : `${t('song.arrangement')} ${index + 1}`);
}

/**
 * Ordning under a song's parts (spec 02 "Arrangemang"; Lars, 2026-11-02, as Apple would: the word is Ordning, and it
 * is there from the start). A row for each order with its parts in a line, or the parts' own order while the song has
 * none; a row opens its order in a dialog to drag, repeat and remove parts, the first time making it. What an order
 * is for in grey under the group, and Lägg till ordning for a shorter one to choose in a presentation.
 */
export function SongOrder({
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
  const [open, setOpen] = useState<string | null>(null);
  if (!parts.length) return null;
  /** A new order of every part once, in order (SONG-A9), opened at once. */
  const create = () => {
    const id = newId();
    saving(db.mutate('createArrangement', { id, songId, partIds: parts.map((p) => p.id) }));
    setOpen(id);
  };
  const opened = arrangements.findIndex((a) => a.id === open);
  const row = (key: string, title: string | null, line: string, onClick: () => void) => (
    <AppButton key={key} variant="plain" onClick={onClick} className={`${GROUP_ROW} w-full text-left cursor-pointer hover:bg-raised`}>
      <span className="min-w-0">
        {title && <span className="block">{title}</span>}
        <span className={`block truncate ${title ? 'text-xs text-stone-500 dark:text-stone-400' : ''}`}>{line}</span>
      </span>
      <ChevronRightIcon className="size-4 shrink-0 text-stone-400 dark:text-stone-600" />
    </AppButton>
  );
  return (
    <section className="space-y-1.5" aria-label={t('song.arrangements')}>
      <h2 className={CAPTION}>{t('song.arrangements')}</h2>
      <Group footer={t('song.orderHint')}>
        {arrangements.length
          ? arrangements.map((a, i) =>
              row(
                a.id,
                arrangements.length > 1 ? orderTitle(a, i, arrangements.length) : null,
                orderLine(parsePartIds(a.partIds), parts, labels),
                () => setOpen(a.id),
              ),
            )
          : row(
              'parts',
              null,
              orderLine(
                parts.map((p) => p.id),
                parts,
                labels,
              ),
              create,
            )}
      </Group>
      {arrangements.length > 0 && arrangements.length < LIMITS.arrangementsPerSong && (
        <AppButton variant="plain" className={TEXT_ACTION} onClick={create}>
          <PlusIcon className="size-4" />
          {t('song.createArrangement')}
        </AppButton>
      )}
      {opened >= 0 && (
        <Dialog title={orderTitle(arrangements[opened]!, opened, arrangements.length)} onClose={() => setOpen(null)} maxWidthClass="max-w-lg">
          <ArrangementCard
            arrangement={arrangements[opened]!}
            title={orderTitle(arrangements[opened]!, opened, arrangements.length)}
            named={arrangements.length >= 2}
            parts={parts}
            labels={labels}
            saving={saving}
            showSaved={showSaved}
          />
          <DialogButtons>
            <AppButton onClick={() => setOpen(null)}>{t('presentation.doneEditingImages')}</AppButton>
          </DialogButtons>
        </Dialog>
      )}
    </section>
  );
}
