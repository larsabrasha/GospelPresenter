// When a device syncs, and what it does next (ADR 0008; ported back from crates/gp-core/src/sync_driver.rs and
// sync_wire.rs): one reducer every shell runs. The shell sends what happened (asked to sync, a poke, the socket opened
// or closed, a timer, the server's answer) with the state the core last gave it, and does what the core answers, in
// order: send this request, keep this page, rebase, open or close the poke socket, set a timer. A sync is push, then
// pull with every page, then the rebase; runs are coalesced, one running and one waiting; a refusal of the server's
// stops syncing and keeps the queue (SYNC-A15); the socket is opened again 3 s after it closes, and a poll every 5
// minutes is the backstop (SYNC-R43).
import { MutationError } from './mutation.ts';
import { byUnits, isObj } from './views/serde.ts';
import type { RunSql } from './views/sql.ts';
import { SCHEMA_VERSION } from './org-schema.ts';
import { PROTOCOL_VERSION } from './protocol.ts';

/** How long after a closed or refused poke socket the next try waits, and the backstop poll. */
const RECONNECT_MS = 3_000;
const POLL_MS = 5 * 60_000;
/** The refusals of credentials that stop syncing (401 or 403 with one of them as `error`). */
const SIGNED_OUT = ['unauthenticated', 'not-a-member', 'device-not-paired'];

type Socket = 'closed' | 'opening' | 'open';
type Phase = 'idle' | 'beforePush' | 'push' | 'pull' | 'rebase';
/** Which halves a run does: a sync does both; a test may push or pull alone. */
interface Parts {
  push: boolean;
  pull: boolean;
}

/** What the shell holds for the core between events; `connected`, `busy` and `stopped` are what it shows. */
export interface DriverState {
  /** The protocol sent (an old app's, in a test) and whether the shell uploads first what a push needs. */
  protocol: number;
  hooks: boolean;
  /** Whether the socket and the poll are wanted (between `start` and `close`). */
  started: boolean;
  socket: Socket;
  connected: boolean;
  /**
   * The last try to open the socket failed, and none has opened since: the one sure sign of no connection (Lars,
   * 2026-11-25: Offline only when it is certain). A socket still opening, or one that closed and is being tried again,
   * is not it.
   */
  unreachable: boolean;
  stopped: string | null;
  busy: boolean;
  phase: Phase;
  /** The current run's halves and number, and the run asked for meanwhile. */
  parts: Parts;
  run: number;
  again: Parts | null;
  /** After the runs: the media fetched (on a connection and a poll), and the socket tried again (after it failed). */
  media: boolean;
  reconnect: boolean;
}

/** One thing for the shell to do, in order, before a push or pull is made into its request. */
type Do =
  | { type: 'queued'; run: number }
  | { type: 'beforePush' }
  | { type: 'push'; limit: number | null }
  | { type: 'pull'; cookie: unknown }
  | { type: 'keepPage' }
  | { type: 'rebase' }
  | { type: 'ended'; run: number; error: string | null }
  | { type: 'idle' }
  | { type: 'media' }
  | { type: 'openSocket' }
  | { type: 'closeSocket' }
  | { type: 'timer'; name: string; ms: number }
  | { type: 'cancelTimers' };

type Event =
  | { type: 'sync'; parts: Parts; media: boolean }
  /** How many of the queue, from its front, the shell's uploads saw and let go (Lars, 2026-11-20). */
  | { type: 'pushLimit'; limit: number }
  | { type: 'nothingToPush' }
  | { type: 'answer'; status: number; body: unknown }
  | { type: 'failed'; error: string }
  | { type: 'rebased' }
  | { type: 'start' }
  | { type: 'close' }
  | { type: 'socketOpened' }
  | { type: 'poke' }
  | { type: 'socketClosed' }
  | { type: 'timer'; name: string };

const BOTH: Parts = { push: true, pull: true };

function fresh(protocol: number, hooks: boolean): DriverState {
  return {
    protocol, hooks, started: false, socket: 'closed', connected: false, unreachable: false, stopped: null, busy: false, phase: 'idle',
    parts: { ...BOTH }, run: 0, again: null, media: false, reconnect: false,
  };
}

