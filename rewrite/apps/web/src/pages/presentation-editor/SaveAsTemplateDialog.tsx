import type { Presentation, PresentationItem } from '@gp/core';
import { useState } from 'react';
import { useDb } from '../../db/react.tsx';
import { t } from '../../i18n.ts';
import { newId } from '../../ids.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { useTrySave } from '../../ui/AutoSave.tsx';
import { Dialog, DialogButtons } from '../../ui/Dialog.tsx';
import { FloatingInput } from '../../ui/Floating.tsx';
import { useToast } from '../../ui/Toast.tsx';

/**
 * "Spara som mall" (PRES-R31, Pages/Presentation.razor's NameDialog): a name,
 * prefilled with the presentation's, then a template of its items and theme:
 * the items shown here, each copy with an id of its own. The editor stays on
 * the presentation.
 */
export function SaveAsTemplateDialog({ presentation, items, onClose }: { presentation: Presentation; items: PresentationItem[]; onClose: () => void }) {
  const db = useDb();
  const trySave = useTrySave();
  const toast = useToast();
  const [name, setName] = useState(presentation.name);
  const [saving, setSaving] = useState(false);
  return (
    <Dialog title={t('templates.saveAs')} onClose={onClose} maxWidthClass="max-w-2xl">
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim() || saving) return;
          setSaving(true);
          const copies = items.map((item) => ({ from: item.id, id: newId() }));
          const saved = await trySave(db.mutate('saveAsTemplate', { id: newId(), presentationId: presentation.id, name, items: copies }));
          setSaving(false);
          if (!saved) return;
          toast(t('templates.savedAs'));
          onClose();
        }}
      >
        <FloatingInput label={t('presentation.name')} autoFocus maxLength={200} value={name} onFocus={(e) => e.currentTarget.select()} onChange={(e) => setName(e.target.value)} />
        <DialogButtons>
          <AppButton variant="cancel" onClick={onClose}>
            {t('common.cancel')}
          </AppButton>
          <AppButton type="submit" disabled={!name.trim() || saving}>
            {t('common.save')}
          </AppButton>
        </DialogButtons>
      </form>
    </Dialog>
  );
}
