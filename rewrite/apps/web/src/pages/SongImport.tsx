import { isProPresenterFile, parseProPresenter, type Song } from '@gp/core';
import { useState } from 'react';
import { useDb } from '../db/react.tsx';
import { t } from '../i18n.ts';
import { newId } from '../ids.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { useTrySave } from '../ui/AutoSave.tsx';
import { Dialog, DialogButtons } from '../ui/Dialog.tsx';
import { DropHint } from '../ui/DropZone.tsx';
import { ArrowDownTrayIcon } from '../ui/icons.tsx';
import { CARD } from '../ui/List.tsx';
import { IMPORT_BATCH, importResult, importResultText, MAX_PRO_BYTES, planImport, type ImportPlan } from './songImport.ts';

type Stage = 'reading' | 'asking' | 'saving' | null;

/**
 * The ProPresenter import of Sånger (spec 02 "Import card", SONG-R35–R44; Songs.razor): the files are
 * read here, a duplicate question is asked when the library has some of the names, and the songs are
 * written in one `importSongs` mutation. `files` takes chosen or dropped files; `card` and `dialog` go
 * into the page.
 */
export function useSongImport(library: Song[] | undefined) {
  const db = useDb();
  const trySave = useTrySave();
  const [stage, setStage] = useState<Stage>(null);
  const [plan, setPlan] = useState<{ plan: ImportPlan; failed: number } | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  // How many of the files have been read; the save after is one mutation, so it has no count.
  const [readCount, setReadCount] = useState({ done: 0, total: 0 });

  const save = async (p: ImportPlan, failed: number, replace: boolean) => {
    setStage('saving');
    // One mutation is all or nothing (SONG-R44); only an import of more songs than one takes goes in several.
    for (let i = 0; i < p.songs.length; i += IMPORT_BATCH) {
      if (!(await trySave(db.mutate('importSongs', { songs: p.songs.slice(i, i + IMPORT_BATCH), replace })))) {
        setStage(null);
        return;
      }
    }
    setStage(null);
    setMessage({ text: importResultText(importResult(p, replace, failed)), error: false });
  };

  const files = async (chosen: File[]) => {
    if (stage) return;
    const pro = chosen.filter((f) => isProPresenterFile(f.name));
    if (!pro.length) return setMessage({ text: t('songs.import.none'), error: true });
    setMessage(null);
    setStage('reading');
    const read = [];
    let failed = 0;
    for (const [i, f] of pro.entries()) {
      setReadCount({ done: i, total: pro.length });
      const song = f.size > MAX_PRO_BYTES ? null : parseProPresenter(new Uint8Array(await f.arrayBuffer()), f.name.replace(/\.pro$/i, ''));
      if (song) read.push(song);
      else failed++;
    }
    const p = planImport(read, (library ?? []).map((s) => s.name), newId);
    if (!p.songs.length) {
      setStage(null);
      return setMessage({ text: importResultText(importResult(p, false, failed)), error: false });
    }
    if (p.duplicates.length) {
      setPlan({ plan: p, failed });
      return setStage('asking');
    }
    await save(p, failed, false);
  };

  const answer = (replace: boolean | null) => {
    const asked = plan;
    setPlan(null);
    if (!asked || replace === null) return setStage(null);
    void save(asked.plan, asked.failed, replace);
  };

  const busy = stage !== null;
  const card = (
    <div className={`${CARD} p-5 space-y-3`}>
      <div>
        <h2 className="text-base/6 font-semibold">{t('songs.import.title')}</h2>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">{t('songs.import.text')}</p>
      </div>
      <div className="flex items-center gap-3">
        <AppButton asLabel disabled={busy} className="inline-flex items-center gap-1.5">
          <ArrowDownTrayIcon className="size-4 shrink-0" />
          {busy ? t('songs.import.busy') : t('songs.import.choose')}
          <input
            type="file"
            accept=".pro"
            multiple
            hidden
            disabled={busy}
            data-testid="pro-file"
            onChange={(e) => {
              void files([...(e.target.files ?? [])]);
              e.target.value = '';
            }}
          />
        </AppButton>
        <DropHint text={t('songs.import.dropHint')} />
      </div>
      {(stage === 'reading' || stage === 'saving') && (
        <div className="space-y-2" role="status">
          <p className="text-sm text-neutral-600 dark:text-neutral-300">
            {stage === 'reading' ? t('songs.import.reading', { n: readCount.done, m: readCount.total }) : t('songs.import.saving')}
          </p>
          <div className="w-full h-2 rounded-full bg-neutral-200 dark:bg-neutral-700 overflow-hidden">
            {stage === 'reading' ? (
              <div className="h-2 rounded-full bg-sky-500 transition-[width]" style={{ width: `${(readCount.done / Math.max(readCount.total, 1)) * 100}%` }} />
            ) : (
              <div className="h-2 w-1/3 rounded-full bg-sky-500 animate-pulse" />
            )}
          </div>
        </div>
      )}
      {message && (
        <p role={message.error ? 'alert' : 'status'} className={`text-sm ${message.error ? 'text-red-600 dark:text-red-400' : 'text-green-700 dark:text-green-400'}`}>
          {message.text}
        </p>
      )}
    </div>
  );

  const dialog = plan && (
    <Dialog title={t('songs.import.dupTitle')} onClose={() => answer(null)} maxWidthClass="max-w-lg">
      <p className="text-sm text-neutral-600 dark:text-neutral-300">{t('songs.import.dupText', { n: plan.plan.duplicates.length, m: plan.plan.songs.length })}</p>
      <ul className="max-h-60 overflow-y-auto rounded-lg border-[0.5px] border-neutral-200 dark:border-neutral-700 divide-y-[0.5px] divide-neutral-200 dark:divide-neutral-700 text-sm" aria-label={t('songs.import.dupTitle')}>
        {plan.plan.duplicates.map((name, i) => (
          <li key={i} className="px-3 py-2 truncate">
            {name}
          </li>
        ))}
      </ul>
      <DialogButtons>
        <AppButton variant="cancel" onClick={() => answer(null)}>
          {t('common.cancel')}
        </AppButton>
        <AppButton variant="secondary" onClick={() => answer(false)}>
          {t('songs.import.skip')}
        </AppButton>
        <AppButton onClick={() => answer(true)}>{t('songs.import.replace')}</AppButton>
      </DialogButtons>
    </Dialog>
  );

  return { files, card, dialog, busy };
}
