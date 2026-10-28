import { listThemes } from '@gp/core';
import { useState } from 'react';
import { useDb } from '../../db/react.tsx';
import { t } from '../../i18n.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { useSaveFailed } from '../../ui/AutoSave.tsx';
import { afterWrite } from '../../ui/debounce.ts';
import { Dialog, DialogButtons } from '../../ui/Dialog.tsx';
import { FloatingInput, FloatingSelect } from '../../ui/Floating.tsx';

/** "Redigera detaljer": the name, the event date and the theme (spec 03 2a, spec 05). */
export function DetailsDialog({
  id,
  name: initialName,
  eventDate,
  themeId,
  onClose,
}: {
  id: string;
  name: string;
  eventDate: string | null;
  themeId: string | null;
  onClose: () => void;
}) {
  const db = useDb();
  const saveFailed = useSaveFailed();
  const [name, setName] = useState(initialName);
  const [date, setDate] = useState(eventDate ?? '');
  const [theme, setTheme] = useState(themeId ?? '');
  return (
    <Dialog title={t('presentation.editDetails')} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          // Closes at once; a refused write says so after the dialog is gone.
          afterWrite(db.mutate('updatePresentation', { id, name, eventDate: date || null, themeId: theme || null }), () => {}, saveFailed);
          onClose();
        }}
      >
        <FloatingInput label={t('presentation.name')} autoFocus maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
        <FloatingInput label={t('presentation.date')} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <FloatingSelect label={t('presentation.theme')} value={theme} onChange={(e) => setTheme(e.target.value)}>
          <option value="">{t('presentation.themeDefault')}</option>
          {listThemes().map((th) => (
            <option key={th.id} value={th.id}>
              {th.name}
            </option>
          ))}
        </FloatingSelect>
        <DialogButtons>
          <AppButton variant="cancel" onClick={onClose}>
            {t('common.cancel')}
          </AppButton>
          <AppButton type="submit" disabled={!name.trim()}>
            {t('common.save')}
          </AppButton>
        </DialogButtons>
      </form>
    </Dialog>
  );
}
