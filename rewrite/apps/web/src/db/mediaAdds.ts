import { recordMediaBlobSql } from '@gp/core';
import { storeMediaBlob, type SyncClient } from '@gp/sync/client';
import type { AudioImport, ImageImport, SlidesImport, SongFileImport, VideoImport } from './protocol.ts';

/**
 * Adding files, in the database's worker: each keeps its blobs here, then queues the add that names them, online or
 * not; the blobs are uploaded before the add is pushed (`MediaUploads`). `serialStore` keeps them in line with the
 * other writes to the store, and `added` asks for a sync.
 */
export function mediaAdds({ client, serialStore, added }: { client: () => SyncClient; serialStore: <T>(fn: () => Promise<T>) => Promise<T>; added: () => void }) {
  /** Keeps the picture's blobs here and records it in the library, online or not. */
  function addImage(img: ImageImport): Promise<void> {
    return serialStore(async () => {
      const fullHash = await storeMediaBlob(client(), img.full, img.contentType);
      const thumbHash = await storeMediaBlob(client(), img.thumb, img.contentType);
      await client().mutate('addImage', {
        id: img.id,
        fileName: img.fileName,
        contentType: img.contentType,
        fullHash,
        thumbHash,
        width: img.width,
        height: img.height,
        createdAt: Date.now(),
      });
      added();
    });
  }

  /** Keeps the audio file here and records it in the library, online or not. */
  function addAudio(a: AudioImport): Promise<void> {
    return serialStore(async () => {
      const hash = await storeMediaBlob(client(), a.bytes, a.contentType);
      await client().mutate('addAudio', { id: a.id, fileName: a.fileName, contentType: a.contentType, hash, size: a.bytes.length, createdAt: Date.now() });
      added();
    });
  }

  /** Keeps a song's file here and adds it to the song's material, online or not. */
  function addSongFile(f: SongFileImport): Promise<void> {
    return serialStore(async () => {
      const hash = await storeMediaBlob(client(), f.bytes, f.contentType);
      await client().mutate('addSongFile', { id: f.id, songId: f.songId, title: f.title, contentType: f.contentType, hash, size: f.bytes.length, createdAt: Date.now() });
      added();
    });
  }

  /**
   * Records a video the page has uploaded: its still is kept here (uploaded before the add is pushed), the
   * video only named, without its bytes, so `addVideo` finds it here as it does on the server. No device
   * keeps a video: it streams from the server.
   */
  function addVideo(v: VideoImport): Promise<void> {
    return serialStore(async () => {
      const stillHash = await storeMediaBlob(client(), v.still, v.stillType);
      const thumbHash = await storeMediaBlob(client(), v.thumb, v.stillType);
      await client().localWrite([recordMediaBlobSql(v.hash, v.contentType, v.size, null, Date.now())]);
      await client().mutate('addVideo', {
        id: v.id,
        fileName: v.fileName,
        contentType: v.contentType,
        codec: v.codec,
        hash: v.hash,
        size: v.size,
        duration: v.duration,
        width: v.width,
        height: v.height,
        stillHash,
        thumbHash,
        createdAt: Date.now(),
      });
      added();
    });
  }

  /** Keeps every page's blobs here and adds the deck, or its new pages, online or not. */
  function addSlides(s: SlidesImport): Promise<void> {
    return serialStore(async () => {
      const pages: { full: string; thumb: string }[] = [];
      for (const page of s.pages) {
        pages.push({ full: await storeMediaBlob(client(), page.full, s.contentType), thumb: await storeMediaBlob(client(), page.thumb, s.contentType) });
      }
      const at = Date.now();
      if (s.into === 'library') await client().mutate('addSlideDeck', { id: s.deckId, name: s.fileName, pages, at });
      else if (s.into === 'replace') await client().mutate('updateSlideDeck', { id: s.deckId, pages, at });
      else await client().mutate('addSlides', { ...s.into, deckId: s.deckId, fileName: s.fileName, pages, at });
      added();
    });
  }

  return { addImage, addAudio, addSongFile, addVideo, addSlides };
}
