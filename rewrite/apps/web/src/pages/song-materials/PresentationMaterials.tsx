import type { PresentationItem } from '@gp/core';
import { songMaterialsOf } from '../../db/queries.ts';
import { useData } from '../../db/react.tsx';
import { t } from '../../i18n.ts';
import { PageDialog } from '../../ui/Dialog.tsx';
import { MaterialList } from './SongMaterials.tsx';

/**
 * Noter och länkar for a presentation (spec 02 "Song material"): the sheet music, recordings and links of its songs,
 * in the running order, so the band finds all it plays in one place. Read only: they are added under the song.
 */
export function PresentationMaterials({ items, onClose }: { items: PresentationItem[]; onClose: () => void }) {
  const songs = items.filter((i) => i.type === 'song');
  const songIds = [...new Set(songs.map((i) => i.sourceId))];
  const materials = useData((d) => songMaterialsOf(d, songIds), [songIds.join()]) ?? [];
  // A song twice in the order is listed once, where it first comes.
  const firsts = songs.filter((s, i) => songs.findIndex((x) => x.sourceId === s.sourceId) === i);
  const withMaterial = firsts.filter((s) => materials.some((m) => m.songId === s.sourceId));
  return (
    <PageDialog title={t('material.title')} onClose={onClose}>
      <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 space-y-6" data-testid="presentation-materials">
        {!withMaterial.length && <p className="text-sm text-stone-500 dark:text-stone-400">{t('material.presentationEmpty')}</p>}
        {withMaterial.map((s) => (
          <section key={s.sourceId} aria-label={s.title} className="space-y-2">
            <h3 className="px-4 text-[13px] font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">{s.title}</h3>
            <MaterialList materials={materials.filter((m) => m.songId === s.sourceId)} editable={false} />
          </section>
        ))}
      </div>
    </PageDialog>
  );
}
