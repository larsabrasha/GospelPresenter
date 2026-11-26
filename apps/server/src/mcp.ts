// The MCP endpoint (docs/mcp.md): `POST /api/mcp` with `Authorization: Bearer gpmcp_…`, MCP's Streamable HTTP
// transport answered statelessly with plain JSON: no session id, no server-sent events, so it runs the same on Node
// and in an organisation's Durable Object. The tools are the core's (mcp-tools.ts); each runs in the organisation's
// queue, a change as its own transaction, announced to the devices as a push's is.
import { Hono, type Context } from 'hono';
import { callMcpTool, isMcpTool, mcpTools, randomId, type MutatorName } from '@gp/core';
import { runMutation } from '@gp/core/core';
import { currentSeq } from '@gp/sync/server';
import type { Org } from './app.ts';
import { credentials, type Caller } from './auth/index.ts';
import type { Accounts } from './global/index.ts';

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
  if (!key) return Response.json({ error: 'unauthenticated' }, { status: 401, headers: { 'www-authenticate': 'Bearer' } });
  return { orgId: key.orgId, sessionId: `mcp:${key.keyId}`, ctx: { userId: key.userId, role: key.role }, signedInAt: 0, paired: false };
}

/** Runs one tool in the organisation's queue; a change pokes the devices. */
function runTool(org: Org, caller: Caller, name: string, args: unknown) {
  return org.queue.run(async () => {
    const before = currentSeq(org.store);
    const out = await callMcpTool(name, args, {
      sql: async (s, p) => org.store.rows(s, p),
      mutate: (mutator: MutatorName, a: object) => org.store.transaction(() => runMutation(org.store, mutator, a, { ...caller.ctx, now: Date.now() })),
      newId: () => randomId(),
      now: Date.now,
    });
    const after = currentSeq(org.store);
    if (after > before) org.poke.changed(caller.sessionId, after);
    return out;
  });
}

type Log = (event: Record<string, unknown>) => void;

/** Whether a message is a JSON-RPC 2.0 request or notification. */
const isMessage = (m: unknown): m is Message =>
  !!m && typeof m === 'object' && !Array.isArray(m) && (m as Message).jsonrpc === '2.0' && typeof (m as Message).method === 'string';

/** The answer to one message; null for a notification or a response from the client, which need none. */
async function answerOne(org: Org, caller: Caller, m: unknown, log: Log): Promise<object | null> {
  if (!isMessage(m)) return rpcError(null, -32600, 'Invalid request: not a JSON-RPC 2.0 message');
  // A notification (`notifications/initialized`, a cancel) needs no answer.
  if (m.id === undefined || m.id === null) return null;
  try {
    return await answer(org, caller, m);
  } catch (e) {
    // Logged as the server's other errors are (server-error.ts), and answered as JSON-RPC's, so the assistant reads it.
    log({ event: 'server-error', method: 'POST', path: '/api/mcp', rpc: String(m.method), error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) });
    return rpcError(m.id, -32603, 'Internal error');
  }
}

async function answer(org: Org, caller: Caller, m: Message): Promise<object> {
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
          "Gospel Presenter's songs, Bible translations and presentations (a service's running order) of one church. " +
          'Find ids with search_songs, list_presentations and list_bibles before adding to a presentation.',
      });
    }
    case 'ping':
      return result(id, {});
    case 'tools/list':
      return result(id, { tools: mcpTools() });
    case 'tools/call': {
      const name = typeof params.name === 'string' ? params.name : '';
      if (!isMcpTool(name)) return rpcError(id, -32602, `Unknown tool: ${name}`);
      return result(id, await runTool(org, caller, name, params.arguments));
    }
    default:
      return rpcError(id, -32601, `Method not found: ${String(m.method)}`);
  }
}

export function mcpRoutes(resolve: (c: Context) => Promise<{ caller: Caller; org: Org } | Response>, log: Log) {
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
        const a = await answerOne(r.org, r.caller, m, log);
        if (a) out.push(a);
      }
      return out.length ? c.json(out) : c.body(null, 202);
    }
    if (!isMessage(body)) return c.json(rpcError(null, -32600, 'Invalid request: not a JSON-RPC 2.0 message'), 400);
    const a = await answerOne(r.org, r.caller, body, log);
    return a ? c.json(a) : c.body(null, 202);
  });
  // No stream of the server's own messages, and no session to end.
  for (const method of ['GET', 'DELETE'] as const) app.on(method, '/api/mcp', (c) => c.body(null, 405, { allow: 'POST' }));
  return app;
}
