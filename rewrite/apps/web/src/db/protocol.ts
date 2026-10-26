import type { Role } from '@gp/core';

/** Who is signed in. Placeholder until milestone 2 brings real sign-in. */
export interface Session {
  userId: string;
  orgId: string;
  role: Role;
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
