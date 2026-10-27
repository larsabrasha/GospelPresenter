import { useEffect } from 'react';
import type { LivePointer } from '@gp/core';
import { deviceName } from '../auth/session.ts';
import { getPresentation, itemsOf } from '../db/queries.ts';
import type { ReadDb } from '../db/share.ts';
import type { LiveChannel } from './live.ts';
import { remoteAllowed, type LiveLink } from './remote.ts';

/** Fired when "Tillåt fjärrstyrning" changes in this window. */
export const REMOTE_CHANGED = 'gp:remote-changed';

export function setRemoteAllowed(on: boolean) {
  try {
    sessionStorage.setItem('gp.remote', on ? '1' : '0');
  } catch {
    // no storage: the toggle lasts for this page only
  }
  dispatchEvent(new Event(REMOTE_CHANGED));
}

/**
 * Makes this window the owner of its live session (ADR 0004): whatever the
 * window presents is reported to the server, whichever page is open, and a
 * controller's command is applied here, to this window's own LiveChannel,
 * if it still makes sense (LIVE-R49): this window is presenting, and the
 * item exists. The outputs follow the LiveChannel, never the server.
 */
export function useLiveOwner(live: LiveChannel, link: LiveLink, db: ReadDb, sessionId: string) {
  useEffect(() => {
    let current = 0;
    const report = async (p: LivePointer) => {
      const mine = ++current;
      if (!p.presentationId) return link.own(null);
      const presentation = await getPresentation(db, p.presentationId);
      if (mine !== current) return; // a newer pointer is on its way
      link.own({
        sessionId,
        presentationId: p.presentationId,
        presentationName: presentation?.name ?? '',
        deviceName: deviceName(),
        remote: remoteAllowed(),
        pointer: { itemId: p.itemId, partIndex: p.partIndex, black: p.black, rev: p.rev },
        outputs: [],
        takeOver: [],
        slide: null,
      });
    };
    const off = live.subscribe((p) => void report(p));
    const onRemote = () => void report(live.pointer);
    addEventListener(REMOTE_CHANGED, onRemote);
    const offCommand = link.onCommand(async (target, change) => {
      const p = live.pointer;
      if (target !== sessionId || !p.presentationId) return;
      if (change.itemId && !(await itemsOf(db, p.presentationId)).some((i) => i.id === change.itemId)) return;
      if (p.itemId === change.itemId && p.partIndex === change.partIndex && p.black === change.black) return;
      live.set(change);
    });
    return () => {
      off();
      offCommand();
      removeEventListener(REMOTE_CHANGED, onRemote);
    };
  }, [live, link, db, sessionId]);
}
