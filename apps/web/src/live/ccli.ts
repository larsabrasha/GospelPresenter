import { useEffect } from 'react';
import type { LivePointer } from '@gp/core';
import type { Db } from '../db/db.ts';
import { ccliCollectionOn, getPresentation, getSong, itemsOf } from '../db/queries.ts';
import type { LiveChannel } from './live.ts';

// CCLI counting (spec 02 SONG-R48–R53): the window that presents counts here, so one session is counted
// once, whoever else controls or watches it (SONG-R51).

/** A slide shown this long without a change counts (SONG-R48). */
export const CCLI_SHOWN_MS = 10_000;

/**
 * Calls `shown` with a pointer once its slide has been shown CCLI_SHOWN_MS without a change. Another slide,
 * another item, the black screen or leaving the presentation starts over; the same slide again (a new
 * overlay, a pointer sent again) does not.
 */
export class CcliCounter {
  private key: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly shown: (p: LivePointer) => void,
    private readonly wait = CCLI_SHOWN_MS,
  ) {}

  see(p: LivePointer) {
    const key = p.presentationId && p.itemId && !p.black ? `${p.presentationId}|${p.itemId}|${p.partIndex}` : null;
    if (key === this.key) return;
    this.stop();
    this.key = key;
    if (key)
      this.timer = setTimeout(() => {
        this.timer = null;
        this.shown(p);
      }, this.wait);
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

/** This device's day, `YYYY-MM-DD`: a service after midnight UTC is on the day it is held (02 Q12 as decided on 2026-10-31). */
export const localDate = (at = new Date()) => at.toLocaleDateString('sv-SE');

/** Records the song the pointer showed, if it is a song with a CCLI number and collection is on; a failure never reaches the presentation (SONG-R53). */
async function record(db: Db, p: LivePointer) {
  try {
    if (!p.presentationId || !(await ccliCollectionOn(db))) return;
    const item = (await itemsOf(db, p.presentationId)).find((i) => i.id === p.itemId);
    if (item?.type !== 'song') return;
    const song = await getSong(db, item.sourceId);
    if (!song?.ccli?.trim()) return;
    const presentation = await getPresentation(db, p.presentationId);
    await db.mutate('recordCcliUse', {
      songId: song.id,
      songName: song.name,
      ccli: song.ccli,
      presentationId: p.presentationId,
      presentationName: presentation?.name ?? '',
      date: localDate(),
    });
  } catch (e) {
    console.error('ccli not recorded', e);
  }
}

/** Counts what this window presents, on every page. */
export function useCcliCounter(live: LiveChannel, db: Db) {
  useEffect(() => {
    const counter = new CcliCounter((p) => void record(db, p));
    const off = live.subscribe((p) => counter.see(p));
    return () => {
      off();
      counter.stop();
    };
  }, [live, db]);
}
