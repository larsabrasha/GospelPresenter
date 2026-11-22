import { useDataReading } from '../../db/react.tsx';
import { presentationMaterials } from '../../db/views.ts';
import { t } from '../../i18n.ts';
import { PageDialog } from '../../ui/Dialog.tsx';
import { MaterialList } from './SongMaterials.tsx';

/**
 * Noter och länkar for a presentation (spec 02 "Song material"): the sheet music, recordings and links of its songs,
 * in the running order, so the band finds all it plays in one place; which songs and in which order the core's
 * (`presentationMaterialsView`). Read only: they are added under the song.
 */
export function PresentationMaterials({ presentationId, onClose }: { presentationId: string; onClose: () => void }) {
  const data = useDataReading((d) => presentationMaterials(d, presentationId), [presentationId], ['song_materials', 'presentation_items']);
  return (
    <PageDialog title={t('material.title')} onClose={onClose}>
      <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 space-y-6" data-testid="presentation-materials">
        {data?.empty === 'material.presentationEmpty' && <p className="text-sm text-stone-500 dark:text-stone-400">{t('material.presentationEmpty')}</p>}
        {data?.songs.map((s) => (
          <section key={s.songId} aria-label={s.title} className="space-y-2">
            <h3 className="px-4 text-sm font-semibold text-stone-500 dark:text-stone-400">{s.title}</h3>
            <MaterialList materials={s.materials} editable={false} />
          </section>
        ))}
      </div>
    </PageDialog>
  );
}