/** JSON's text with every object's keys in order, as the Rust core wrote an answer into a failure's words. */
function sortedJson(v: unknown): string {
  return JSON.stringify(v ?? null, (_, x: unknown) => (isObj(x) ? Object.fromEntries(Object.entries(x).toSorted(([a], [b]) => byUnits(a, b))) : x));
}

/** What an answer of the server's to `what` ("push" or "pull") means: a page, a stop, or a failed try. */
function read(what: string, status: number, body: unknown): { ok: unknown } | { stop: string } | { failed: string } {
  const error = body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string' ? (body as { error: string }).error : undefined;
  if (status === 426 && error === 'update-required') return { stop: 'update-required' };
  if ((status === 401 || status === 403) && error !== undefined && SIGNED_OUT.includes(error)) return { stop: error };
  if (status === 200) return { ok: body };
  return { failed: `${what} failed: ${status} ${sortedJson(body)}` };
}

/** The state after `ev`, and what to do. */
function step(st: DriverState, ev: Event): [DriverState, Do[]] {
  const s: DriverState = { ...st, parts: { ...st.parts }, again: st.again && { ...st.again } };
  const out: Do[] = [];
  switch (ev.type) {
    case 'sync':
      sync(s, out, ev.parts, ev.media);
      break;
    case 'pushLimit':
      if (s.phase === 'beforePush') {
        s.phase = 'push';
        out.push({ type: 'push', limit: ev.limit });
      }
      break;
    case 'nothingToPush':
      if (s.phase === 'push') afterPush(s, out);
      break;
    case 'answer': {
      if (s.phase !== 'push' && s.phase !== 'pull') break;
      const pushing = s.phase === 'push';
      const answer = read(pushing ? 'push' : 'pull', ev.status, ev.body);
      if ('stop' in answer) {
        stop(s, out, answer.stop);
        end(s, out, null);
      } else if ('failed' in answer) end(s, out, answer.failed);
      else if (pushing) afterPush(s, out);
      else {
        out.push({ type: 'keepPage' });
        const page = answer.ok as { more?: unknown; cookie?: unknown } | null;
        if (page?.more === true) out.push({ type: 'pull', cookie: page.cookie ?? null });
        else {
          s.phase = 'rebase';
          out.push({ type: 'rebase' });
        }
      }
      break;
    }
    case 'failed':
      if (s.phase !== 'idle') end(s, out, ev.error);
      break;
    case 'rebased':
      if (s.phase === 'rebase') end(s, out, null);
      break;
    case 'start':
      if (!s.started) {
        s.started = true;
        out.push({ type: 'timer', name: 'poll', ms: POLL_MS });
        open(s, out);
      }
      break;
    case 'close':
      s.started = false;
      s.unreachable = false;
      s.reconnect = false;
      close(s, out);
      out.push({ type: 'cancelTimers' });
      break;
    case 'socketOpened':
      if (s.socket === 'opening') {
        s.socket = 'open';
        s.unreachable = false;
        sync(s, out, BOTH, true); // to catch up on what happened while disconnected
      }
      break;
    case 'poke':
      if (s.socket === 'open') sync(s, out, BOTH, false);
      break;
    case 'socketClosed':
      if (s.socket === 'open') {
        s.socket = 'closed';
        if (s.started && s.stopped === null) out.push({ type: 'timer', name: 'reconnect', ms: RECONNECT_MS });
      } else if (s.socket === 'opening') {
        // A socket refused says nothing of why: a sync tells offline from refused credentials, and the socket is tried
        // again after it unless they were.
        s.socket = 'closed';
        s.unreachable = s.started;
        s.reconnect = true;
        sync(s, out, BOTH, false);
      }
      break;
    case 'timer':
      if (ev.name === 'reconnect' && s.started && s.socket === 'closed') open(s, out);
      else if (ev.name === 'poll' && s.started) {
        out.push({ type: 'timer', name: 'poll', ms: POLL_MS });
        sync(s, out, BOTH, true);
      }
      break;
  }
  s.connected = s.socket === 'open';
  return [s, out];
}

