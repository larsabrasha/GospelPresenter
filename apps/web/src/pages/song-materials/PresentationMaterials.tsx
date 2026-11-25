import type { PresentationItem } from '@gp/core';
import { useDataReading } from '../../db/react.tsx';
import { songMaterialsOf } from '../../db/views.ts';
import { t } from '../../i18n.ts';
import { PageDialog } from '../../ui/Dialog.tsx';
import { EmptySmall } from '../../ui/Empty.tsx';
import { MusicalNoteOutlineIcon } from '../../ui/icons.tsx';
import { MaterialList } from './SongMaterials.tsx';

/**
 * Noter och länkar for a presentation (spec 02 "Song material"): the sheet music, recordings and links of its songs,
 * in the running order, so the band finds all it plays in one place. Read only: they are added under the song.
 */
export function PresentationMaterials({ items, onClose }: { items: PresentationItem[]; onClose: () => void }) {
  const songs = items.filter((i) => i.type === 'song');
  const songIds = [...new Set(songs.map((i) => i.sourceId))];
  const materials = useDataReading((d) => songMaterialsOf(d, songIds), [songIds.join()], ['song_materials']) ?? [];
  // A song twice in the order is listed once, where it first comes.
  const firsts = songs.filter((s, i) => songs.findIndex((x) => x.sourceId === s.sourceId) === i);
  const withMaterial = firsts.filter((s) => materials.some((m) => m.songId === s.sourceId));
  return (
    <PageDialog title={t('material.title')} onClose={onClose}>
      <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 space-y-6" data-testid="presentation-materials">
        {/* None yet: the libraries' empty state, a note and a heading in the middle, and where they are added (Lars, 2026-11-25). */}
        {!withMaterial.length && (
          <div className="h-full flex items-center justify-center">
            <EmptySmall icon={<MusicalNoteOutlineIcon className="size-12 mb-3 text-stone-300 dark:text-stone-600" />} title={t('material.presentationEmptyTitle')} text={t('material.presentationEmpty')} />
          </div>
        )}
        {withMaterial.map((s) => (
          <section key={s.sourceId} aria-label={s.title} className="space-y-2">
            <h3 className="px-4 text-sm font-semibold text-stone-500 dark:text-stone-400">{s.title}</h3>
            <MaterialList materials={materials.filter((m) => m.songId === s.sourceId)} editable={false} />
          </section>
        ))}
      </div>
    </PageDialog>
  );
}
