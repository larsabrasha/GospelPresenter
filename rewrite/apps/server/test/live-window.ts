// A window's live socket, for the server tests (spec 04 §2, §6).
import type { LiveOwnState, LiveServerMessage, LiveSessionInfo } from '@gp/core';
import { pokeProtocols, type Harness } from './harness.ts';

/** A window's live socket, keeping every message it got. */
export class Window {
  messages: LiveServerMessage[] = [];
  private waiters: (() => void)[] = [];
  private constructor(readonly ws: WebSocket) {
    ws.addEventListener('message', (e) => {
      this.messages.push(JSON.parse(String(e.data)) as LiveServerMessage);
      for (const w of this.waiters.splice(0)) w();
    });
  }

  static async open(h: Harness, org: string, user: string): Promise<Window> {
    const ws = new WebSocket(h.url.replace(/^http/, 'ws') + '/api/live/socket', pokeProtocols(h, org, user));
    const w = new Window(ws);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve());
      ws.addEventListener('error', () => reject(new Error('socket refused')));
    });
    await w.next((m) => m.type === 'sessions'); // the snapshot every socket gets at once
    return w;
  }

  send(m: unknown) {
    this.ws.send(JSON.stringify(m));
  }

  /** The first message from now on that `match` accepts. */
  async next<T extends LiveServerMessage>(match: (m: LiveServerMessage) => m is T): Promise<T>;
  async next(match: (m: LiveServerMessage) => boolean): Promise<LiveServerMessage>;
  async next(match: (m: LiveServerMessage) => boolean): Promise<LiveServerMessage> {
    const from = this.messages.length;
    const deadline = Date.now() + 5000;
    for (;;) {
      const found = this.messages.slice(from).find(match);
      if (found) return found;
      if (Date.now() > deadline) throw new Error(`no matching message; got ${JSON.stringify(this.messages.slice(from))}`);
      await new Promise<void>((r) => {
        this.waiters.push(r);
        setTimeout(r, 200);
      });
    }
  }

  /** The next sessions list that `match` accepts. */
  async sessions(match: (s: LiveSessionInfo[]) => boolean = () => true): Promise<LiveSessionInfo[]> {
    const m = await this.next((x) => x.type === 'sessions' && match(x.sessions));
    return (m as Extract<LiveServerMessage, { type: 'sessions' }>).sessions;
  }

  async error(): Promise<string> {
    return ((await this.next((m) => m.type === 'error')) as Extract<LiveServerMessage, { type: 'error' }>).error;
  }

  close() {
    this.ws.close();
  }
}

export const ownState = (sessionId: string, over: Partial<LiveOwnState> = {}): LiveOwnState => ({
  sessionId,
  presentationId: 'P',
  presentationName: 'Söndag',
  deviceName: 'Datorn i kyrksalen',
  remote: true,
  pointer: { itemId: 'I1', partIndex: 0, black: false, overlayId: null, rev: 1 },
  outputs: [],
  takeOver: [],
  slide: null,
  audio: null,
  ...over,
});
