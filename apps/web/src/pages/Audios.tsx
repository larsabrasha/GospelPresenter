import { useMemo } from 'react';
import { can, MEDIA_LIMITS, type Role } from '@gp/core';
import { useData, useDb } from '../db/react.tsx';
import { listAudios } from '../db/queries.ts';
import { t } from '../i18n.ts';
import { AUDIO_ACCEPT, useMediaImport } from '../media/imports.ts';
import { SpeakerWaveIcon } from '../ui/icons.tsx';
import { ImportFilesButton } from '../ui/ImportFilesButton.tsx';
import { Library } from '../ui/Library.tsx';
import { useToast } from '../ui/Toast.tsx';
import { fileSorts, ImportNotices, named, trashTexts } from './Images.tsx';

/**
 * Ljud (spec 05 `/admin/audios`): the organisation's audio files, as a list (ui/Library.tsx).
 * No playback here (spec 05); a file plays where a presentation uses it.
 */
export function Audios({ role }: { role: Role }) {
  const db = useDb();
  const toast = useToast();
  const audios = useData(listAudios, []);
  const items = useMemo(() => named(audios), [audios]);
  const { run, progress, failures } = useMediaImport('audio');
  const manage = can(role, 'ManageAudios');

  const importFiles = async (files: File[]) => {
    if (!manage) return;
    const added = await run(files);
    if (added.length && added.length === files.length) toast(t('audios.imported', { n: added.length }));
  };

  return (
    <Library
      title={t('audios.title')}
      items={items}
      layout="list"
      sorts={fileSorts()}
      renderRow={() => ({ leading: <SpeakerWaveIcon className="size-5 text-stone-400 shrink-0" /> })}
      preview={(a) => ({ kind: 'audio', hash: a.hash })}
      manage={manage}
      download={{
        zipName: t('audios.title'),
        file: async (a) => {
          const m = await db.openMedia(a.hash);
          return m && { name: a.fileName, data: m.bytes, type: m.contentType };
        },
      }}
      rename={{ title: t('library.renameTitle'), label: t('library.fileName'), maxLength: MEDIA_LIMITS.fileName, run: (a, fileName) => db.mutate('renameAudio', { id: a.id, fileName }) }}
      remove={{ ...trashTexts('audios.trashed'), run: (a) => db.mutate('trashAudio', { id: a.id, at: Date.now() }) }}
      add={manage && <ImportFilesButton round accept={AUDIO_ACCEPT} busy={!!progress} testId="audio-file" onFiles={(files) => void importFiles(files)} />}
      notices={<ImportNotices progress={progress && t('images.importing', progress)} failures={failures} failed={t('audios.failed', { n: failures.length })} testId="audio" />}
      loading={t('audios.loading')}
      empty={{ icon: <SpeakerWaveIcon className="size-12 mb-3 text-stone-300 dark:text-stone-600" />, title: t('audios.empty'),
        text: t('audios.emptyText'),
        action: <ImportFilesButton accept={AUDIO_ACCEPT} busy={!!progress} testId="audio-file" label={t('audios.emptyImport')} onFiles={(files) => void importFiles(files)} />,
      }}
      noMatch={t('audios.noMatch')}
      count={(n) => t(n === 1 ? 'audios.count.one' : 'audios.count.many', { n })}
      drop={{ label: t('audios.drop'), accept: AUDIO_ACCEPT, onFiles: (files) => void importFiles(files) }}
      testId="audio"
    />
  );
}
