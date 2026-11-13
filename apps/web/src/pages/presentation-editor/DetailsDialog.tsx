import type { Presentation } from '@gp/core';
import { useDb } from '../../db/react.tsx';
import { t } from '../../i18n.ts';
import { useSaveFailed } from '../../ui/AutoSave.tsx';
import { afterWrite } from '../../ui/debounce.ts';
import { detailsArgs, PresentationDetailsDialog } from './PresentationDetailsDialog.tsx';

/** "Redigera detaljer": the name, when and where, the description and the theme (spec 03 2a, spec 05). */
export function DetailsDialog({ presentation: p, onClose }: { presentation: Presentation; onClose: () => void }) {
  const db = useDb();
  const saveFailed = useSaveFailed();
  return (
    <PresentationDetailsDialog
      title={t('presentation.editDetails')}
      initial={{ name: p.name, date: p.eventDate ?? '', time: p.time ?? '', location: p.location ?? '', description: p.description ?? '', themeId: p.themeId ?? '' }}
      withTheme
      saveText={t('common.save')}
      onSave={(d) => {
        // Closes at once; a refused write says so after the dialog is gone.
        afterWrite(db.mutate('updatePresentation', { id: p.id, ...detailsArgs(d), themeId: d.themeId || null }), () => {}, saveFailed);
        onClose();
      }}
      onClose={onClose}
    />
  );
}
