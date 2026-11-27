// MCP's sign-in by OAuth 2.1 (docs/mcp.md, "OAuth"), which claude.ai's and a phone's connectors ask for, as praliner's
// (github.com/larsabrasha/praliner, server/oauth.ts): the metadata that says where to sign in, an assistant registering
// itself (RFC 7591) or naming the document that describes it (Claude's published identity), the app's own page where
// the signed-in person allows it (apps/web/src/pages/OAuthAllow.tsx, through `/api/oauth/client` and
// `/api/oauth/authorize`), and the token endpoint, with PKCE, where a code becomes tokens and a refresh token new ones.
import type { Context, Hono } from 'hono';
import { oauthAuthorizeRequest, type OAuthClientInfo } from '@gp/core';
import { THROTTLE } from '../global/index.ts';
import { challengeOf, OAUTH, REDIRECT_HOSTS, redirectAllowed, type OAuthClient } from '../global/oauth.ts';
import { body, fail, type AuthKit } from './kit.ts';

/** The MCP endpoint's address, which the tokens are for. */
const resourceOf = (c: Context) => `${new URL(c.req.url).origin}/api/mcp`;

/** Where an MCP client learns how to sign in (RFC 9728), named in the 401 of `/api/mcp`. */
export const protectedResourceUrl = (origin: string) => `${origin}/.well-known/oauth-protected-resource`;

const oauthError = (c: Context, error: string, description: string, status: 400 | 401 = 400) => c.json({ error, error_description: description }, status);

/** A token request's fields, sent as a form or as JSON. */
async function fields(c: Context): Promise<Record<string, string>> {
  const json = (c.req.header('content-type') ?? '').includes('application/json');
  const raw = json ? ((await c.req.json().catch(() => ({}))) as Record<string, unknown>) : await c.req.parseBody().catch(() => ({}));
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, typeof v === 'string' ? v : '']));
}

const withParams = (uri: string, params: Record<string, string>) => {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
  return u.toString();
};

/**
 * A client named by the address of a document that describes it (Client ID Metadata Document), as Claude's published
 * identity is: only at Claude's and ChatGPT's hosts, never followed through a redirect, and only its addresses that
 * may receive a code.
 */
async function documentClient(url: string): Promise<OAuthClient | null> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || !REDIRECT_HOSTS.includes(u.hostname)) return null;
  // Ten seconds for the document and its body: a slow host holds the sign-in up no longer.
  const signal = AbortSignal.timeout(10_000);
  const res = await fetch(url, { headers: { accept: 'application/json' }, redirect: 'manual', signal }).catch(() => null);
  if (res?.status !== 200) return null;
  const doc = (await res.json().catch(() => null)) as { client_id?: unknown; client_name?: unknown; redirect_uris?: unknown } | null;
  if (!doc || doc.client_id !== url || !Array.isArray(doc.redirect_uris)) return null;
  const uris = doc.redirect_uris.filter((x): x is string => typeof x === 'string' && redirectAllowed(x));
  const name = typeof doc.client_name === 'string' && doc.client_name.trim() ? doc.client_name.trim() : u.hostname;
  return { id: url, name: name.slice(0, 80), redirectUris: uris };
}