/** A run asked for: started now, or after the one running (coalesced); none while syncing is stopped. */
function sync(s: DriverState, out: Do[], parts: Parts, media: boolean) {
  s.media ||= media;
  if (s.busy) {
    s.again = s.again ? { push: s.again.push || parts.push, pull: s.again.pull || parts.pull } : { ...parts };
    out.push({ type: 'queued', run: s.run + 1 });
    return;
  }
  s.busy = true;
  s.run++;
  s.parts = { ...parts };
  out.push({ type: 'queued', run: s.run });
  begin(s, out);
}

function begin(s: DriverState, out: Do[]): void {
  if (s.stopped !== null) return end(s, out, null);
  if (!s.parts.push) return afterPush(s, out);
  if (s.hooks) {
    s.phase = 'beforePush';
    out.push({ type: 'beforePush' });
  } else {
    s.phase = 'push';
    out.push({ type: 'push', limit: null });
  }
}

function afterPush(s: DriverState, out: Do[]): void {
  if (!s.parts.pull) return end(s, out, null);
  s.phase = 'pull';
  out.push({ type: 'pull', cookie: undefined });
}

/** The run ended, well or with `error`: the next one asked for meanwhile begins, or the device is idle. */
function end(s: DriverState, out: Do[], error: string | null): void {
  out.push({ type: 'ended', run: s.run, error });
  if (s.again) {
    s.run++;
    s.parts = s.again;
    s.again = null;
    return begin(s, out);
  }
  s.busy = false;
  s.phase = 'idle';
  out.push({ type: 'idle' });
  // Not once closed: the shell is letting go of its database (signing out, the app in the background).
  const media = s.media;
  s.media = false;
  if (media && s.started && s.stopped === null) out.push({ type: 'media' });
  const reconnect = s.reconnect;
  s.reconnect = false;
  if (reconnect && s.started && s.stopped === null && s.socket === 'closed') out.push({ type: 'timer', name: 'reconnect', ms: RECONNECT_MS });
}

function stop(s: DriverState, out: Do[], why: string) {
  s.stopped = why;
  close(s, out);
}

function open(s: DriverState, out: Do[]) {
  if (s.stopped !== null) return;
  s.socket = 'opening';
  out.push({ type: 'openSocket' });
}

function close(s: DriverState, out: Do[]) {
  if (s.socket !== 'closed') out.push({ type: 'closeSocket' });
  s.socket = 'closed';
}

// ------------------------------------------------------------ the wire (sync_wire.rs)

/** The common fields of a request, before its own: `"protocol":1,"schemaVersion":27,"clientId":"…"`. */
async function head(sql: RunSql, protocol: number): Promise<string> {
  const [row] = await sql('SELECT client_id FROM _sync_meta', []);
  return `"protocol":${protocol},"schemaVersion":${SCHEMA_VERSION},"clientId":${JSON.stringify(row ? String(row[0] ?? '') : '')}`;
}

/**
 * A push of the queue, oldest first, or of its first `limit` (what the shell's uploads let go now); null when there is
 * nothing to send. Each change's arguments go as the text queued, unchanged.
 */
async function pushBody(sql: RunSql, protocol: number, limit: number | null): Promise<string | null> {
  const rows = await sql('SELECT id, name, v, args FROM _mutation ORDER BY id', []);
  const changes = rows.slice(0, limit ?? rows.length).map((m) => `{"id":${Number(m[0])},"name":${JSON.stringify(String(m[1]))},"v":${Number(m[2])},"args":${String(m[3])}}`);
  if (!changes.length) return null;
  return `{${await head(sql, protocol)},"mutations":[${changes.join(',')}]}`;
}

/** A pull from the device's cookie, or from `cookie` for the page after one that said `more`. */
async function pullBody(sql: RunSql, protocol: number, cookie: unknown): Promise<string> {
  const [meta] = await sql('SELECT cookie, last_mutation_id FROM _sync_meta', []);
  const from = cookie === undefined ? (meta ? meta[0] : null) : cookie;
  return `{${await head(sql, protocol)},"cookie":${JSON.stringify(from ?? null)},"lastMutationId":${meta ? Number(meta[1]) : 0}}`;
}

// ------------------------------------------------------------ reading what the shell sends

const bool = (o: Record<string, unknown>, k: string, d: boolean) => (typeof o[k] === 'boolean' ? (o[k] as boolean) : d);
const int = (v: unknown): number | undefined => (typeof v === 'number' && Number.isInteger(v) ? v : undefined);
const partsOf = (v: unknown): Parts | null => (isObj(v) ? { push: bool(v, 'push', true), pull: bool(v, 'pull', true) } : null);

