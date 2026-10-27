// The media storage (ADR 0007 decision 9, D31): a content-addressed key needs
// only put, get and delete, which a folder does as well as an object store.
// Three adapters: a folder on disk (`media-disk.ts`: the desktop host and, by
// default, a self-hosted server), R2 through its Workers binding, and memory
// (tests). S3 is not built yet (README, "Not done yet").

export interface MediaStorage {
  /** Stores the bytes under the key; the same key again is the same bytes (it names their hash). */
  put(key: string, bytes: Uint8Array): Promise<void>;
  /** The bytes, or null if there is no such key. */
  get(key: string): Promise<Uint8Array | null>;
  /** Removes the key; a no-op if it is not there. */
  delete(key: string): Promise<void>;
}

export function memoryStorage(): MediaStorage & { keys(): string[] } {
  const objects = new Map<string, Uint8Array>();
  return {
    put: async (key, bytes) => void objects.set(key, bytes.slice()),
    get: async (key) => objects.get(key)?.slice() ?? null,
    delete: async (key) => void objects.delete(key),
    keys: () => [...objects.keys()],
  };
}

/** The part of an R2 bucket this uses: the binding in a Worker, and a fake in tests. */
export interface R2Like {
  put(key: string, value: ArrayBuffer | Uint8Array): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  delete(key: string): Promise<void>;
}

export function r2Storage(bucket: R2Like): MediaStorage {
  return {
    put: async (key, bytes) => void (await bucket.put(key, bytes)),
    get: async (key) => {
      const object = await bucket.get(key);
      return object ? new Uint8Array(await object.arrayBuffer()) : null;
    },
    delete: (key) => bucket.delete(key),
  };
}
