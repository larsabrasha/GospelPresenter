import { AUDIO_TYPES, audioTypeFromName, MEDIA_LIMITS, sniffAudio } from '@gp/core';
import { useState } from 'react';
import type { AudioImport } from '../db/protocol.ts';
import { useDb } from '../db/react.tsx';
import { t, type TextKey } from '../i18n.ts';
import { newId } from '../ids.ts';
import { ImageRefused, processImage, type ImageProblem } from './process.ts';

// Importing pictures and audio files, one at a time with "Importerar 2 av 5...", for the
// Bilder and Ljud pages and the add dialog's tabs alike (Images.razor, ImageTab.razor).

/** The files the picture import takes (AppConstraints.ImageAccept). */
export const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif';
/** The files the audio import takes (AppConstraints.AudioAccept). */
export const AUDIO_ACCEPT = AUDIO_TYPES.join(',');

type AudioProblem = 'type' | 'size' | 'name';

/**
 * Reads a picked file as an audio import (MEDIA-R1, R2, R5): its type from the
 * browser, else its extension; at most 20 MiB and a 200-character name. The
 * bytes are kept as they are; the type stored is what they say they are.
 */
export async function readAudio(file: File, id: string): Promise<AudioImport | AudioProblem> {
  const picked = AUDIO_TYPES.find((x) => x === file.type) ?? (file.type === '' ? audioTypeFromName(file.name) : null);
  if (!picked) return 'type';
  if (file.size === 0 || file.size > MEDIA_LIMITS.audioBytes) return 'size';
  if (file.name.length > MEDIA_LIMITS.fileName) return 'name';
  const bytes = new Uint8Array(await file.arrayBuffer());
  const contentType = sniffAudio(bytes);
  if (!contentType) return 'type';
  return { id, fileName: file.name, contentType, bytes };
}

const imageFailed: Record<ImageProblem | 'other', TextKey> = {
  type: 'images.failedType',
  size: 'images.failedSize',
  name: 'images.failedName',
  invalid: 'images.failedInvalid',
  other: 'images.failedOther',
};
const audioFailed: Record<AudioProblem | 'other', TextKey> = { type: 'audios.failedType', size: 'audios.failedSize', name: 'audios.failedName', other: 'audios.failedOther' };

/**
 * An import of pictures or audio files: `run` takes the files one at a time, `progress` is
 * where it is, `failures` says why each refused file was, and the promise gives the ids added.
 */
export function useMediaImport(kind: 'image' | 'audio') {
  const db = useDb();
  const [progress, setProgress] = useState<{ i: number; n: number } | null>(null);
  const [failures, setFailures] = useState<string[]>([]);
  const run = async (files: File[]): Promise<string[]> => {
    if (!files.length || progress) return [];
    setFailures([]);
    const failed: string[] = [];
    const added: string[] = [];
    for (const [i, file] of files.entries()) {
      setProgress({ i: i + 1, n: files.length });
      const id = newId();
      try {
        if (kind === 'image') await db.addImage(await processImage(file, id));
        else {
          const read = await readAudio(file, id);
          if (typeof read === 'string') {
            failed.push(t(audioFailed[read], { name: file.name }));
            continue;
          }
          await db.addAudio(read);
        }
        added.push(id);
      } catch (e) {
        if (kind === 'image') failed.push(t(imageFailed[e instanceof ImageRefused ? e.problem : 'other'], { name: file.name }));
        else failed.push(t(audioFailed.other, { name: file.name }));
      }
    }
    setProgress(null);
    setFailures(failed);
    return added;
  };
  return { run, progress, failures };
}
