// The wire format, copied from Replicache's push/pull protocol.

/** Wire-format version this build speaks. */
export const PROTOCOL_VERSION = 1;

export interface PushMutation {
  id: number; // per-client, monotonic, starting at 1
  name: string;
  v: number; // mutator version
  args: unknown;
}

export interface PushRequest {
  protocol: number;
  schemaVersion: number;
  clientId: string;
  mutations: PushMutation[];
}

export interface MutationResult {
  id: number;
  error: string;
}

export interface PushResponse {
  lastMutationId: number;
  results: MutationResult[];
}

export interface PullRequest {
  protocol: number;
  schemaVersion: number;
  clientId: string;
  cookie: string | null;
  /** The last mutation id this client has already seen confirmed, so errors are reported once. */
  lastMutationId: number;
}

export type PatchOp =
  | { op: 'put'; tbl: string; row: Record<string, unknown> }
  | { op: 'del'; tbl: string; pk: string };

export interface PullResponse {
  cookie: string;
  lastMutationId: number;
  /** The client must drop every synced row before applying `patch`. */
  clear: boolean;
  patch: PatchOp[];
  /** More pages follow; pull again with the returned cookie before rebasing. */
  more: boolean;
  results: MutationResult[];
}

/** Body of a 426 answer to a client the server can no longer serve (SYNC-R35). Clients key on `error`, not the status. */
export interface UpdateRequired {
  error: 'update-required';
  minimumProtocol: number;
  detail: string;
}

export interface Poke {
  type: 'poke';
  seq: number;
}
