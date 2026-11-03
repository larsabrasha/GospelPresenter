import { useState } from 'react';
import { BIBLE_ZIP_MAX_BYTES } from '@gp/core';
import { useData, useDb, useDbStatus } from '../db/react.tsx';
import { listBibles, type InstalledBible } from '../db/queries.ts';
import { isTextKey, t } from '../i18n.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { useTrySave } from '../ui/AutoSave.tsx';
import { deleteAsk, useConfirm } from '../ui/Dialog.tsx';
import { DropMore, DropZone } from '../ui/DropZone.tsx';
import { EmptySmall } from '../ui/Empty.tsx';
import { ListSearch, matches, NoMatch } from '../ui/ListSearch.tsx';
import { BookOpenOutlineIcon, CheckIcon, TrashIcon } from '../ui/icons.tsx';
import { ImportFilesButton } from '../ui/ImportFilesButton.tsx';
import { CARD } from '../ui/List.tsx';
import { PageContainer, PageHeader } from '../ui/PageContainer.tsx';
import { useToast } from '../ui/Toast.tsx';
import { isHostWindow } from '../hostWindow.ts';

type Message = { ok: boolean; text: string } | null;

/**
 * Biblar (spec 05 `/admin/bibles`): import a translation from a zip, list
 * them, delete one. Admins only (D24). The zip is read on this device and its
 * text uploaded once. Each device keeps the texts it chose ("Gör tillgänglig
 * offline", BIBLE-R15); a desktop host keeps them all and shows no choice
 * (docs/bibles-and-themes.md, "Bibles").
 */
export function Bibles() {
  const db = useDb();
  const trySave = useTrySave();
  const toast = useToast();
  const { dialog, ask } = useConfirm();
  const bibles = useData(listBibles, []);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const [query, setQuery] = useState('');
  /** The translation being downloaded or removed: one at a time, as the current app. */
  const [keeping, setKeeping] = useState<string | null>(null);
  const status = useDbStatus();
  const host = isHostWindow();
  /** A device that keeps nothing between reloads cannot keep a text offline. */
  const persistent = status?.storage === 'opfs';

  const keep = async (b: InstalledBible, on: boolean) => {
    if (keeping) return;
    setKeeping(b.id);
    try {
      const ok = await db.keepBible(b.id, on);
      toast(t(!on ? 'bibles.offlineRemoved' : ok ? 'bibles.offlineDownloaded' : 'bibles.offlineFailed'));
    } finally {
      setKeeping(null);
    }
  };

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

  const shown = bibles?.filter((b) => matches(query, b.name, b.abbreviation)) ?? [];

  const remove = async (b: InstalledBible) => {
    let saved = false;
    if (!(await ask(deleteAsk(t('bibles.deleteConfirm', { name: b.name }), b.name, async () => (saved = await trySave(db.mutate('deleteBible', { id: b.id }))))))) return;
    if (!saved) return;
    toast(t('bibles.deleted'));
  };

  return (
    <PageContainer>
      <DropZone className="flex flex-col space-y-5" label={t('bibles.dropHere')} accept=".zip" multiple={false} onFiles={(files) => void importFile(files[0])}>
        {dialog}
        {/* As Bilder, Ljud and Videor (Lars, 2026-11-03): + floats at the bottom right and takes a zip file. */}
        <PageHeader title={t('bibles.title')}>
          <ImportFilesButton round accept=".zip" busy={busy} testId="bible-file" onFiles={(files) => void importFile(files[0])} />
        </PageHeader>
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
        {!!bibles?.length && <ListSearch query={query} onChange={setQuery} />}
        {!!bibles?.length && !shown.length && <NoMatch query={query} />}
        {/* None yet: the empty list itself is the place to drop the zip file; else the list, and that place under it. */}
        {bibles && !bibles.length && <EmptySmall icon={<BookOpenOutlineIcon className="size-12 mb-3 text-stone-300 dark:text-stone-600" />} title={t('bibles.empty')} dropHint={t('bibles.dropHere')} />}
        {!!shown.length && (
        <div className={CARD}>
          <ul aria-label={t('bibles.title')}>
            {shown.map((b) => (
              <li key={b.id} className="flex items-center gap-3 px-5 py-3 border-b border-separator last:border-b-0">
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{b.name}</div>
                  <div className="text-xs text-stone-400 truncate">{t('bibles.row', { abbreviation: b.abbreviation, n: b.verseCount })}</div>
                </div>
                {host ? (
                  <span className="inline-flex items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400">
                    <CheckIcon className="size-4 text-green-500" />
                    {t('bibles.offline')}
                  </span>
                ) : (
                  persistent && <OfflineState bible={b} busy={keeping} onKeep={(on) => void keep(b, on)} />
                )}
                <AppButton variant="dangerIcon" aria-label={`${t('common.delete')} ${b.name}`} onClick={() => void remove(b)}>
                  <TrashIcon className="size-4" />
                </AppButton>
              </li>
            ))}
          </ul>
        </div>
        )}
        {!!bibles?.length && <p className="text-center text-sm text-stone-500 dark:text-stone-400">{t(bibles.length === 1 ? 'bibles.count.one' : 'bibles.count.many', { n: bibles.length })}</p>}
        {/* What a bible file is, and why this device keeps none offline, in grey under the list as iOS's footers. */}
        <p className="px-4 text-xs text-stone-500 dark:text-stone-400">
          {t('bibles.importText')}
          {!host && status && !persistent && !!bibles?.length && ` ${t('bibles.offlineUnavailable')}`}
        </p>
        {!!bibles?.length && <DropMore text={t('bibles.dropHere')} />}
      </DropZone>
    </PageContainer>
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

function OfflineState({ bible: b, busy, onKeep }: { bible: InstalledBible; busy: string | null; onKeep: (on: boolean) => void }) {
  if (b.kept && b.stored) {
    return (
      <AppButton
        variant="neutral"
        title={t('bibles.removeOffline')}
        loading={busy === b.id}
        disabled={busy !== null}
        className="inline-flex items-center gap-1.5"
        onClick={() => onKeep(false)}
      >
        {busy !== b.id && <CheckIcon className="size-4 text-green-500" />}
        {t('bibles.offline')}
      </AppButton>
    );
  }
  if (b.kept) return <span className="text-xs text-stone-400">{t('bibles.fetching')}</span>;
  if (b.stored) return <span className="text-xs text-stone-400">{t('bibles.offline')}</span>;
  return (
    <AppButton variant="secondary" loading={busy === b.id} disabled={busy !== null} onClick={() => onKeep(true)}>
      {t('bibles.makeOffline')}
    </AppButton>
  );
}
