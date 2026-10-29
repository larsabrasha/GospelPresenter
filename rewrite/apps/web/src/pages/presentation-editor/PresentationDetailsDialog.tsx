import { listThemes } from '@gp/core';
import { useState } from 'react';
import { t } from '../../i18n.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { Dialog, DialogButtons } from '../../ui/Dialog.tsx';
import { FloatingInput, FloatingTextarea } from '../../ui/Floating.tsx';
import { MapPinIcon } from '../../ui/icons.tsx';
import { SimpleInput, SimpleSelect } from '../../ui/SimpleInput.tsx';

/** What the dialog edits; empty strings are cleared fields. */
export interface PresentationDetails {
  name: string;
  date: string;
  time: string;
  location: string;
  description: string;
  themeId: string;
}

/** The fields as the mutators take them: an empty one is null. */
export function detailsArgs(d: PresentationDetails) {
  return {
    name: d.name.trim(),
    eventDate: d.date || null,
    time: d.time || null,
    location: d.location.trim() || null,
    description: d.description.trim() || null,
  };
}

/**
 * A presentation's details (Components/Presentations/PresentationDetailsDialog.razor):
 * the name, a row of date, time and place, the description, and the theme when
 * `withTheme`. Used for Skapa and for Redigera detaljer. Enter in the name saves;
 * `onSave` resolves when the dialog may close, with `savingText` on the button
 * until then.
 */
export function PresentationDetailsDialog({
  title,
  initial,
  withTheme,
  saveText,
  savingText,
  onSave,
  onClose,
}: {
  title: string;
  initial: PresentationDetails;
  withTheme?: boolean;
  saveText: string;
  savingText?: string;
  onSave: (d: PresentationDetails) => Promise<void> | void;
  onClose: () => void;
}) {
  const [d, setD] = useState(initial);
  const [saving, setSaving] = useState(false);
  const set = (field: keyof PresentationDetails) => (e: { target: { value: string } }) => setD((was) => ({ ...was, [field]: e.target.value }));
  const save = async () => {
    if (saving || !d.name.trim()) return;
    setSaving(true);
    try {
      await onSave(d);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog title={title} onClose={onClose} maxWidthClass="max-w-2xl">
      <div className="space-y-3">
        <FloatingInput
          label={t('presentation.name')}
          hideLabel
          autoFocus
          maxLength={200}
          value={d.name}
          onChange={set('name')}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void save();
            }
          }}
        />
        <div className="flex gap-2 flex-wrap">
          <SimpleInput type="date" aria-label={t('presentation.date')} value={d.date} onChange={set('date')} />
          <SimpleInput type="time" aria-label={t('presentation.time')} value={d.time} onChange={set('time')} />
          <SimpleInput placeholder={t('presentation.location')} aria-label={t('presentation.location')} maxLength={100} value={d.location} onChange={set('location')} icon={<MapPinIcon className="size-4" />} />
        </div>
        <FloatingTextarea label={t('presentation.description')} maxLength={5000} rows={4} value={d.description} onChange={set('description')} />
        {withTheme && (
          <div>
            <label htmlFor="presentation-theme" className="block text-sm font-medium mb-1.5 text-neutral-500 dark:text-neutral-400">
              {t('presentation.theme')}
            </label>
            {/* w-fit so the chevron stays on the control rather than at the far edge of the dialog. */}
            <SimpleSelect id="presentation-theme" className="w-fit" value={d.themeId} onChange={set('themeId')}>
              <option value="">{t('presentation.themeDefault')}</option>
              {listThemes().map((th) => (
                <option key={th.id} value={th.id}>
                  {th.name}
                </option>
              ))}
            </SimpleSelect>
          </div>
        )}
        <DialogButtons>
          <AppButton variant="cancel" onClick={onClose}>
            {t('common.cancel')}
          </AppButton>
          <AppButton disabled={saving || !d.name.trim()} onClick={() => void save()}>
            {saving && savingText ? savingText : saveText}
          </AppButton>
        </DialogButtons>
      </div>
    </Dialog>
  );
}
