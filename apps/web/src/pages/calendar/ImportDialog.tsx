import { eventsFromSheet, EVENT_LIMITS, readSheet, type SheetEvents } from '@gp/core';
import { useState } from 'react';
import { useDb } from '../../db/react.tsx';
import { t } from '../../i18n.ts';
import { newId } from '../../ids.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { useTrySave } from '../../ui/AutoSave.tsx';
import { Dialog, DialogButtons } from '../../ui/Dialog.tsx';
import { useToast } from '../../ui/Toast.tsx';
import { loadPeople } from './data.ts';

// Importera från Excel (docs/planning.md, "Import"): a sheet read on this device, what it gave shown before anything
// is saved (how many events, the rows whose date did not read), then written in batches the core takes at once.

export function ImportDialog({ today, onClose }: { today: string; onClose: () => void }) {
  const db = useDb();
  const trySave = useTrySave();
  const toast = useToast();
  const [read, setRead] = useState<SheetEvents | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setFailed(false);
    try {
      const rows = readSheet(new Uint8Array(await file.arrayBuffer()));
      setRead(eventsFromSheet(rows, { today, members: await loadPeople(), newId }));
    } catch {
      setRead(null);
      setFailed(true);
    }
  };

  const run = async () => {
    if (!read || busy) return;
    setBusy(true);
    let ok = true;
    for (let i = 0; ok && i < read.events.length; i += EVENT_LIMITS.importAtOnce)
      ok = await trySave(db.mutate('importEvents', { events: read.events.slice(i, i + EVENT_LIMITS.importAtOnce), at: Date.now() }));
    setBusy(false);
    if (!ok) return;
    toast(t('import.done', { n: read.events.length }));
    onClose();
  };

  const persons = read?.events.reduce((n, e) => n + e.fields.reduce((m, f) => m + f.entries.filter((x) => 'person' in x).length, 0), 0) ?? 0;
  return (
    <Dialog title={t('calendar.import')} onClose={onClose}>
      <p className="text-sm text-stone-600 dark:text-stone-300">{t('import.hint')}</p>
      <label className="inline-flex items-center gap-2 h-9 px-4 rounded-full bg-raised text-sm cursor-pointer hover:bg-raised-2">
        {t('import.pick')}
        <input type="file" data-testid="sheet-file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" onChange={(e) => void pick(e.target.files?.[0])} />
      </label>
      {failed && <p className="text-sm text-red-600 dark:text-red-400">{t('import.failed')}</p>}
      {read && (
        <div className="space-y-2 text-sm">
          <p className="font-medium">{t('import.read', { n: read.events.length })}</p>
          {persons > 0 && <p className="text-stone-500 dark:text-stone-400">{t('import.persons', { n: persons })}</p>}
          {read.skipped.length > 0 && (
            <>
              <p className="text-stone-500 dark:text-stone-400">{t('import.skipped', { n: read.skipped.length })}</p>
              <ul className="max-h-40 overflow-y-auto rounded-lg bg-raised px-3 py-2 space-y-1 text-xs">
                {read.skipped.map((s) => (
                  <li key={s.row}>
                    <span className="text-stone-400">{t('import.row', { n: s.row })}</span> {s.text}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      <DialogButtons>
        <AppButton variant="cancel" onClick={onClose}>
          {t('common.cancel')}
        </AppButton>
        <AppButton disabled={!read?.events.length || busy} onClick={() => void run()}>
          {t('import.run', { n: read?.events.length ?? 0 })}
        </AppButton>
      </DialogButtons>
    </Dialog>
  );
}
