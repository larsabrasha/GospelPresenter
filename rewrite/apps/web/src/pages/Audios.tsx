import { useState } from 'react';
import { can, type LibraryAudio, type Role } from '@gp/core';
import { useData, useDb } from '../db/react.tsx';
import { listAudios } from '../db/queries.ts';
import { t } from '../i18n.ts';
import { AUDIO_ACCEPT, useMediaImport } from '../media/imports.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { useTrySave } from '../ui/AutoSave.tsx';
import { DropHint, DropZone } from '../ui/DropZone.tsx';
import { CardNote, EmptySmall } from '../ui/Empty.tsx';
import { SpeakerWaveIcon, TrashIcon } from '../ui/icons.tsx';
import { CARD } from '../ui/List.tsx';
import { PageContainer, PageHeader } from '../ui/PageContainer.tsx';
import { SearchField } from '../ui/Picker.tsx';
import { href } from '../ui/router.ts';
import { useToast } from '../ui/Toast.tsx';
import { RemoveMenu } from '../ui/RemoveMenu.tsx';
import { ImportFilesButton } from '../ui/ImportFilesButton.tsx';

/** When a file goes to the trash: this device's clock, as for songs and presentations. */
const trashedAt = () => Date.now();

/**
 * Ljud (spec 05 `/admin/audios`): the organisation's audio files, as a list.
 * No playback here (spec 05); a file plays where a presentation uses it.
 */
export function Audios({ role }: { role: Role }) {
  const db = useDb();
  const trySave = useTrySave();
  const toast = useToast();
  const audios = useData(listAudios, []);
  const [query, setQuery] = useState('');
  const { run, progress, failures } = useMediaImport('audio');
  const manage = can(role, 'ManageAudios');

  const importFiles = async (files: File[]) => {
    if (!manage) return;
    const added = await run(files);
    if (added.length && added.length === files.length) toast(t('audios.imported', { n: added.length }));
  };

  const remove = async (a: LibraryAudio) => {
    if (!(await trySave(db.mutate('trashAudio', { id: a.id, at: trashedAt() })))) return;
    toast(t('audios.trashed', { name: a.fileName }));
  };

  const q = query.trim().toLocaleLowerCase('sv');
  const shown = audios?.filter((a) => !q || a.fileName.toLocaleLowerCase('sv').includes(q)) ?? [];

  return (
    <PageContainer>
      <DropZone className="flex flex-col space-y-5" label={t('audios.drop')} accept={AUDIO_ACCEPT} enabled={manage} onFiles={(files) => void importFiles(files)}>
        <PageHeader title={t('audios.title')}>
          <div className="flex items-center gap-3">
            {manage && <DropHint text={t('images.dropAffordance')} />}
            <AppButton variant="neutral" href={href({ page: 'trash', kind: 'Audio' })} className="inline-flex items-center gap-1.5">
              <TrashIcon className="size-4" />
              {t('images.trash')}
            </AppButton>
            {manage && (
              <ImportFilesButton round accept={AUDIO_ACCEPT} busy={!!progress} testId="audio-file" onFiles={(files) => void importFiles(files)} />
            )}
          </div>
        </PageHeader>
        {progress && (
          <p className="px-5 text-sm text-stone-500 dark:text-stone-400" role="status">
            {t('images.importing', progress)}
          </p>
        )}
        {!!failures.length && (
          <div className="px-5 text-sm text-red-500 dark:text-red-400" role="alert" data-testid="audio-failures">
            <p>{t('audios.failed', { n: failures.length })}</p>
            <ul className="list-disc pl-5">
              {failures.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
        )}
        {/* Not clipped, so a ⋯ menu can reach past the card's edge. */}
        <div className={CARD.replace(' overflow-hidden', '')}>
          <div className="px-5 pt-4 pb-2 space-y-3">
            <h2 className="text-base/6 font-semibold">{t('audios.all', { n: audios?.length ?? 0 })}</h2>
            {!!audios?.length && <SearchField value={query} onChange={setQuery} label={t('images.search')} placeholder={t('images.searchPlaceholder')} compact />}
          </div>
          {!audios && <div className="px-5 py-4 text-stone-400 text-sm">{t('audios.loading')}</div>}
          {audios && !audios.length && (
            <EmptySmall icon={<SpeakerWaveIcon className="size-12 mb-3 text-stone-300 dark:text-stone-600" />} title={t('audios.empty')} />
          )}
          {!!audios?.length && !shown.length && <CardNote>{t('audios.noMatch')}</CardNote>}
          <ul aria-label={t('audios.title')}>
            {shown.map((a) => (
              <li
                key={a.id}
                className="flex items-center gap-3 px-5 py-3 border-b border-separator last:border-b-0 last:rounded-b-xl hover:bg-stone-100 dark:hover:bg-raised/50"
                aria-label={a.fileName}
              >
                <SpeakerWaveIcon className="size-5 text-stone-400 shrink-0" />
                <span className="text-sm truncate flex-1">{a.fileName}</span>
                {manage && (
                  <RemoveMenu name={a.fileName} on="row" onRemove={() => void remove(a)} />
                )}
              </li>
            ))}
          </ul>
        </div>
      </DropZone>
    </PageContainer>
  );
}
