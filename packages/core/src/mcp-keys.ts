// MCP keys (docs/mcp.md): an experiment a Superadmin turns on per person. Someone it is on for makes their own keys
// under Mina inställningar; a key acts as its maker, with the role they have now in the organisation it was made in
// (D27), and stops while the experiment is off for them.
import { z } from 'zod';

export const MCP_LIMITS = {
  /** Keys per person (AUTH-R14). */
  keysPerUser: 10,
  /** The most characters of a key's name. */
  keyName: 200,
} as const;

/** What a key starts with, so a log or a scan for secrets tells one from a session's token. */
export const MCP_KEY_PREFIX = 'gpmcp_';

/** A key as Mina inställningar lists it: never its secret, which is shown once (AUTH-R13). */
export interface McpKeyRow {
  id: string;
  name: string;
  /** The organisation the key acts in. */
  orgName: string;
  createdAt: number;
  /** Null until it is first used. */
  lastUsedAt: number | null;
}

/** `POST /api/auth/mcp-keys`: a new key in the session's organisation. */
export const createMcpKeyRequest = z.object({ name: z.string().trim().min(1).max(MCP_LIMITS.keyName) });

/** The answer to a new key: the row, and the secret this once. */
export interface McpKeyCreated {
  key: McpKeyRow;
  secret: string;
}

/** `PUT /api/users/{id}/mcp`: a Superadmin turns the experiment on or off for someone. */
export const setMcpRequest = z.object({ enabled: z.boolean() });

/**
 * `POST /api/oauth/authorize`: the signed-in person lets an assistant (Claude on claude.ai or a phone) use the
 * session's organisation through MCP, as its OAuth sign-in page asked (docs/mcp.md, "OAuth").
 */
export const oauthAuthorizeRequest = z.object({
  clientId: z.string().min(1).max(2000),
  redirectUri: z.string().min(1).max(2000),
  codeChallenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  state: z.string().max(2000),
});

/** `GET /api/oauth/client`: what the sign-in page shows before it is allowed: who asks, and where it goes back to. */
export interface OAuthClientInfo {
  name: string;
  /** The host the answer goes to, so the person sees it is Claude's. */
  redirectHost: string;
  /** The organisation the assistant would act in: the session's. */
  orgName: string;
  /** Whether the experiment is on for the person; off, nothing can be allowed. */
  mcp: boolean;
}
