import { useEffect } from 'react';
import type { LivePointer, PublicSlide } from '@gp/core';
import { deviceName } from '../auth/session.ts';
import { getPresentation, itemsOf, themeOf } from '../db/queries.ts';
import type { ReadDb } from '../db/share.ts';
import { slidesOf, type LiveChannel } from './live.ts';
import { remoteAllowed, type LiveLink } from './remote.ts';

/** Fired when "Tillåt fjärrstyrning" or the chosen outputs change in this window. */
export const REMOTE_CHANGED = 'gp:remote-changed';

export function setRemoteAllowed(on: boolean) {
  try {
    sessionStorage.setItem('gp.remote', on ? '1' : '0');
  } catch {
    // no storage: the toggle lasts for this page only
  }
  dispatchEvent(new Event(REMOTE_CHANGED));
}

// The public outputs this window sends to. Kept for the window, so the next
// presentation sends to the same ones (spec 04 "Saved output configuration").
let chosen: string[] = (() => {
  try {
    return JSON.parse(sessionStorage.getItem('gp.outputs') ?? '[]') as string[];
  } catch {
    return [];
  }
})();
/** Outputs to take over from another session on the next report ("Ta över", LIVE-R23). */
let takeOver: string[] = [];

export function chosenOutputs(): string[] {
  return chosen;
}

/** Switches an output on or off for this window; `take` takes it from the session that sends to it now. */
export function setOutput(id: string, on: boolean, take = false) {
  chosen = on ? [...new Set([...chosen, id])] : chosen.filter((x) => x !== id);
  if (on && take) takeOver = [...new Set([...takeOver, id])];
  try {
    sessionStorage.setItem('gp.outputs', JSON.stringify(chosen));
  } catch {
    // no storage: the choice lasts for this page only
  }
  dispatchEvent(new Event(REMOTE_CHANGED));
}

/**
 * What a public output shows (spec 04 §6): the slide this window shows, as
 * data, with its theme. Null is the waiting screen: black, or nothing
 * selected (LIVE-R14).
 */
async function publicSlide(db: ReadDb, p: LivePointer): Promise<PublicSlide | null> {
  if (!p.presentationId || !p.itemId || p.black) return null;
  const item = (await itemsOf(db, p.presentationId)).find((i) => i.id === p.itemId);
  const slide = item ? (await slidesOf(db, item)).slides[p.partIndex] : undefined;
  if (!slide) return null;
  const theme = await themeOf(db, await getPresentation(db, p.presentationId));
  return { kind: slide.kind, text: slide.text, verses: slide.verses, image: slide.image, credits: slide.credits, themeId: theme.id };
}

/**
 * Makes this window the owner of its live session (ADR 0004): whatever the
 * window presents is reported to the server, whichever page is open, and a
 * controller's command is applied here, to this window's own LiveChannel,
 * if it still makes sense (LIVE-R49): this window is presenting, and the
 * item exists. Its own outputs follow the LiveChannel, never the server;
 * public outputs get the slide it reports.
 */
export function useLiveOwner(live: LiveChannel, link: LiveLink, db: ReadDb, sessionId: string) {
  useEffect(() => {
    let current = 0;
    const report = async (p: LivePointer) => {
      const mine = ++current;
      if (!p.presentationId) return link.own(null);
      const presentation = await getPresentation(db, p.presentationId);
      const slide = chosen.length ? await publicSlide(db, p) : null;
      if (mine !== current) return; // a newer pointer is on its way
      link.own({
        sessionId,
        presentationId: p.presentationId,
        presentationName: presentation?.name ?? '',
        deviceName: deviceName(),
        remote: remoteAllowed(),
        pointer: { itemId: p.itemId, partIndex: p.partIndex, black: p.black, rev: p.rev },
        outputs: chosen,
        takeOver,
        slide,
      });
      takeOver = []; // once is enough: the output is ours now
    };
    const off = live.subscribe((p) => void report(p));
    const again = () => void report(live.pointer);
    addEventListener(REMOTE_CHANGED, again);
    // An edit to what is showing, or a new theme, reaches the public outputs too.
    const offDb = db.onChange(() => chosen.length && again());
    const offCommand = link.onCommand(async (target, change) => {
      const p = live.pointer;
      if (target !== sessionId || !p.presentationId) return;
      if (change.itemId && !(await itemsOf(db, p.presentationId)).some((i) => i.id === change.itemId)) return;
      if (p.itemId === change.itemId && p.partIndex === change.partIndex && p.black === change.black) return;
      live.set(change);
    });
    // An output another session sends to was not taken: it is not ours, so stop asking for it.
    const offError = link.onError((e) => {
      if (e !== 'output-taken') return;
      const elsewhere = new Set(link.sessions.filter((s) => s.id !== sessionId).flatMap((s) => s.outputs.map((o) => o.id)));
      const kept = chosen.filter((id) => !elsewhere.has(id));
      if (kept.length !== chosen.length) for (const id of chosen.filter((x) => elsewhere.has(x))) setOutput(id, false);
    });
    return () => {
      off();
      offDb();
      offCommand();
      offError();
      removeEventListener(REMOTE_CHANGED, again);
    };
  }, [live, link, db, sessionId]);
}
