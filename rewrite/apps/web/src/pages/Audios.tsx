import { useState } from 'react';
import { AUDIO_TYPES, audioTypeFromName, can, MEDIA_LIMITS, sniffAudio, type LibraryAudio, type Role } from '@gp/core';
import type { AudioImport } from '../db/protocol.ts';
import { useData, useDb } from '../db/react.tsx';
import { listAudios } from '../db/queries.ts';
import { t } from '../i18n.ts';
import { newId } from '../ids.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { DropHint, DropZone } from '../ui/DropZone.tsx';
import { Dropdown, MENU_ITEM_DANGER } from '../ui/Dropdown.tsx';
import { CardNote, EmptySmall } from '../ui/Empty.tsx';
import { ArrowDownTrayIcon, EllipsisIcon, SpeakerWaveIcon, TrashIcon } from '../ui/icons.tsx';
import { CARD } from '../ui/List.tsx';
import { PageContainer, PageHeader } from '../ui/PageContainer.tsx';
import { SearchField } from '../ui/Picker.tsx';
import { href } from '../ui/router.ts';
import { useToast } from '../ui/Toast.tsx';

type Problem = 'type' | 'size' | 'name';

/**
 * Reads a picked file as an audio import (MEDIA-R1, R2, R5): its type from the
 * browser, else its extension; at most 20 MiB and a 200-character name. The
 * bytes are kept as they are; the type stored is what they say they are.
 */
export async function readAudio(file: File, id: string): Promise<AudioImport | Problem> {
  const picked = AUDIO_TYPES.find((x) => x === file.type) ?? (file.type === '' ? audioTypeFromName(file.name) : null);
  if (!picked) return 'type';
  if (file.size === 0 || file.size > MEDIA_LIMITS.audioBytes) return 'size';
  if (file.name.length > MEDIA_LIMITS.fileName) return 'name';
  const bytes = new Uint8Array(await file.arrayBuffer());
  const contentType = sniffAudio(bytes);
  if (!contentType) return 'type';
  return { id, fileName: file.name, contentType, bytes };
}

/** When a file goes to the trash: this device's clock, as for songs and presentations. */
const trashedAt = () => Date.now();

const failedText: Record<Problem, Parameters<typeof t>[0]> = { type: 'audios.failedType', size: 'audios.failedSize', name: 'images.failedName' };

/**
 * Ljud (spec 05 `/admin/audios`): the organisation's audio files, as a list.
 * No playback here (spec 05); a file plays where a presentation uses it.
 */
export function Audios({ role }: { role: Role }) {
  const db = useDb();
  const toast = useToast();
  const audios = useData(listAudios, []);
  const [query, setQuery] = useState('');
  const [progress, setProgress] = useState<{ i: number; n: number } | null>(null);
  const [failures, setFailures] = useState<string[]>([]);
  const manage = can(role, 'ManageAudios');

  const importFiles = async (files: File[]) => {
    if (!files.length || progress || !manage) return;
    setFailures([]);
    const failed: string[] = [];
    let added = 0;
    for (const [i, file] of files.entries()) {
      setProgress({ i: i + 1, n: files.length });
      try {
        const read = await readAudio(file, newId());
        if (typeof read === 'string') failed.push(t(failedText[read], { name: file.name }));
        else {
          await db.addAudio(read);
          added++;
        }
      } catch {
        failed.push(t('images.failedOther', { name: file.name }));
      }
    }
    setProgress(null);
    setFailures(failed);
    if (added && !failed.length) toast(t('audios.imported', { n: added }));
  };

  const remove = async (a: LibraryAudio) => {
    await db.mutate('trashAudio', { id: a.id, at: trashedAt() });
    toast(t('audios.trashed', { name: a.fileName }));
  };

  const q = query.trim().toLocaleLowerCase('sv');
  const shown = audios?.filter((a) => !q || a.fileName.toLocaleLowerCase('sv').includes(q)) ?? [];

  return (
    <PageContainer>
      <DropZone className="flex flex-col space-y-5 min-h-[60vh]" label={t('audios.drop')} enabled={manage} onFiles={(files) => void importFiles(files)}>
        <PageHeader title={t('audios.title')}>
          <div className="flex items-center gap-3">
            {manage && <DropHint text={t('images.dropAffordance')} />}
            <AppButton variant="neutral" href={href({ page: 'trash', kind: 'Audio' })} className="inline-flex items-center gap-1.5">
              <TrashIcon className="size-4" />
              {t('images.trash')}
            </AppButton>
            {manage && (
              <AppButton asLabel disabled={!!progress} className="inline-flex items-center gap-1.5">
                <ArrowDownTrayIcon className="size-4 shrink-0" />
                {t('images.import')}
                <input
                  type="file"
                  accept={AUDIO_TYPES.join(',')}
                  multiple
                  hidden
                  disabled={!!progress}
                  data-testid="audio-file"
                  onChange={(e) => {
                    void importFiles([...(e.target.files ?? [])]);
                    e.target.value = '';
                  }}
                />
              </AppButton>
            )}
          </div>
        </PageHeader>
        {progress && (
          <p className="px-5 text-sm text-neutral-500 dark:text-neutral-400" role="status">
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
            {!!audios?.length && <SearchField value={query} onChange={setQuery} label={t('images.search')} compact />}
          </div>
          {audios && !audios.length && (
            <EmptySmall icon={<SpeakerWaveIcon className="size-12 mb-3 text-neutral-300 dark:text-neutral-600" />} title={t('audios.empty')} text={t('audios.emptyText')} />
          )}
          {!!audios?.length && !shown.length && <CardNote>{t('audios.noMatch')}</CardNote>}
          <ul aria-label={t('audios.title')}>
            {shown.map((a) => (
              <li
                key={a.id}
                className="flex items-center gap-3 px-5 py-3 border-b border-neutral-200 dark:border-neutral-700 last:border-b-0 last:rounded-b-xl hover:bg-neutral-100 dark:hover:bg-neutral-700/50"
                aria-label={a.fileName}
              >
                <SpeakerWaveIcon className="size-5 text-neutral-400 shrink-0" />
                <span className="text-sm truncate flex-1">{a.fileName}</span>
                {manage && (
                  <Dropdown
                    menuClassName="min-w-36"
                    button={{
                      className: 'size-7 flex items-center justify-center rounded-full text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 cursor-pointer',
                      'aria-label': t('images.more', { name: a.fileName }),
                    }}
                    trigger={<EllipsisIcon className="size-4" />}
                  >
                    <AppButton variant="plain" role="menuitem" className={MENU_ITEM_DANGER} onClick={() => void remove(a)}>
                      <TrashIcon className="size-4" />
                      {t('images.remove')}
                    </AppButton>
                  </Dropdown>
                )}
              </li>
            ))}
          </ul>
        </div>
      </DropZone>
    </PageContainer>
  );
}
