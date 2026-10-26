import type { Role } from '@gp/core';

/** Who is signed in, as the database worker needs it (see auth/session.ts). */
export interface Session {
  userId: string;
  orgId: string;
  /** The role the server last gave; drives optimistic checks only. The server checks again. */
  role: Role;
  /** The session's bearer token. */
  token: string;
  /** The paired-device token, on a desktop host's LAN. */
  device: string | null;
  /** 'memory' keeps the database in memory even where OPFS exists (development and tests). */
  storage?: 'memory';
}

export interface DbStatus {
  /** 'opfs', or 'memory' with the reason OPFS was not available. */
  storage: string;
  /** The poke socket is open, so changes arrive within a second. */
  connected: boolean;
  pending: number;
  updateRequired: boolean;
  /** The server refused this device's credentials: sync has stopped and local edits wait (SYNC-A15). */
  authError: 'unauthenticated' | 'not-a-member' | 'device-not-paired' | null;
  /** Mutations the server refused, newest last. */
  rejected: { id: number; error: string }[];
}

export type DbCall =
  | { op: 'open'; session: Session }
  | { op: 'mutate'; name: string; args: unknown }
  | { op: 'query'; sql: string; params: unknown[] }
  | { op: 'status' }
  | { op: 'syncNow' };

export type DbMessage =
  | { type: 'reply'; id: number; ok: true; value: unknown }
  | { type: 'reply'; id: number; ok: false; error: string }
  | { type: 'changed' }
  | { type: 'status'; status: DbStatus };
