import { useState, type DragEvent } from 'react';
import { AUDIO_TYPES, audioTypeFromName, can, MEDIA_LIMITS, sniffAudio, type LibraryAudio, type Role } from '@gp/core';
import type { AudioImport } from '../db/protocol.ts';
import { useData, useDb } from '../db/react.tsx';
import { listAudios } from '../db/queries.ts';
import { t } from '../i18n.ts';
import { newId } from '../ids.ts';
import { Button } from '../ui/Button.tsx';
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
  const [dragging, setDragging] = useState(false);
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

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void importFiles([...e.dataTransfer.files]);
  };

  const q = query.trim().toLocaleLowerCase('sv');
  const shown = audios?.filter((a) => !q || a.fileName.toLocaleLowerCase('sv').includes(q)) ?? [];

  return (
    <section
      className={dragging ? 'drop-zone dragging' : 'drop-zone'}
      onDragOver={(e) => {
        e.preventDefault();
        if (manage) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <div className="row">
        <h1 className="grow">{t('audios.title')}</h1>
        <a className="btn" href={href({ page: 'trash', kind: 'Audio' })}>
          {t('images.trash')}
        </a>
        {manage && (
          <label className={progress ? 'btn btn-primary disabled' : 'btn btn-primary'}>
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
          </label>
        )}
      </div>
      {progress && (
        <p className="muted" role="status">
          {t('images.importing', progress)}
        </p>
      )}
      {!!failures.length && (
        <div className="danger" role="alert" data-testid="audio-failures">
          <p>{t('audios.failed', { n: failures.length })}</p>
          <ul>
            {failures.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="card">
        <h2>{t('audios.all', { n: audios?.length ?? 0 })}</h2>
        {!!audios?.length && (
          <div className="row">
            <input className="search grow" type="search" maxLength={100} aria-label={t('images.search')} placeholder={t('images.search')} value={query} onChange={(e) => setQuery(e.target.value)} />
            {query && (
              <Button aria-label={t('common.clear')} onClick={() => setQuery('')}>
                ×
              </Button>
            )}
          </div>
        )}
        {audios && !audios.length && (
          <div className="empty">
            <p>
              <strong>{t('audios.empty')}</strong>
            </p>
            <p className="muted">{t('audios.emptyText')}</p>
          </div>
        )}
        {!!audios?.length && !shown.length && <p className="muted">{t('audios.noMatch')}</p>}
        <ul className="list" aria-label={t('audios.title')}>
          {shown.map((a) => (
            <li key={a.id} className="row" aria-label={a.fileName}>
              <span aria-hidden="true">🔊</span>
              <span className="grow">{a.fileName}</span>
              {manage && (
                <Button aria-label={`${t('images.remove')} ${a.fileName}`} onClick={() => void remove(a)}>
                  ⋯
                </Button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
