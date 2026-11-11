import { useState } from 'react';
import { BIBLE_ZIP_MAX_BYTES } from '@gp/core';
import { useData, useDb, useDbStatus } from '../db/react.tsx';
import { listBibles } from '../db/queries.ts';
import { isTextKey, t } from '../i18n.ts';
import { BookOpenOutlineIcon } from '../ui/icons.tsx';
import { ImportFilesButton } from '../ui/ImportFilesButton.tsx';
import { Library } from '../ui/Library.tsx';
import { isHostWindow } from '../hostWindow.ts';
import { href } from '../ui/router.ts';
import { offlineLine } from './BibleDetail.tsx';

type Message = { ok: boolean; text: string } | null;

/**
 * Biblar (spec 05 `/admin/bibles`): import a translation from a zip, list them; a row opens its page
 * (BibleDetail.tsx), which renames it, keeps it offline and deletes it. Admins only (D24). The zip is read on this
 * device and its text uploaded once. Each device keeps the texts it chose ("Tillgänglig offline", BIBLE-R15); a
 * desktop host keeps them all and shows no choice (docs/bibles-and-themes.md, "Bibles").
 */
export function Bibles() {
  const db = useDb();
  const bibles = useData(listBibles, []);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const status = useDbStatus();
  const host = isHostWindow();
  /** A device that keeps nothing between reloads cannot keep a text offline. */
  const persistent = status?.storage === 'opfs';

  const importFile = async (file: File | undefined) => {
    if (!file || busy) return;
    if (!file.name.toLowerCase().endsWith('.zip')) return setMessage({ ok: false, text: t('bibles.onlyZip') });
    if (file.size > BIBLE_ZIP_MAX_BYTES) return setMessage({ ok: false, text: t('bibles.failed', { error: t('bibles.tooLarge') }) });
    setBusy(true);
    setMessage(null);
    try {
      const r = await db.importBible(new Uint8Array(await file.arrayBuffer()));
      const done = t(r.replaced ? 'bibles.updated' : 'bibles.imported', { name: r.name, n: r.verses });
      setMessage({ ok: true, text: r.queued ? `${done} ${t('bibles.queued')}` : done });
    } catch (e) {
      setMessage({ ok: false, text: t('bibles.failed', { error: importErrorText(e) }) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Library
      title={t('bibles.title')}
      items={bibles}
      words={(b) => [b.abbreviation]}
      layout="list"
      // Whether it is offline in grey, as iOS's rows say a value; its page has the switch, the name and Radera.
      renderRow={(b) => ({ subtitle: t('bibles.row', { abbreviation: b.abbreviation, n: b.verseCount }), end: <span className="text-sm text-stone-500 dark:text-stone-400">{offlineLine(b, host)}</span> })}
      open={(b) => href({ page: 'bible', id: b.id })}
      manage
      remove={{
        ask: (items) => (items.length === 1 ? { text: t('bibles.deleteConfirm', { name: items[0]!.name }), bold: items[0]!.name } : { text: t('bibles.deleteMany', { n: items.length }) }),
        done: (items) => (items.length === 1 ? t('bibles.deleted') : t('bibles.deletedMany', { n: items.length })),
        run: (b) => db.mutate('deleteBible', { id: b.id }),
      }}
      add={<ImportFilesButton round accept=".zip" busy={busy} testId="bible-file" onFiles={(files) => void importFile(files[0])} />}
      notices={
        <>
          {busy && (
            <div className="px-5 space-y-2" role="status">
              <div className="text-sm text-stone-600 dark:text-stone-300">{t('bibles.processing')}</div>
              <div className="w-full bg-stone-200 dark:bg-raised rounded-full h-2 overflow-hidden">
                <div className="bg-sky-500 h-2 rounded-full w-1/3 animate-pulse" />
              </div>
            </div>
          )}
          {message && (
            <p className={`px-5 text-sm ${message.ok ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`} role="status" data-testid="bible-import-message">
              {message.text}
            </p>
          )}
        </>
      }
      loading={t('common.loading')}
      empty={{ icon: <BookOpenOutlineIcon className="size-12 mb-3 text-stone-300 dark:text-stone-600" />, title: t('bibles.empty'),
        // Where a translation comes from, here rather than in the footer, which an empty list does not show.
        text: t('bibles.emptyText'),
        action: <ImportFilesButton accept=".zip" busy={busy} testId="bible-file" label={t('bibles.emptyImport')} onFiles={(files) => void importFile(files[0])} />,
      }}
      count={(n) => t(n === 1 ? 'bibles.count.one' : 'bibles.count.many', { n })}
      // What a bible file is, and why this device keeps none offline, in grey under the list as iOS's footers.
      footer={
        !!bibles?.length && (
          <p className="px-4 text-xs text-stone-500 dark:text-stone-400">
            {t('bibles.importText')}
            {!host && status && !persistent && ` ${t('bibles.offlineUnavailable')}`}
          </p>
        )
      }
      drop={{ label: t('bibles.dropHere'), accept: '.zip', multiple: false, onFiles: (files) => void importFile(files[0]) }}
      testId="bible"
    />
  );
}

/**
 * A translation's offline state on a device that chooses (Bibles.razor): a
 * button to keep it, a grey button that removes the kept copy, the download
 * on its way, or a text that stays here because an import of it is queued.
 */
/** Why an import was refused, in the page's language: the core's reason, or what the worker said. */
function importErrorText(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  const key = `bibles.error.${message}`;
  return isTextKey(key) ? t(key) : message;
}

