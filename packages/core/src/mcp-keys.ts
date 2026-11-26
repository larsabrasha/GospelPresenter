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
