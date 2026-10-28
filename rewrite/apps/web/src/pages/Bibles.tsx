import { useState } from 'react';
import { BIBLE_ZIP_MAX_BYTES } from '@gp/core';
import { useData, useDb, useDbStatus } from '../db/react.tsx';
import { listBibles, type InstalledBible } from '../db/queries.ts';
import { t } from '../i18n.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { useConfirm } from '../ui/Dialog.tsx';
import { DropHint, DropZone } from '../ui/DropZone.tsx';
import { ArrowDownTrayIcon, BookOpenOutlineIcon, CheckIcon, TrashIcon } from '../ui/icons.tsx';
import { CARD } from '../ui/List.tsx';
import { PageContainer, PageHeader } from '../ui/PageContainer.tsx';
import { useToast } from '../ui/Toast.tsx';

type Message = { ok: boolean; text: string } | null;

/**
 * Biblar (spec 05 `/admin/bibles`): import a translation from a zip, list
 * them, delete one. Admins only (D24). The zip is read on this device and its
 * text uploaded once. Each device keeps the texts it chose ("Gör tillgänglig
 * offline", BIBLE-R15); a desktop host keeps them all and shows no choice
 * (README, "Bibles").
 */
export function Bibles() {
  const db = useDb();
  const toast = useToast();
  const { dialog, ask } = useConfirm();
  const bibles = useData(listBibles, []);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  /** The translation being downloaded or removed: one at a time, as the current app. */
  const [keeping, setKeeping] = useState<string | null>(null);
  const status = useDbStatus();
  const host = !!window.gpDesktop?.isHost;
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
      const done = t(r.replaced ? 'bibles.updated' : 'bibles.imported', { name: r.name, n: r.verses.toLocaleString('sv-SE') });
      setMessage({ ok: true, text: r.queued ? `${done} ${t('bibles.queued')}` : done });
    } catch (e) {
      setMessage({ ok: false, text: t('bibles.failed', { error: e instanceof Error ? e.message : String(e) }) });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (b: InstalledBible) => {
    if (!(await ask({ title: t('bibles.deleteTitle'), text: t('bibles.deleteConfirm', { name: b.name }), confirm: t('common.delete') }))) return;
    await db.mutate('deleteBible', { id: b.id });
    toast(t('bibles.deleted'));
  };

  return (
    <PageContainer>
      <DropZone className="flex flex-col space-y-5 min-h-[60vh]" label={t('bibles.dropHere')} onFiles={(files) => void importFile(files[0])}>
        {dialog}
        <PageHeader title={t('bibles.title')} />
        <div className={`${CARD} p-5 space-y-4`}>
          <h2 className="text-base/6 font-semibold">{t('bibles.importTitle')}</h2>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">{t('bibles.importText')}</p>
          <AppButton asLabel disabled={busy} className="inline-flex items-center gap-2">
            <ArrowDownTrayIcon className="size-4" />
            {busy ? t('bibles.importing') : t('bibles.chooseFile')}
            <input
              type="file"
              accept=".zip"
              hidden
              disabled={busy}
              data-testid="bible-file"
              onChange={(e) => {
                void importFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </AppButton>
          <DropHint text={t('bibles.orDrop')} className="hidden sm:inline ml-3" />
          {busy && (
            <div className="space-y-2" role="status">
              <div className="text-sm text-neutral-600 dark:text-neutral-300">{t('bibles.processing')}</div>
              <div className="w-full bg-neutral-200 dark:bg-neutral-700 rounded-full h-2 overflow-hidden">
                <div className="bg-sky-500 h-2 rounded-full w-1/3 animate-pulse" />
              </div>
            </div>
          )}
          {message && (
            <p className={`text-sm ${message.ok ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`} role="status" data-testid="bible-import-message">
              {message.text}
            </p>
          )}
        </div>
        <div className={CARD}>
          <div className="px-5 pt-4 pb-2">
            <h2 className="text-base/6 font-semibold">{t('bibles.installed', { count: bibles?.length ?? 0 })}</h2>
            {!host && status && !persistent && !!bibles?.length && <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">{t('bibles.offlineUnavailable')}</p>}
          </div>
          {bibles && !bibles.length && (
            <div className="flex flex-col items-center justify-center py-12 text-neutral-400">
              <BookOpenOutlineIcon className="size-16 mb-4" />
              <p className="text-sm">{t('bibles.empty')}</p>
            </div>
          )}
          <ul aria-label={t('bibles.title')}>
            {bibles?.map((b) => (
              <li key={b.id} className="flex items-center gap-3 px-5 py-3 border-b border-neutral-200 dark:border-neutral-700 last:border-b-0">
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{b.name}</div>
                  <div className="text-xs text-neutral-400 truncate">{t('bibles.row', { abbreviation: b.abbreviation, n: b.verseCount.toLocaleString('sv-SE') })}</div>
                </div>
                {host ? (
                  b.stored ? (
                    <span className="inline-flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
                      <CheckIcon className="size-4 text-green-500" />
                      {t('bibles.offline')}
                    </span>
                  ) : (
                    <span className="text-xs text-neutral-400">{t('bibles.fetching')}</span>
                  )
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
      </DropZone>
    </PageContainer>
  );
}

/**
 * A translation's offline state on a device that chooses (Bibles.razor): a
 * button to keep it, a grey button that removes the kept copy, the download
 * on its way, or a text that stays here because an import of it is queued.
 */
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
  if (b.kept) return <span className="text-xs text-neutral-400">{t('bibles.fetching')}</span>;
  if (b.stored) return <span className="text-xs text-neutral-400">{t('bibles.offline')}</span>;
  return (
    <AppButton variant="secondary" loading={busy === b.id} disabled={busy !== null} onClick={() => onKeep(true)}>
      {t('bibles.makeOffline')}
    </AppButton>
  );
}