export function oauthRoutes(app: Hono, kit: AuthKit) {
  const { accounts, withCaller, mayMakeAdmin, tooMany, deps } = kit;

  /** The client and the address its answer goes to, if they belong together; null otherwise, and nothing is sent there. */
  const clientAndRedirect = async (clientId: string, redirectUri: string | undefined) => {
    const client = !clientId ? null : clientId.startsWith('https://') ? await documentClient(clientId) : await accounts.oauth.client(clientId);
    const uri = redirectUri || (client?.redirectUris.length === 1 ? client.redirectUris[0] : undefined);
    return client && uri && client.redirectUris.includes(uri) ? { client, redirectUri: uri } : null;
  };

  const resourceMetadata = (c: Context) => ({
    resource: resourceOf(c),
    authorization_servers: [new URL(c.req.url).origin],
    bearer_methods_supported: ['header'],
    resource_name: 'Gospel Presenter',
  });
  app.get('/.well-known/oauth-protected-resource', (c) => c.json(resourceMetadata(c)));
  app.get('/.well-known/oauth-protected-resource/api/mcp', (c) => c.json(resourceMetadata(c)));
  app.get('/.well-known/oauth-authorization-server', (c) => {
    const origin = new URL(c.req.url).origin;
    return c.json({
      issuer: origin,
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/api/oauth/token`,
      registration_endpoint: `${origin}/api/oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      client_id_metadata_document_supported: true,
    });
  });

  // Dynamic client registration (RFC 7591): only with addresses at Claude's, ChatGPT's or this machine.
  app.post('/api/oauth/register', async (c) => {
    const locked = await accounts.throttle.count([`oauth-client:${deps.clientAddress(c)}`], THROTTLE.oauthClient);
    if (locked) return tooMany(locked);
    const b = (await c.req.json().catch(() => ({}))) as { redirect_uris?: unknown; client_name?: unknown };
    const uris = Array.isArray(b.redirect_uris) ? b.redirect_uris.filter((u): u is string => typeof u === 'string') : [];
    if (!uris.length || uris.length > 10) return oauthError(c, 'invalid_redirect_uri', 'redirect_uris is missing');
    const refused = uris.find((u) => !redirectAllowed(u));
    if (refused) return oauthError(c, 'invalid_redirect_uri', `not an address a code is sent to: ${refused}`);
    const name = typeof b.client_name === 'string' && b.client_name.trim() ? b.client_name.trim().slice(0, 80) : 'En app';
    const client = await accounts.oauth.addClient(name, uris);
    return c.json(
      {
        client_id: client.id,
        client_id_issued_at: Math.floor(accounts.now() / 1000),
        client_name: client.name,
        redirect_uris: client.redirectUris,
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      },
      201,
    );
  });

  // What the app's page shows before it is allowed; an unknown client or an address not its own is not-found.
  app.get(
    '/api/oauth/client',
    withCaller(null, async (c, caller) => {
      const found = await clientAndRedirect(c.req.query('client_id') ?? '', c.req.query('redirect_uri'));
      if (!found) return fail(c, 404, 'not-found');
      const orgs = await accounts.members.orgsOf(caller.ctx.userId, caller.ctx.role === 'superAdmin');
      const info: OAuthClientInfo = {
        name: found.client.name,
        redirectHost: new URL(found.redirectUri).host,
        orgName: orgs.find((o) => o.id === caller.orgId)?.name ?? '',
        mcp: await accounts.mcpKeys.enabled(caller.ctx.userId),
      };
      return c.json({ ...info, redirectUri: found.redirectUri });
    }),
  );

  // Allowed: a code for the assistant, for whoever may make a key in the session's organisation (the experiment on, a
  // member there), from a fresh sign-in or a desktop host's window, as a key. Its key is made when the code is traded.
  app.post(
    '/api/oauth/authorize',
    withCaller(null, async (c, caller) => {
      if (caller.paired) return fail(c, 403, 'forbidden');
      const a = await body(c, oauthAuthorizeRequest);
      if (!a) return fail(c, 400, 'invalid-request');
      const found = await clientAndRedirect(a.clientId, a.redirectUri);
      if (!found) return fail(c, 404, 'not-found');
      if (!(await mayMakeAdmin(c, caller))) return fail(c, 403, 'reauth-required');
      if (!(await accounts.mcpKeys.mayMake(caller.ctx.userId, caller.orgId))) return fail(c, 403, 'forbidden');
      const code = await accounts.oauth.addCode({
        clientId: found.client.id,
        clientName: found.client.name,
        redirectUri: found.redirectUri,
        challenge: a.codeChallenge,
        userId: caller.ctx.userId,
        orgId: caller.orgId,
      });
      return c.json({ redirect: withParams(found.redirectUri, { code, state: a.state }) });
    }),
  );

  const issue = async (c: Context, keyId: string, clientId: string) => {
    await accounts.oauth.purge();
    const t = await accounts.oauth.issue(keyId, clientId);
    c.header('cache-control', 'no-store');
    return c.json({ access_token: t.access, token_type: 'Bearer', expires_in: OAUTH.accessMs / 1000, refresh_token: t.refresh });
  };

  app.post('/api/oauth/token', async (c) => {
    const f = await fields(c);
    if (f.grant_type === 'authorization_code') {
      const data = f.code ? await accounts.oauth.takeCode(f.code) : null;
      if (!data) return oauthError(c, 'invalid_grant', 'the code is not valid (any longer)');
      if (f.client_id && f.client_id !== data.clientId) return oauthError(c, 'invalid_grant', 'another client');
      if (f.redirect_uri && f.redirect_uri !== data.redirectUri) return oauthError(c, 'invalid_grant', 'another address');
      if (!f.code_verifier || (await challengeOf(f.code_verifier)) !== data.challenge) return oauthError(c, 'invalid_grant', 'PKCE does not match');
      // The sign-in's key now, with the rules of a key as they stand: the experiment may have been turned off since.
      const key = await accounts.mcpKeys.createForAssistant(data.userId, data.orgId, data.clientName);
      if (key === 'forbidden') return oauthError(c, 'invalid_grant', 'MCP is no longer allowed for this person here');
      if (key === 'limit') return oauthError(c, 'invalid_grant', 'ten MCP keys already: delete one under Mina inställningar');
      return issue(c, key.key.id, data.clientId);
    }
    if (f.grant_type === 'refresh_token') {
      const found = f.refresh_token ? await accounts.oauth.takeRefresh(f.refresh_token) : null;
      if (!found || (f.client_id && f.client_id !== found.clientId)) return oauthError(c, 'invalid_grant', 'sign in again');
      return issue(c, found.keyId, found.clientId);
    }
    return oauthError(c, 'unsupported_grant_type', 'authorization_code and refresh_token only');
  });
}
