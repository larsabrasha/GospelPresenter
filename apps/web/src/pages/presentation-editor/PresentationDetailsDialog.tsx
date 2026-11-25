import { FIELD_RULES, listThemes } from '@gp/core';
import { useState } from 'react';
import { ownThemes } from '../../db/queries.ts';
import { useData } from '../../db/react.tsx';
import { t } from '../../i18n.ts';
import { themeName } from '../../themes.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { Dialog } from '../../ui/Dialog.tsx';
import { Group, GROUP_ROW, PopUp } from '../../ui/Group.tsx';
import { CheckIcon, CloseIcon } from '../../ui/icons.tsx';
import { withMaxChars } from '../../ui/maxChars.ts';

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

/** The sheet's round ✕ and ✓. */
const ROUND = 'size-11 rounded-full flex items-center justify-center cursor-pointer';
/** A field in a card's row, without a box of its own: the card is its box, as Calendar's fields. */
const BARE = 'w-full min-w-0 bg-transparent outline-none placeholder:text-stone-400 dark:placeholder:text-stone-500';
/** A date's or a time's value at the right of its row, in a grey pill, as Calendar shows one. */
const PILL = 'h-9 px-3 rounded-lg bg-raised dark:bg-raised-2 tabular-nums outline-none focus:ring-2 focus:ring-sky-500 dark:scheme-dark';

/**
 * A presentation's details (Components/Presentations/PresentationDetailsDialog.razor), as Calendar's "Redigera
 * händelse" (Lars, 2026-11-05: the boxes and pills before were a mix): Avbryt and the save at the top, the name and
 * the place in one card, the date and the time in one with their values at the right, the theme a row of its own, and
 * the description last. Used for Skapa and for Redigera detaljer. Enter in the name saves; `onSave` resolves when the
 * dialog may close, with `savingText` on the button until then.
 */
export function PresentationDetailsDialog({
  isNew,
  initial,
  onSave,
  onClose,
}: {
  /** Skapa presentation, or Redigera detaljer of one there, which also asks for the theme. */
  isNew: boolean;
  initial: PresentationDetails;
  onSave: (d: PresentationDetails) => Promise<void> | void;
  onClose: () => void;
}) {
  const title = isNew ? t('presentations.createTitle') : t('presentation.editDetails');
  const saveText = isNew ? t('common.create') : t('common.save');
  const savingText = isNew ? t('common.creating') : undefined;
  const cancelText = t('common.cancel');
  const withTheme = !isNew;
  const [d, setD] = useState(initial);
  const [saving, setSaving] = useState(false);
  const own = useData(ownThemes, []);
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
    <Dialog title={title} onClose={onClose} maxWidthClass="max-w-lg" hideTitle>
      <div className="-m-3 flex flex-col">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center h-16 px-4">
          {/* ✕ and ✓, round, as iOS 27's sheets have them (Lars, 2026-11-05: no words); the words are their names. */}
          <AppButton variant="plain" aria-label={cancelText} title={cancelText} className={`justify-self-start ${ROUND} bg-raised dark:bg-raised-2 hover:bg-stone-200 dark:hover:bg-white/15`} onClick={onClose}>
            <CloseIcon className="size-5" />
          </AppButton>
          <p aria-hidden="true" className="font-semibold text-[17px] truncate">
            {title}
          </p>
          <AppButton
            variant="plain"
            aria-label={saving && savingText ? savingText : saveText}
            title={saveText}
            disabled={saving || !d.name.trim()}
            className={`justify-self-end ${ROUND} bg-sky-500 hover:bg-sky-600 text-white disabled:bg-raised dark:disabled:bg-raised-2 disabled:text-stone-400 dark:disabled:text-stone-500 disabled:cursor-default`}
            onClick={() => void save()}
          >
            <CheckIcon className="size-5" />
          </AppButton>
        </div>
        <div className="bg-ground px-4 pt-2 pb-5 space-y-5 rounded-b-2xl">
          <Group>
            <div className={GROUP_ROW}>
              <input
                // The name first, ready to type over, and Enter saves.
                // eslint-disable-next-line jsx-a11y/no-autofocus -- the dialog is for this
                autoFocus
                aria-label={t('presentation.name')}
                placeholder={t('presentation.name')}
                className={BARE}
                value={d.name}
                onFocus={(e) => e.currentTarget.select()}
                onChange={withMaxChars(FIELD_RULES.name.max, set('name'))}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  e.preventDefault();
                  void save();
                }}
              />
            </div>
            <div className={GROUP_ROW}>
              <input aria-label={t('presentation.location')} placeholder={t('presentation.location')} className={BARE} value={d.location} onChange={withMaxChars(FIELD_RULES.location.max, set('location'))} />
            </div>
          </Group>
          <Group>
            <label className={GROUP_ROW}>
              <span>{t('presentation.date')}</span>
              <input type="date" aria-label={t('presentation.date')} className={PILL} value={d.date} onChange={set('date')} />
            </label>
            <label className={GROUP_ROW}>
              <span>{t('presentation.time')}</span>
              <input type="time" aria-label={t('presentation.time')} className={PILL} value={d.time} onChange={set('time')} />
            </label>
          </Group>
          {withTheme && (
            <Group>
              <label className={GROUP_ROW}>
                <span className="shrink-0">{t('presentation.theme')}</span>
                <PopUp aria-label={t('presentation.theme')} value={d.themeId} onChange={set('themeId')}>
                  <option value="">{t('presentation.themeDefault')}</option>
                  {listThemes(own ?? []).map((th) => (
                    <option key={th.id} value={th.id}>
                      {themeName(th)}
                    </option>
                  ))}
                </PopUp>
              </label>
            </Group>
          )}
          <Group>
            <textarea
              aria-label={t('presentation.description')}
              placeholder={t('presentation.description')}
              rows={4}
              // As tall as its text, from four lines to sixteen (or half the window), then it scrolls (Lars, 2026-11-25:
              // a service's whole order is written here). Where the browser does not size it itself, four lines.
              className={`${BARE} block px-4 py-3 text-sm resize-none [field-sizing:content] min-h-[calc(4lh+1.5rem)] max-h-[min(50vh,calc(16lh+1.5rem))] overflow-y-auto`}
              value={d.description}
              onChange={withMaxChars(FIELD_RULES.description.max, set('description'))}
            />
          </Group>
        </div>
      </div>
    </Dialog>
  );
}
