import { isProPresenterFile, parseProPresenter, type Song } from '@gp/core';
import { useState } from 'react';
import { songPartsOf } from '../db/queries.ts';
import { useDb } from '../db/react.tsx';
import { t } from '../i18n.ts';
import { newId } from '../ids.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { useTrySave } from '../ui/AutoSave.tsx';
import { Dialog, DialogButtons } from '../ui/Dialog.tsx';
import { SimpleSelect } from '../ui/SimpleInput.tsx';
import { DropHint } from '../ui/DropZone.tsx';
import { ArrowDownTrayIcon } from '../ui/icons.tsx';
import { CARD } from '../ui/List.tsx';
import {
  choicesFor,
  defaultChoice,
  IMPORT_BATCH,
  importResult,
  importResultText,
  MAX_PRO_BYTES,
  namesakes,
  planImport,
  songsToSend,
  songText,
  type Duplicate,
  type DuplicateChoice,
  type ImportPlan,
} from './songImport.ts';

type Stage = 'reading' | 'asking' | 'saving' | null;

/**
 * The ProPresenter import of Sånger (spec 02 "Import card", SONG-R35–R44; Songs.razor): the files are
 * read here; when the library or the import has some of the names already, the duplicate dialog asks
 * for each, showing whether the text is the same; the songs are written in one `importSongs` mutation. `files` takes chosen or dropped files; `card` and `dialog` go
 * into the page.
 */
export function useSongImport(library: Song[] | undefined) {
  const db = useDb();
  const trySave = useTrySave();
  const [stage, setStage] = useState<Stage>(null);
  const [plan, setPlan] = useState<{ plan: ImportPlan; failed: number; choices: DuplicateChoice[] } | null>(null);
  const [shownText, setShownText] = useState<Set<number>>(new Set());
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  // How many of the files have been read; the save after is one mutation, so it has no count.
  const [readCount, setReadCount] = useState({ done: 0, total: 0 });

  const save = async (p: ImportPlan, failed: number, choices: DuplicateChoice[]) => {
    setStage('saving');
    const songs = songsToSend(p, choices);
    // One mutation is all or nothing (SONG-R44); only an import of more songs than one takes goes in several.
    for (let i = 0; i < songs.length; i += IMPORT_BATCH) {
      if (!(await trySave(db.mutate('importSongs', { songs: songs.slice(i, i + IMPORT_BATCH) })))) {
        setStage(null);
        return;
      }
    }
    setStage(null);
    setMessage({ text: importResultText(importResult(p, choices, failed)), error: false });
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
    // The library songs with a name the files have, with their text, to compare with.
    const others = namesakes(read, library ?? []);
    const parts = await songPartsOf(db, others.map((s) => s.id));
    const p = planImport(
      read,
      others.map((s) => ({ id: s.id, name: s.name, text: songText(parts.filter((x) => x.songId === s.id)) })),
      newId,
    );
    if (!p.songs.length) {
      setStage(null);
      return setMessage({ text: importResultText(importResult(p, [], failed)), error: false });
    }
    if (p.duplicates.length) {
      setShownText(new Set());
      setPlan({ plan: p, failed, choices: p.duplicates.map(defaultChoice) });
      return setStage('asking');
    }
    await save(p, failed, []);
  };

  const cancel = () => {
    setPlan(null);
    setStage(null);
  };
  const confirm = () => {
    const asked = plan;
    setPlan(null);
    if (asked) void save(asked.plan, asked.failed, asked.choices);
  };
  const choose = (i: number, choice: DuplicateChoice) =>
    setPlan((p) => p && { ...p, choices: p.choices.map((c, j) => (j === i ? choice : c)) });
  /** Sets every duplicate that offers the choice; replacing leaves those met earlier in the import as they are. */
  const chooseAll = (choice: DuplicateChoice) =>
    setPlan((p) => p && { ...p, choices: p.plan.duplicates.map((d, j) => (choicesFor(d).includes(choice) ? choice : p.choices[j]!)) });
  const toggleText = (i: number) =>
    setShownText((shown) => {
      const next = new Set(shown);
      if (!next.delete(i)) next.add(i);
      return next;
    });

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
    <Dialog title={t('songs.import.dupTitle')} onClose={cancel} maxWidthClass="max-w-3xl">
      <p className="text-sm text-neutral-600 dark:text-neutral-300">{t('songs.import.dupText', { n: plan.plan.duplicates.length, m: plan.plan.songs.length })}</p>
      <div className="flex flex-wrap items-center gap-2 text-sm text-neutral-500 dark:text-neutral-400">
        {t('songs.import.all')}
        {(['skip', 'replace', 'keep'] as const).map((c) => (
          <AppButton key={c} variant="neutral" className="py-1.5! px-3!" onClick={() => chooseAll(c)}>
            {t(`songs.import.choice.${c}`)}
          </AppButton>
        ))}
      </div>
      <ul className="max-h-[50vh] overflow-y-auto rounded-lg border-[0.5px] border-neutral-200 dark:border-neutral-700 divide-y-[0.5px] divide-neutral-200 dark:divide-neutral-700 text-sm" aria-label={t('songs.import.dupTitle')}>
        {plan.plan.duplicates.map((d, i) => (
          <DuplicateRow key={d.index} duplicate={d} choice={plan.choices[i]!} onChoose={(c) => choose(i, c)} shown={shownText.has(i)} onToggle={() => toggleText(i)} />
        ))}
      </ul>
      <DialogButtons>
        <AppButton variant="cancel" onClick={cancel}>
          {t('common.cancel')}
        </AppButton>
        <AppButton onClick={confirm}>{t('songs.import.import')}</AppButton>
      </DialogButtons>
    </Dialog>
  );

  return { files, card, dialog, busy };
}

/** One song of the duplicate dialog: its name, whether its text is the same, its choice, and both texts when shown. */
function DuplicateRow({ duplicate: d, choice, onChoose, shown, onToggle }: { duplicate: Duplicate; choice: DuplicateChoice; onChoose: (c: DuplicateChoice) => void; shown: boolean; onToggle: () => void }) {
  const text = (title: string, body: string) => (
    <div className="min-w-0">
      <div className="text-xs font-medium text-neutral-400 dark:text-neutral-500 mb-1">{title}</div>
      <pre className="whitespace-pre-wrap font-sans text-sm max-h-60 overflow-y-auto rounded-lg bg-neutral-50 dark:bg-neutral-900/50 p-3">{body}</pre>
    </div>
  );
  return (
    <li className="px-3 py-2 space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="min-w-0 flex-1 truncate font-medium">{d.name}</span>
        <span
          className={`px-2 py-0.5 rounded-full text-xs font-medium ${d.same ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400'}`}
        >
          {d.same ? t('songs.import.same') : t('songs.import.different')}
        </span>
        <AppButton variant="cancel" className="py-1.5! px-3!" aria-expanded={shown} onClick={onToggle}>
          {shown ? t('songs.import.hideText') : t('songs.import.showText')}
        </AppButton>
        <SimpleSelect aria-label={t('songs.import.choiceFor', { name: d.name })} value={choice} onChange={(e) => onChoose(e.target.value as DuplicateChoice)}>
          {choicesFor(d).map((c) => (
            <option key={c} value={c}>
              {t(`songs.import.choice.${c}`)}
            </option>
          ))}
        </SimpleSelect>
      </div>
      {shown && (
        <div className="grid gap-3 sm:grid-cols-2">
          {text(d.other.id ? t('songs.import.inLibrary') : t('songs.import.earlier'), d.other.text)}
          {text(t('songs.import.inFile'), d.text)}
        </div>
      )}
    </li>
  );
}
