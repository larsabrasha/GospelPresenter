/** Messages between the page and its database worker. */
export type WorkerCall =
  | { op: 'open'; org: string; user: string; role: 'admin' | 'editor' | 'viewer'; file: string }
  | { op: 'mutate'; name: string; args: unknown }
  | { op: 'dump' }
  | { op: 'pending' }
  | { op: 'sync' }
  | { op: 'listen' }
  | { op: 'online'; online: boolean }
  | { op: 'integrity' }
  | { op: 'clientId' }
  | { op: 'close' };

export type WorkerReply = { id: number; ok: true; value: unknown } | { id: number; ok: false; error: string };
