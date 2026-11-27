// MCP's sign-in by OAuth (docs/mcp.md, "OAuth"), against every server adapter, as claude.ai's connector goes through it:
// metadata, registration, the person allowing it in the app, the code traded with PKCE, and the tokens.
import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { McpKeyRow, Role } from '@gp/core';
import { api, setRole, startAdapter, type AdapterName, type Harness } from './harness.ts';

const adapters = (process.env.SYNC_ADAPTERS ?? 'node,node-sqlite,workers').split(',').filter((a) => a !== 'remote') as AdapterName[];

const CALLBACK = 'http://localhost:6274/oauth/callback';
const b64url = (b: Buffer) => b.toString('base64url');
type Tokens = { access_token: string; refresh_token: string; expires_in: number; error?: string };

for (const adapter of adapters) {
  describe(`MCP's OAuth (${adapter})`, () => {
    let h: Harness;
    beforeAll(async () => {
      h = await startAdapter(adapter);
    }, 60_000);
    afterAll(async () => {
      await h?.close();
    });

    let org: string;
    let su: string;
    beforeEach(async () => {
      org = `org-${crypto.randomUUID()}`;
      su = await setRole(h, `su-${crypto.randomUUID()}`, org, 'superAdmin');
    });

    /** A member of `org` with a fresh session, MCP on for them unless `mcp` is false. */
    async function member(role: Role = 'user', mcp = true) {
      const id = `u-${crypto.randomUUID()}`;
      const token = await setRole(h, id, org, role);
      if (mcp) expect((await api(h, 'PUT', `/api/users/${id}/mcp`, { token: su, body: { enabled: true } })).status).toBe(200);
      return token;
    }
    const register = (redirect_uris: string[]) => api<{ client_id: string; error?: string }>(h, 'POST', '/api/oauth/register', { body: { client_name: 'Claude', redirect_uris } });
    const token = (form: Record<string, string>) =>
      fetch(`${h.url}/api/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form) }).then(async (r) => ({
        status: r.status,
        body: (await r.json()) as Tokens,
      }));
    const mcp = (bearer: string) => api(h, 'POST', '/api/mcp', { token: bearer, body: { jsonrpc: '2.0', id: 1, method: 'tools/list' } });

    /** The way through as claude.ai goes it: registered, allowed by `session`, the code traded. */
    async function signIn(session: string, verifier = b64url(randomBytes(32))) {
      const client = (await register([CALLBACK])).body.client_id;
      const challenge = b64url(createHash('sha256').update(verifier).digest());
      const allowed = await api<{ redirect: string }>(h, 'POST', '/api/oauth/authorize', {
        token: session,
        body: { clientId: client, redirectUri: CALLBACK, codeChallenge: challenge, state: 'st-1' },
      });
      const code = new URL(allowed.body.redirect).searchParams.get('code')!;
      return { client, code, allowed, tokens: () => token({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: client, redirect_uri: CALLBACK }) };
    }

    it('says where to sign in, with PKCE S256, and the MCP endpoint names it in its 401', async () => {
      const meta = await api<{ token_endpoint: string; code_challenge_methods_supported: string[] }>(h, 'GET', '/.well-known/oauth-authorization-server');
      const unauthorised = await fetch(`${h.url}/api/mcp`, { method: 'POST', body: '{}' });

      expect(meta.body.token_endpoint).toBe(`${h.url}/api/oauth/token`);
      expect(meta.body.code_challenge_methods_supported).toEqual(['S256']);
      expect(unauthorised.headers.get('www-authenticate')).toBe(`Bearer resource_metadata="${h.url}/.well-known/oauth-protected-resource"`);
    });

    it('registers no client whose code would go to an address that is not an assistant\'s', async () => {
      const r = await register(['https://evil.example/callback']);

      expect(r.status).toBe(400);
      expect(r.body.error).toBe('invalid_redirect_uri');
    });

    it('sends the code back with its state, and trades it with PKCE for tokens that open the MCP endpoint', async () => {
      const session = await member();
      const s = await signIn(session);

      const t = await s.tokens();

      expect(new URL(s.allowed.body.redirect).searchParams.get('state')).toBe('st-1');
      expect(t.status).toBe(200);
      expect((await mcp(t.body.access_token)).status).toBe(200);
    });

    it('trades a code only once', async () => {
      const s = await signIn(await member());
      await s.tokens();

      const again = await s.tokens();

      expect(again.body.error).toBe('invalid_grant');
    });

    it('refuses a code traded with another verifier than the one it was challenged with', async () => {
      const s = await signIn(await member());

      const t = await token({ grant_type: 'authorization_code', code: s.code, code_verifier: b64url(randomBytes(32)), client_id: s.client });

      expect(t.body.error).toBe('invalid_grant');
    });

    it('renews with a refresh token once: it is traded for new tokens, and refused after', async () => {
      const s = await signIn(await member());
      const first = (await s.tokens()).body;

      const renewed = await token({ grant_type: 'refresh_token', refresh_token: first.refresh_token });
      const again = await token({ grant_type: 'refresh_token', refresh_token: first.refresh_token });

      expect((await mcp(renewed.body.access_token)).status).toBe(200);
      expect(again.body.error).toBe('invalid_grant');
    });

    it('allows nothing for someone MCP is off for', async () => {
      const session = await member('user', false);
      const client = (await register([CALLBACK])).body.client_id;

      const r = await api(h, 'POST', '/api/oauth/authorize', { token: session, body: { clientId: client, redirectUri: CALLBACK, codeChallenge: 'a'.repeat(43), state: '' } });

      expect(r.status).toBe(403);
    });

    it('makes no key for a code that is never traded', async () => {
      const session = await member();
      await signIn(session);

      const keys = await api<McpKeyRow[]>(h, 'GET', '/api/auth/mcp-keys', { token: session });

      expect(keys.body).toEqual([]);
    });

    it('replaces the key of an earlier sign-in of the same assistant, rather than adding one, and shuts its tokens out', async () => {
      const session = await member();
      const first = (await (await signIn(session)).tokens()).body;

      await (await signIn(session)).tokens();

      const keys = await api<McpKeyRow[]>(h, 'GET', '/api/auth/mcp-keys', { token: session });
      expect(keys.body.map((k) => k.name)).toEqual(['Claude']);
      expect((await mcp(first.access_token)).status).toBe(401);
    });

    it('lists the sign-in among the keys by the assistant\'s name, and deleting it there shuts its tokens out', async () => {
      const session = await member();
      const t = (await (await signIn(session)).tokens()).body;
      const keys = await api<McpKeyRow[]>(h, 'GET', '/api/auth/mcp-keys', { token: session });

      await api(h, 'DELETE', `/api/auth/mcp-keys/${keys.body[0]!.id}`, { token: session });

      expect(keys.body.map((k) => k.name)).toEqual(['Claude']);
      expect((await mcp(t.access_token)).status).toBe(401);
      expect((await token({ grant_type: 'refresh_token', refresh_token: t.refresh_token })).body.error).toBe('invalid_grant');
    });
  });
}
