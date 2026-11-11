import { MAX_VIEWERS, type WatchEvent } from '@gp/core';

// The streams that follow an organisation's outputs (spec 04 §5, §6): public viewers and paired screens. In memory: a
// viewer reconnects if the process restarts.

/** One public viewer's stream (LIVE-R35): it only ever needs the newest event. */
export interface Viewer {
  send(e: WatchEvent): void;
  close(): void;
}

/**
 * How long a saved screen whose stream dropped stays switched on: a TV whose
 * Wi-Fi blinks reconnects within it; a page that closed is off after it (LIVE-A20).
 */
export const SCREEN_GRACE_MS = 15_000;

/** How often at most the viewer counts go out (LIVE-R36), with a trailing update. */
const COUNT_THROTTLE_MS = 2000;

/** A stream on an output: the code it came in by, and whether it is a paired screen. */
export interface Watching {
  viewer: Viewer;
  code: string;
  screen: boolean;
}

export class OutputViewers {
  /** By output, by viewer id. */
  private byOutput = new Map<string, Map<string, Watching>>();
  /**
   * Saved screens whose last stream dropped, waiting out SCREEN_GRACE_MS. The
   * entry is its own mark: a timer whose entry was replaced (the screen came
   * back and dropped again) does nothing.
   */
  private dropped = new Map<string, { timer: unknown }>();
  private countTimer: ReturnType<typeof setTimeout> | null = null;
  private countDue = false;

  constructor(
    /** The viewer counts changed: the operators hear it (`changed` throttles). */
    private onCounts: () => void,
    /** A saved screen stayed away SCREEN_GRACE_MS: it is switched off. */
    private onScreenGone: (displayId: string) => void,
    /** Runs `fn` after `ms`, in the organisation's queue (LiveHub's `later`). */
    private later: (fn: () => void, ms: number) => unknown,
  ) {}

  /**
   * Adds a stream (LIVE-R36): at most MAX_VIEWERS per output, but one already known (a reload, a reconnect) replaces
   * its old stream and is never refused. False, with the viewer told and closed, when it is one too many.
   */
  add(displayId: string, viewerId: string, w: Watching): boolean {
    let set = this.byOutput.get(displayId);
    if (!set) this.byOutput.set(displayId, (set = new Map()));
    const old = set.get(viewerId);
    if (!old && set.size >= MAX_VIEWERS) {
      w.viewer.send({ type: 'full' });
      w.viewer.close();
      return false;
    }
    set.set(viewerId, w);
    const pending = this.dropped.get(displayId);
    if (pending) clearTimeout(pending.timer as ReturnType<typeof setTimeout>); // back within the grace
    this.dropped.delete(displayId);
    old?.viewer.close();
    return true;
  }

  /**
   * A stream ended. Only that stream: a newer one under the same id stays (false). A saved screen left with none is
   * switched off (LIVE-R24, LIVE-A20) once it has not come back for SCREEN_GRACE_MS.
   */
  remove(displayId: string, viewerId: string, viewer: Viewer, isSavedScreen: () => boolean): boolean {
    const set = this.byOutput.get(displayId);
    if (set?.get(viewerId)?.viewer !== viewer) return false;
    set.delete(viewerId);
    if (!set.size && !this.dropped.has(displayId) && isSavedScreen()) {
      const mark: { timer: unknown } = { timer: null };
      this.dropped.set(displayId, mark);
      mark.timer = this.later(() => {
        if (this.dropped.get(displayId) !== mark) return;
        this.dropped.delete(displayId);
        if (this.count(displayId) === 0) this.onScreenGone(displayId);
      }, SCREEN_GRACE_MS);
    }
    return true;
  }

  /** The streams on an output. */
  of(displayId: string): Watching[] {
    return [...(this.byOutput.get(displayId)?.values() ?? [])];
  }

  count(displayId: string): number {
    return this.byOutput.get(displayId)?.size ?? 0;
  }

  /** A saved screen is online while a page follows it, and for SCREEN_GRACE_MS after the last one dropped. */
  online(displayId: string): boolean {
    return this.count(displayId) > 0 || this.dropped.has(displayId);
  }

  /** Every output that is online, by id. */
  onlineIds(): string[] {
    return [...new Set([...this.byOutput].filter(([, set]) => set.size > 0).map(([id]) => id).concat([...this.dropped.keys()]))].toSorted();
  }

  /** Ends every stream on an output, each told `last` first (a temporary screen let go). */
  closeAll(displayId: string, last: WatchEvent): void {
    for (const w of this.of(displayId)) {
      w.viewer.send(last);
      w.viewer.close();
    }
    this.byOutput.delete(displayId);
  }

  /** Ends the streams `stale` picks (an output deleted, or given a new code). */
  closeIf(stale: (displayId: string, w: Watching, all: Watching[]) => boolean): void {
    for (const [displayId, set] of this.byOutput) {
      const all = [...set.values()];
      for (const [viewerId, w] of set) {
        if (!stale(displayId, w, all)) continue;
        set.delete(viewerId);
        w.viewer.close();
      }
    }
  }

  /** Viewer counts reach the operators at most every 2 s: at once, then one trailing update (LIVE-R36). */
  changed(): void {
    if (this.countTimer) {
      this.countDue = true;
      return;
    }
    this.onCounts();
    this.countTimer = setTimeout(() => {
      this.countTimer = null;
      if (!this.countDue) return;
      this.countDue = false;
      this.changed();
    }, COUNT_THROTTLE_MS);
  }

  /** Stops the timers: the database is about to close. */
  dispose(): void {
    for (const d of this.dropped.values()) clearTimeout(d.timer as ReturnType<typeof setTimeout>);
    this.dropped.clear();
    if (this.countTimer) clearTimeout(this.countTimer);
    this.countTimer = null;
    this.countDue = false;
  }
}
