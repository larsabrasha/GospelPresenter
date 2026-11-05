import { useState } from 'react';
import { useData, useDb, useDbStatus } from '../db/react.tsx';
import { listBibles, type InstalledBible } from '../db/queries.ts';
import { t } from '../i18n.ts';
import { isHostWindow } from '../hostWindow.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { AutoSaveField, useSavedIndicator } from '../ui/AutoSave.tsx';
import { useConfirm } from '../ui/Dialog.tsx';
import { DANGER_ROW, GROUP_ROW, Group, SwitchRow } from '../ui/Group.tsx';
import { CheckIcon } from '../ui/icons.tsx';
import { DetailHeader, PageContainer } from '../ui/PageContainer.tsx';
import { href, navigate } from '../ui/router.ts';
import { useToast } from '../ui/Toast.tsx';

/** Whether this device keeps a translation's text, in a word: for the list's row and the switch's line. */
export function offlineLine(b: InstalledBible, host: boolean): string | null {
  if (host || (b.kept && b.stored)) return t('bibles.offline');
  if (b.kept) return t('bibles.fetching');
  return null;
}

/**
 * A translation, as iOS's Settings has a row's page (Lars, 2026-11-04): its name, saved as it is typed; what it is;
 * whether this device keeps it offline, as a switch (a desktop host keeps every one and shows no switch); and Radera
 * bibel, red in a group of its own, asked first.
 */
export function BibleDetail({ id }: { id: string }) {
  const db = useDb();
  const toast = useToast();
  const { dialog, ask } = useConfirm();
  const saved = useSavedIndicator();
  const bibles = useData(listBibles, []);
  const status = useDbStatus();
  const host = isHostWindow();
  /** A device that keeps nothing between reloads cannot keep a text offline. */
  const persistent = status?.storage === 'opfs';
  const [keeping, setKeeping] = useState(false);
  const bible = bibles?.find((b) => b.id === id);
  if (!bible)
    return (
      <PageContainer>
        <DetailHeader backHref={href({ page: 'bibles' })} title="" className="px-5" />
        <p className={`px-7 ${bibles ? 'text-stone-500 dark:text-stone-400' : 'loading-line text-stone-400'}`}>{bibles ? t('bibles.notFound') : t('common.loading')}</p>
      </PageContainer>
    );

  const keep = async (on: boolean) => {
    if (keeping) return;
    setKeeping(true);
    try {
      const ok = await db.keepBible(bible.id, on);
      toast(t(!on ? 'bibles.offlineRemoved' : ok ? 'bibles.offlineDownloaded' : 'bibles.offlineFailed'));
    } finally {
      setKeeping(false);
    }
  };
  const remove = async () => {
    if (await ask({ title: t('bibles.delete'), text: t('bibles.deleteConfirm', { name: bible.name }), bold: bible.name, confirm: t('bibles.delete'), run: () => db.mutate('deleteBible', { id: bible.id }) })) {
      toast(t('bibles.deleted'));
      navigate({ page: 'bibles' });
    }
  };

  return (
    <PageContainer>
      {dialog}
      <DetailHeader backHref={href({ page: 'bibles' })} title={bible.name} saved={saved.node} className="px-5" />
      <Group>
        <AutoSaveField bare label={t('song.name')} maxLength={200} value={bible.name} onSave={(v) => (v.trim() ? db.mutate('renameBible', { id: bible.id, name: v }) : undefined)} onSaved={saved.show} />
        <p className={GROUP_ROW}>
          <span>{t('bibles.abbreviation')}</span>
          <span className="text-stone-500 dark:text-stone-400">{bible.abbreviation}</span>
        </p>
        <p className={GROUP_ROW}>
          <span>{t('bibles.verses')}</span>
          <span className="text-stone-500 dark:text-stone-400 tabular-nums">{bible.verseCount.toLocaleString()}</span>
        </p>
      </Group>
      {host ? (
        <Group>
          <p className={GROUP_ROW}>
            <span>{t('bibles.offline')}</span>
            <CheckIcon className="size-4 text-sky-500" />
          </p>
        </Group>
      ) : (
        <Group footer={!status || persistent ? undefined : t('bibles.offlineUnavailable')}>
          <SwitchRow
            title={t('bibles.offline')}
            description={bible.kept && !bible.stored ? t('bibles.fetching') : undefined}
            checked={bible.kept}
            disabled={!persistent || keeping}
            onChange={(on) => void keep(on)}
          />
        </Group>
      )}
      <Group>
        <AppButton variant="plain" className={DANGER_ROW} onClick={() => void remove()}>
          {t('bibles.delete')}
        </AppButton>
      </Group>
    </PageContainer>
  );
}
