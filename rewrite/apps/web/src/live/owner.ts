import { useEffect } from 'react';
import { toPublicSlide, type LivePointer, type LiveSessionInfo, type PublicSlide } from '@gp/core';
import { deviceName } from '../auth/session.ts';
import { getPresentation, itemsOf, themeOf } from '../db/queries.ts';
import type { ReadDb } from '../db/share.ts';
import { slidesOf, type LiveChannel } from './live.ts';
import type { AudioEngine } from './audio.ts';
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
/**
 * Outputs to take over from another session ("Ta över", LIVE-R23). Asked for
 * in every report until the server's list shows them as this session's, so
 * a report lost to a reconnect does not lose the choice.
 */
let takeOver: string[] = [];

export function pendingTakeOver(): string[] {
  return takeOver;
}

/** Forgets the takeovers the server has done: those outputs are this session's now. */
export function settleTakeOver(sessions: LiveSessionInfo[], sessionId: string) {
  const bound = new Set(sessions.find((s) => s.id === sessionId)?.outputs.map((o) => o.id) ?? []);
  takeOver = takeOver.filter((id) => !bound.has(id));
}

export function chosenOutputs(): string[] {
  return chosen;
}

/** Switches an output on or off for this window; `take` takes it from the session that sends to it now. */
export function setOutput(id: string, on: boolean, take = false) {
  chosen = on ? [...new Set([...chosen, id])] : chosen.filter((x) => x !== id);
  if (on && take) takeOver = [...new Set([...takeOver, id])];
  if (!on) takeOver = takeOver.filter((x) => x !== id);
  try {
    sessionStorage.setItem('gp.outputs', JSON.stringify(chosen));
  } catch {
    // no storage: the choice lasts for this page only
  }
  dispatchEvent(new Event(REMOTE_CHANGED));
}

/** The chosen outputs another session sends to, which this one did not ask to take over. */
export function refusedOutputs(sessions: LiveSessionInfo[], sessionId: string): string[] {
  const elsewhere = new Set(sessions.filter((s) => s.id !== sessionId).flatMap((s) => s.outputs.map((o) => o.id)));
  return chosen.filter((id) => elsewhere.has(id) && !takeOver.includes(id));
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
  return toPublicSlide(slide, theme.id);
}

/**
 * Makes this window the owner of its live session (ADR 0004): whatever the
 * window presents is reported to the server, whichever page is open, and a
 * controller's command is applied here, to this window's own LiveChannel,
 * if it still makes sense (LIVE-R49): this window is presenting, and the
 * item exists. Its own outputs follow the LiveChannel, never the server;
 * public outputs get the slide it reports.
 */
export function useLiveOwner(live: LiveChannel, link: LiveLink, db: ReadDb, sessionId: string, audio: AudioEngine) {
  useEffect(() => {
    let current = 0;
    const report = async (p: LivePointer) => {
      const mine = ++current;
      if (!p.presentationId) {
        audio.stop();
        return link.own(null);
      }
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
        audio: audio.state(),
      });
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
    const offSessions = link.subscribe(() => settleTakeOver(link.sessions, sessionId));
    // The audio plays here; what it does reaches the controllers with the next report.
    const offAudio = audio.subscribe(again);
    const offAudioCommand = link.onAudioCommand((target, command) => {
      if (target === sessionId && live.pointer.presentationId) audio.command(command);
    });
    // An output another session sends to was not taken: unless we asked to take it over, stop asking for it.
    const offError = link.onError((e) => {
      if (e !== 'output-taken') return;
      for (const id of refusedOutputs(link.sessions, sessionId)) setOutput(id, false);
    });
    return () => {
      off();
      offDb();
      offCommand();
      offError();
      offSessions();
      offAudio();
      offAudioCommand();
      removeEventListener(REMOTE_CHANGED, again);
    };
  }, [live, link, db, sessionId, audio]);
}
