import type { Presentation } from '@gp/core';
import { useState } from 'react';
import { useData, useDb } from '../db/react.tsx';
import { listTemplates } from '../db/queries.ts';
import { t } from '../i18n.ts';
import { newId } from '../ids.ts';
import { AddButton } from '../ui/AddButton.tsx';
import { AppButton } from '../ui/AppButton.tsx';
import { useSaveFailed, useTrySave } from '../ui/AutoSave.tsx';
import { afterWrite } from '../ui/debounce.ts';
import { Dialog, DialogButtons } from '../ui/Dialog.tsx';
import { EmptyPicture, PICTURE } from '../ui/Empty.tsx';
import { SimpleInput, SimpleSelect } from '../ui/SimpleInput.tsx';
import { ChevronLeftIcon, TemplatesPicture } from '../ui/icons.tsx';
import { CARD, ListCard, ListLinkRow } from '../ui/List.tsx';
import { PageContainer, PageHeader } from '../ui/PageContainer.tsx';
import { href, navigate } from '../ui/router.ts';
import { templateDetails, WEEKDAYS, weekdayName } from './templates.ts';
import { ROUND_BACK } from '../ui/glass.ts';
import { PresentationNameField } from './presentation-editor/PresentationNameField.tsx';

interface TemplateFields {
  name: string;
  weekday: number | null;
  time: string | null;
  location: string | null;
}

/**
 * A template's name, weekday, time and place (TemplateDetailsDialog.razor):
 * "Skapa mall" on the templates page, "Redigera detaljer" in its editor.
 * Enter in the name saves; with `savingText`, the button says so until `onSave` ends.
 */
function TemplateDetailsDialog({
  title,
  initial,
  saveText,
  savingText,
  onSave,
  onClose,
}: {
  title: string;
  initial: TemplateFields;
  saveText: string;
  savingText?: string;
  onSave: (fields: TemplateFields) => Promise<void> | void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [weekday, setWeekday] = useState(initial.weekday === null ? '' : String(initial.weekday));
  const [time, setTime] = useState(initial.time ?? '');
  const [location, setLocation] = useState(initial.location ?? '');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      await onSave({ name: name.trim(), weekday: weekday === '' ? null : Number(weekday), time: time || null, location: location.trim() || null });
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog title={title} onClose={onClose} maxWidthClass="max-w-2xl">
      <div className="space-y-3">
        <PresentationNameField value={name} onChange={setName} onEnter={() => void save()} />
        <div className="flex gap-2 flex-wrap">
          <SimpleSelect aria-label={t('schedule.day')} value={weekday} onChange={(e) => setWeekday(e.target.value)}>
            <option value="">{t('schedule.noDay')}</option>
            {WEEKDAYS.map((d) => (
              <option key={d} value={d}>
                {weekdayName(d)}
              </option>
            ))}
          </SimpleSelect>
          <SimpleInput type="time" aria-label={t('schedule.time')} value={time} onChange={(e) => setTime(e.target.value)} />
          <SimpleInput placeholder={t('schedule.location')} aria-label={t('schedule.location')} maxLength={100} value={location} onChange={(e) => setLocation(e.target.value)} />
        </div>
        <DialogButtons>
          <AppButton variant="cancel" onClick={onClose}>
            {t('common.cancel')}
          </AppButton>
          <AppButton disabled={!name.trim() || saving} onClick={() => void save()}>
            {saving && savingText ? savingText : saveText}
          </AppButton>
        </DialogButtons>
      </div>
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
      savingText={t('common.creating')}
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
 * Mallar (spec 03 screen 3, `/templates`): a page of its own beside the start page, opened from "Hantera mallar" in
 * Skapa presentation (Lars, 2026-11-02: a template opened from Inställningar felt out of place), with a round ‹ back
 * to the start page. The templates, each opening in the editor, and Skapa. For those who manage templates only (PRES-R4).
 */
export function Templates() {
  const templates = useData(listTemplates, []);
  const [creating, setCreating] = useState(false);
  return (
    <PageContainer>
      <a href={href({ page: 'presentations' })} aria-label={t('nav.backToPresentations')} title={t('nav.backToPresentations')} className={`self-start ml-2 ${ROUND_BACK}`}>
        <ChevronLeftIcon className="size-5" />
      </a>
      <div className="space-y-1">
        <PageHeader title={t('nav.templates')} large>
          <AddButton label={t('common.create')} onClick={() => setCreating(true)} />
        </PageHeader>
        <p className="px-5 text-sm text-stone-500 dark:text-stone-400">{t('intro.templates')}</p>
      </div>
      {!templates && (
        <div className={CARD}>
          <div className="loading-line px-5 py-4 text-stone-400 text-sm">{t('common.loading')}</div>
        </div>
      )}
      {templates && !templates.length && (
        <EmptyPicture picture={<TemplatesPicture className={PICTURE} />} title={t('templates.empty')}>
          <AppButton onClick={() => setCreating(true)}>{t('templates.createTitle')}</AppButton>
        </EmptyPicture>
      )}
      {!!templates?.length && (
        <ListCard label={t('nav.templates')}>
          {templates.map((tp) => (
            <ListLinkRow key={tp.id} href={href({ page: 'template', id: tp.id })} title={<span className="font-medium">{tp.name}</span>} subtitle={templateDetails(tp) || undefined} />
          ))}
        </ListCard>
      )}
      {creating && <CreateTemplateDialog onClose={() => setCreating(false)} />}
    </PageContainer>
  );
}
