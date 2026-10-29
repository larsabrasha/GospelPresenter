import type { Presentation } from '@gp/core';
import { useState } from 'react';
import { useData, useDb } from '../db/react.tsx';
import { listTemplates } from '../db/queries.ts';
import { t } from '../i18n.ts';
import { newId } from '../ids.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { useSaveFailed, useTrySave } from '../ui/AutoSave.tsx';
import { afterWrite } from '../ui/debounce.ts';
import { Dialog, DialogButtons } from '../ui/Dialog.tsx';
import { EmptyPicture, PICTURE } from '../ui/Empty.tsx';
import { FloatingInput, FloatingSelect } from '../ui/Floating.tsx';
import { PlusIcon, TemplatesPicture, TrashIcon } from '../ui/icons.tsx';
import { CARD, ListCard, ListLinkRow } from '../ui/List.tsx';
import { PageContainer, PageHeader } from '../ui/PageContainer.tsx';
import { href, navigate } from '../ui/router.ts';
import { WEEKDAYS, weekdayName } from './templates.ts';

export interface TemplateFields {
  name: string;
  weekday: number | null;
  time: string | null;
  location: string | null;
}

/**
 * A template's name, weekday, time and place (TemplateDetailsDialog.razor):
 * "Skapa mall" on the templates page, "Redigera detaljer" in its editor.
 * Enter in a field saves; Skapa waits for `onSave`, Spara does not.
 */
export function TemplateDetailsDialog({
  title,
  initial,
  saveText,
  onSave,
  onClose,
}: {
  title: string;
  initial: TemplateFields;
  saveText: string;
  onSave: (fields: TemplateFields) => Promise<void> | void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [weekday, setWeekday] = useState(initial.weekday === null ? '' : String(initial.weekday));
  const [time, setTime] = useState(initial.time ?? '');
  const [location, setLocation] = useState(initial.location ?? '');
  const [saving, setSaving] = useState(false);
  return (
    <Dialog title={title} onClose={onClose} maxWidthClass="max-w-2xl">
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim() || saving) return;
          setSaving(true);
          try {
            await onSave({ name, weekday: weekday === '' ? null : Number(weekday), time: time || null, location: location.trim() || null });
          } finally {
            setSaving(false);
          }
        }}
      >
        <FloatingInput label={t('presentation.name')} autoFocus maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
        <div className="flex gap-2 flex-wrap">
          <FloatingSelect label={t('schedule.day')} className="flex-1 min-w-36" value={weekday} onChange={(e) => setWeekday(e.target.value)}>
            <option value="">{t('schedule.noDay')}</option>
            {WEEKDAYS.map((d) => (
              <option key={d} value={d}>
                {weekdayName(d)}
              </option>
            ))}
          </FloatingSelect>
          <FloatingInput label={t('schedule.time')} className="flex-1 min-w-28" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          <FloatingInput label={t('schedule.location')} className="flex-2 min-w-40" maxLength={100} value={location} onChange={(e) => setLocation(e.target.value)} />
        </div>
        <DialogButtons>
          <AppButton variant="cancel" onClick={onClose}>
            {t('common.cancel')}
          </AppButton>
          <AppButton type="submit" disabled={!name.trim() || saving}>
            {saveText}
          </AppButton>
        </DialogButtons>
      </form>
    </Dialog>
  );
}

/** "Skapa mall": a new, empty template, then its editor (Templates.razor). */
function CreateTemplateDialog({ onClose }: { onClose: () => void }) {
  const db = useDb();
  const trySave = useTrySave();
  return (
    <TemplateDetailsDialog
      title={t('templates.createTitle')}
      initial={{ name: '', weekday: null, time: null, location: null }}
      saveText={t('common.create')}
      onClose={onClose}
      onSave={async (fields) => {
        const id = newId();
        if (await trySave(db.mutate('createTemplate', { id, ...fields }))) navigate({ page: 'template', id });
      }}
    />
  );
}

/** "Redigera detaljer" of a template: closes at once; a refused write says so after the dialog is gone. */
export function EditTemplateDialog({ template, onClose }: { template: Presentation; onClose: () => void }) {
  const db = useDb();
  const saveFailed = useSaveFailed();
  return (
    <TemplateDetailsDialog
      title={t('presentation.editDetails')}
      initial={template}
      saveText={t('common.save')}
      onClose={onClose}
      onSave={(fields) => {
        afterWrite(db.mutate('updateTemplate', { id: template.id, ...fields }), () => {}, saveFailed);
        onClose();
      }}
    />
  );
}

/**
 * Mallar (spec 03 screen 3, `/admin/templates`): the templates, each opening
 * in the editor; Skapa and the way to their trash. For those who manage
 * templates only (PRES-R4).
 */
export function Templates() {
  const templates = useData(listTemplates, []);
  const [creating, setCreating] = useState(false);
  const create = (
    <AppButton onClick={() => setCreating(true)} className="flex items-center gap-1.5">
      <PlusIcon className="size-4" />
      {t('common.create')}
    </AppButton>
  );
  return (
    <PageContainer>
      <PageHeader title={t('nav.templates')}>
        <div className="flex items-center gap-2">
          {/* Always here: whoever has just deleted the wrong template needs the way back in view (Templates.razor). */}
          <AppButton variant="cancel" href={href({ page: 'trash', kind: 'Template' })} className="flex items-center gap-1.5">
            <TrashIcon className="size-4" />
            {t('nav.trash')}
          </AppButton>
          {!!templates?.length && create}
        </div>
      </PageHeader>
      {templates && !templates.length && (
        <div className={CARD}>
          <EmptyPicture picture={<TemplatesPicture className={PICTURE} />} title={t('templates.empty')} text={t('templates.description')}>
            {create}
          </EmptyPicture>
        </div>
      )}
      {!!templates?.length && (
        <ListCard label={t('nav.templates')}>
          {templates.map((tp) => (
            <ListLinkRow key={tp.id} href={href({ page: 'template', id: tp.id })} title={<span className="font-medium">{tp.name}</span>} />
          ))}
        </ListCard>
      )}
      {creating && <CreateTemplateDialog onClose={() => setCreating(false)} />}
    </PageContainer>
  );
}