function stateOf(o: unknown): DriverState {
  if (!isObj(o)) throw new MutationError('invalid-args', 'state');
  const socket: Socket = o.socket === 'opening' || o.socket === 'open' ? o.socket : 'closed';
  const phases: Phase[] = ['beforePush', 'push', 'pull', 'rebase'];
  return {
    protocol: int(o.protocol) ?? PROTOCOL_VERSION,
    hooks: bool(o, 'hooks', false),
    started: bool(o, 'started', false),
    socket,
    connected: socket === 'open',
    unreachable: bool(o, 'unreachable', false),
    stopped: typeof o.stopped === 'string' ? o.stopped : null,
    busy: bool(o, 'busy', false),
    phase: phases.includes(o.phase as Phase) ? (o.phase as Phase) : 'idle',
    parts: partsOf(o.parts) ?? { ...BOTH },
    run: int(o.run) ?? 0,
    again: partsOf(o.again),
    media: bool(o, 'media', false),
    reconnect: bool(o, 'reconnect', false),
  };
}

function eventOf(o: unknown): Event {
  const invalid = () => new MutationError('invalid-args', 'event');
  if (!isObj(o)) throw invalid();
  switch (o.type) {
    case 'sync':
      return { type: 'sync', parts: { push: bool(o, 'push', true), pull: bool(o, 'pull', true) }, media: bool(o, 'media', false) };
    case 'pushLimit': {
      const limit = int(o.limit);
      if (limit === undefined || limit < 0) throw invalid();
      return { type: 'pushLimit', limit };
    }
    case 'answer': {
      // The body as JSON, or (a native shell) its text, null when it is not JSON.
      let body: unknown = o.body ?? null;
      if (typeof o.text === 'string') {
        try {
          body = JSON.parse(o.text);
        } catch {
          body = null;
        }
      }
      const status = int(o.status);
      if (status === undefined) throw invalid();
      return { type: 'answer', status, body };
    }
    case 'failed':
      return { type: 'failed', error: typeof o.error === 'string' ? o.error : 'failed' };
    case 'rebased':
    case 'start':
    case 'close':
    case 'socketOpened':
    case 'poke':
    case 'socketClosed':
      return { type: o.type };
    case 'timer':
      return { type: 'timer', name: typeof o.name === 'string' ? o.name : '' };
    default:
      throw invalid();
  }
}

/** One effect for the shell: a request, or one of the driver's own. */
export type DriverEffect = Exclude<Do, { type: 'push' } | { type: 'pull' }> | { type: 'post'; path: string; body: string };

/**
 * `syncStepView` {state, event}: the state after the event, and what the shell does, in order. Without a state, a
 * device's first: {protocol?, hooks?} of `init` (the event may be left out then). Each request comes as
 * {"type": "post", "path", "body"}, its body JSON's text.
 */
export async function syncStepView(args: unknown, sql: RunSql): Promise<{ state: DriverState; effects: DriverEffect[] }> {
  const a = (args && typeof args === 'object' ? args : {}) as Record<string, unknown>;
  let st: DriverState;
  if (a.state !== undefined && a.state !== null) st = stateOf(a.state);
  else {
    const init = (a.init && typeof a.init === 'object' ? a.init : {}) as Record<string, unknown>;
    st = fresh(int(init.protocol) ?? PROTOCOL_VERSION, bool(init, 'hooks', false));
  }
  let todo: Do[] = [];
  if (a.event !== undefined) [st, todo] = step(st, eventOf(a.event));
  const effects: DriverEffect[] = [];
  while (todo.length) {
    const d = todo.shift()!;
    if (d.type === 'push') {
      const body = await pushBody(sql, st.protocol, d.limit);
      if (body === null) {
        const [next, out] = step(st, { type: 'nothingToPush' });
        st = next;
        todo = [...out, ...todo];
        continue;
      }
      effects.push({ type: 'post', path: '/api/sync/push', body });
    } else if (d.type === 'pull') effects.push({ type: 'post', path: '/api/sync/pull', body: await pullBody(sql, st.protocol, d.cookie) });
    else effects.push(d);
  }
  return { state: st, effects };
}
