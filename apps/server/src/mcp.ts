// The MCP endpoint (docs/mcp.md): `POST /api/mcp` with `Authorization: Bearer gpmcp_…`, MCP's Streamable HTTP
// transport answered statelessly with plain JSON: no session id, no server-sent events, so it runs the same on Node
// and in an organisation's Durable Object. The tools are the core's (mcp-tools.ts): each read and each change runs in
// the organisation's queue, one at a time (a read that a change depends on in the same turn, `atomic`), a change as
// its own transaction, announced to the devices as a push's is; a picture is fetched and made outside it.
import { Hono, type Context } from 'hono';
import { callMcpTool, can, isMcpTool, mcpTools, MutationError, randomId, sha256HexBytes, type ImportedPicture, type McpToolContext, type MutatorName } from '@gp/core';
import { runMutation } from '@gp/core/core';
import { currentSeq } from '@gp/sync/server';
import type { Org } from './app.ts';
import { credentials, protectedResourceUrl, type Caller } from './auth/index.ts';
import type { Accounts } from './global/index.ts';
import { keepBlob, type MediaStorage } from './media.ts';
import type { FetchPicture } from './picture-fetch.ts';
import { makePicture } from './picture-import.ts';
import type { MakePicture } from './picture-thread.ts';

/** What the tools need of the server beyond the organisation: where pictures are kept, how they are fetched and made. */
export interface McpDeps {
  media: MediaStorage | null;
  fetchPicture: FetchPicture;
  /** Off the server's thread where it can be (picture-thread.ts); without it, on it. */
  makePicture?: MakePicture;
}

/** The protocol versions this server speaks, newest first; it uses nothing a later one changed. */
const VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

type Id = string | number;
interface Message {
  jsonrpc?: unknown;
  id?: Id | null;
  method?: unknown;
  params?: Record<string, unknown>;
}

const rpcError = (id: Id | null, code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } });
const result = (id: Id, value: unknown) => ({ jsonrpc: '2.0', id, result: value });

/**
 * Who an MCP key acts as (`McpKeyService.authenticate`), as a caller of the organisation's routes: its maker with the
 * role they have now. A missing or refused key is 401, so the client knows to ask for another.
 */
export async function authenticateMcp(req: Request, accounts: Accounts): Promise<Caller | Response> {
  const { token } = credentials(req);
  const key = token ? await accounts.mcpKeys.authenticate(token) : null;
  // Where to sign in (RFC 9728): claude.ai's connectors start their OAuth from this header.
  const challenge = `Bearer resource_metadata="${protectedResourceUrl(new URL(req.url).origin)}"`;
  if (!key) return Response.json({ error: 'unauthenticated' }, { status: 401, headers: { 'www-authenticate': challenge } });
  return { orgId: key.orgId, sessionId: `mcp:${key.keyId}`, ctx: { userId: key.userId, role: key.role }, signedInAt: 0, paired: false };
}

/** On this server's own thread: the codecs loaded on the first picture, so a server never asked for one never reads them. */
const inThread: MakePicture = async (bytes) => {
  const { pictureCodecs } = await import('./picture-codecs.ts');
  return makePicture(bytes, pictureCodecs);
};

/** Keeps a blob of the organisation's: its bytes stored and its row recorded, as an upload's are. */
type Keep = (hash: string, bytes: Uint8Array, type: string) => Promise<void>;

/**
 * A picture from the web, fitted as the app fits one and kept as two of the organisation's blobs. Fetched and made
 * outside the organisation's queue, and on Node in a worker thread where one is built, so a slow address or a large
 * photo never holds up sync or a live service; in a Worker the stateless part does it (`answerPictureCall`).
 */
async function importPicture(caller: Caller, deps: McpDeps, url: string, keep: Keep): Promise<ImportedPicture> {
  if (!can(caller.ctx.role, 'ManageImages')) throw new MutationError('forbidden', 'no permission to add pictures');
  if (!deps.media) throw new MutationError('media-disabled', 'this server keeps no pictures');
  const made = await (deps.makePicture ?? inThread)(await deps.fetchPicture(url));
  const kept = async (bytes: Uint8Array) => {
    const hash = await sha256HexBytes(bytes);
    await keep(hash, bytes, made.type);
    return hash;
  };
  return { picture: { full: await kept(made.full), thumb: await kept(made.thumb) }, width: made.width, height: made.height };
}

/** Runs one tool: each read and each change in the organisation's queue (or a run of them, `atomic`), a change poking the devices. */
function runTool(org: Org, caller: Caller, deps: McpDeps, name: string, args: unknown) {
  const sql: McpToolContext['sql'] = async (s, p) => org.store.rows(s, p);
  const mutate = async (mutator: MutatorName, a: object) => {
    const before = currentSeq(org.store);
    await org.store.transaction(() => runMutation(org.store, mutator, a, { ...caller.ctx, now: Date.now() }));
    const after = currentSeq(org.store);
    if (after > before) org.poke.changed(caller.sessionId, after);
  };
  const base = {
    importPicture: (url: string) => importPicture(caller, deps, url, (hash, bytes, type) => keepBlob(org, deps.media!, caller.orgId, hash, bytes, type)),
    newId: () => randomId(),
    now: Date.now,
  };
  // Inside one turn: the reads and changes straight, the queue already held.
  const inTurn: McpToolContext = { ...base, sql, mutate, atomic: (fn) => fn(inTurn) };
  const cx: McpToolContext = {
    ...base,
    sql: (s, p) => org.queue.run(() => sql(s, p)),
    mutate: (mutator, a) => org.queue.run(() => mutate(mutator, a)),
    atomic: (fn) => org.queue.run(() => fn(inTurn)),
  };
  return callMcpTool(name, args, cx);
}

