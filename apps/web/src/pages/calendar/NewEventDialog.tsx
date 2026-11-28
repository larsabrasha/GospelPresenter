import { useState } from 'react';
import { useData, useDb } from '../../db/react.tsx';
import { t } from '../../i18n.ts';
import { newId } from '../../ids.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { useTrySave } from '../../ui/AutoSave.tsx';
import { Dialog, DialogButtons } from '../../ui/Dialog.tsx';
import { GROUP_ROW } from '../../ui/Group.tsx';
import { CARD, ROW_HOVER, RowChevron } from '../../ui/List.tsx';
import { navigate } from '../../ui/router.ts';
import { DEFAULT_FIELDS, eventTemplates } from './data.ts';

// Ny händelse (docs/planning.md, "Templates"): its date, and which template it starts from, or none. While the
// organisation has no template, Gudstjänst with the usual fields is offered in its place.

/** A new event's times without a template: an hour, as iOS gives one, at the church's usual 11 (Lars, 2026-11-28). */
export const NEW_HOUR = { time: '11:00', endTime: '12:00' };

/** When a change is made, as the mutators take it. */
const stamp = () => Date.now();

const PILL = 'h-9 px-3 rounded-lg bg-raised dark:bg-raised-2 tabular-nums outline-none focus:ring-2 focus:ring-sky-500 dark:scheme-dark';

export function NewEventDialog({ today, onClose }: { today: string; onClose: () => void }) {
  const db = useDb();
  const trySave = useTrySave();
  const templates = useData(eventTemplates, []);
  const [date, setDate] = useState(today);
  const [busy, setBusy] = useState(false);

  /** Makes the event and opens it: from `template`, else with `fields` (the built-in Gudstjänst's) or none. */
  const make = async (title: string, template: string | null, fields: string[] = []) => {
    if (busy || !date) return;
    setBusy(true);
    const id = newId();
    const ok = await trySave(db.mutate('createEvent', { id, title, date, ...(template ? { template } : NEW_HOUR), at: stamp() }));
    for (const name of ok ? fields : []) await trySave(db.mutate('addEventField', { id: newId(), eventId: id, name }));
    setBusy(false);
    if (ok) navigate({ page: 'event', id });
  };

  const choices = templates?.length
    ? templates.map((tp) => ({ key: tp.id, title: tp.title || t('calendar.untitled'), detail: tp.fields.join(', '), run: () => make(tp.title, tp.id) }))
    : [{ key: 'default', title: t('calendar.defaultTemplate'), detail: DEFAULT_FIELDS.join(', '), run: () => make(t('calendar.defaultTemplate'), null, DEFAULT_FIELDS) }];

  return (
    <Dialog title={t('calendar.new')} onClose={onClose}>
      <label className={`${GROUP_ROW} px-0`}>
        <span>{t('event.date')}</span>
        <input type="date" required aria-label={t('event.date')} className={PILL} value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <p className="text-sm text-stone-500 dark:text-stone-400">{t('calendar.pickTemplate')}</p>
      <ul className={CARD} aria-label={t('calendar.pickTemplate')}>
        {[...choices, { key: 'none', title: t('calendar.noTemplate'), detail: t('calendar.noTemplateDetail'), run: () => make('', null) }].map((c) => (
          <li key={c.key} className={`border-b border-separator last:border-b-0 ${ROW_HOVER}`}>
            <AppButton variant="plain" disabled={busy || !date} className="w-full flex items-center gap-3 px-4 py-2.5 text-left cursor-pointer" onClick={() => void c.run()}>
              <span className="flex-1 min-w-0">
                <span className="block truncate">{c.title}</span>
                <span className="block text-xs text-stone-400 truncate">{c.detail}</span>
              </span>
              <RowChevron />
            </AppButton>
          </li>
        ))}
      </ul>
      <DialogButtons>
        <AppButton variant="cancel" onClick={onClose}>
          {t('common.cancel')}
        </AppButton>
      </DialogButtons>
    </Dialog>
  );
}