/** A request that is one call of `add_picture_from_url`: its id and arguments, which a Worker answers itself. */
export function pictureCall(body: unknown): { id: Id; args: unknown } | null {
  if (!isMessage(body) || body.method !== 'tools/call' || body.id === undefined || body.id === null) return null;
  return body.params?.name === 'add_picture_from_url' ? { id: body.id, args: body.params.arguments } : null;
}

/**
 * `add_picture_from_url` answered in a Worker's stateless part, not in the organisation's object, whose one thread
 * runs its sync and live: there decoding a large photo would hold them up. `keep` stores the bytes and has the object
 * record them. The tool reads and changes nothing else, so its other means refuse.
 */
export async function answerPictureCall(call: { id: Id; args: unknown }, caller: Caller, deps: McpDeps, keep: Keep): Promise<object> {
  const none = () => {
    throw new Error('not in a Worker');
  };
  const cx: McpToolContext = { sql: none, mutate: none, atomic: none, importPicture: (url) => importPicture(caller, deps, url, keep), newId: () => randomId(), now: Date.now };
  return result(call.id, await callMcpTool('add_picture_from_url', call.args, cx));
}

type Log = (event: Record<string, unknown>) => void;

/** Whether a message is a JSON-RPC 2.0 request or notification. */
const isMessage = (m: unknown): m is Message =>
  !!m && typeof m === 'object' && !Array.isArray(m) && (m as Message).jsonrpc === '2.0' && typeof (m as Message).method === 'string';

/** The answer to one message; null for a notification or a response from the client, which need none. */
async function answerOne(org: Org, caller: Caller, deps: McpDeps, m: unknown, log: Log): Promise<object | null> {
  if (!isMessage(m)) return rpcError(null, -32600, 'Invalid request: not a JSON-RPC 2.0 message');
  // A notification (`notifications/initialized`, a cancel) needs no answer.
  if (m.id === undefined || m.id === null) return null;
  try {
    return await answer(org, caller, deps, m);
  } catch (e) {
    // Logged as the server's other errors are (server-error.ts), and answered as JSON-RPC's, so the assistant reads it.
    log({ event: 'server-error', method: 'POST', path: '/api/mcp', rpc: String(m.method), error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) });
    return rpcError(m.id, -32603, 'Internal error');
  }
}

async function answer(org: Org, caller: Caller, deps: McpDeps, m: Message): Promise<object> {
  const id = m.id!;
  const params = m.params ?? {};
  switch (m.method) {
    case 'initialize': {
      const asked = typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
      return result(id, {
        protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'gospel-presenter', title: 'Gospel Presenter', version: '2.0' },
        instructions:
          "Gospel Presenter's songs, Bible translations, presentations (a service's running order), themes and overlays of one church. " +
          'Find ids with search_songs, list_presentations, list_bibles, list_themes and list_overlays before using them. ' +
          'A picture from the web (a logo, a background) is fetched with add_picture_from_url, then placed on an overlay or a theme.',
      });
    }
    case 'ping':
      return result(id, {});
    case 'tools/list':
      return result(id, { tools: mcpTools() });
    case 'tools/call': {
      const name = typeof params.name === 'string' ? params.name : '';
      if (!isMcpTool(name)) return rpcError(id, -32602, `Unknown tool: ${name}`);
      return result(id, await runTool(org, caller, deps, name, params.arguments));
    }
    default:
      return rpcError(id, -32601, `Method not found: ${String(m.method)}`);
  }
}

export function mcpRoutes(resolve: (c: Context) => Promise<{ caller: Caller; org: Org } | Response>, log: Log, deps: McpDeps) {
  const app = new Hono();
  app.post('/api/mcp', async (c) => {
    const r = await resolve(c);
    if (r instanceof Response) return r;
    const body: unknown = await c.req.json().catch(() => undefined);
    // A batch (2024-11-05 and 2025-03-26 allow one; later versions send none): each message in turn, as one would be.
    if (Array.isArray(body)) {
      if (!body.length) return c.json(rpcError(null, -32600, 'Invalid request: an empty batch'), 400);
      const out: object[] = [];
      for (const m of body) {
        const a = await answerOne(r.org, r.caller, deps, m, log);
        if (a) out.push(a);
      }
      return out.length ? c.json(out) : c.body(null, 202);
    }
    if (!isMessage(body)) return c.json(rpcError(null, -32600, 'Invalid request: not a JSON-RPC 2.0 message'), 400);
    const a = await answerOne(r.org, r.caller, deps, body, log);
    return a ? c.json(a) : c.body(null, 202);
  });
  // No stream of the server's own messages, and no session to end.
  for (const method of ['GET', 'DELETE'] as const) app.on(method, '/api/mcp', (c) => c.body(null, 405, { allow: 'POST' }));
  return app;
}
