// The media storage (ADR 0007 decision 9, D31): a content-addressed key needs
// only put, get and delete, which a folder does as well as an object store.
// A video adds two things (TODO.md "Video"): it is read a range at a time,
// never whole, and it arrives in parts. Three adapters: a folder on disk
// (`media-disk.ts`: the desktop host and, by default, a self-hosted server),
// R2 through its Workers binding, and memory (tests). S3 is not built yet
// (docs/not-done-yet.md).

/** A range of an object: `length` bytes from `offset`, fewer at its end. */
export interface ByteRange {
  offset: number;
  length: number;
}

export interface MediaStorage {
  /** Stores the bytes under the key; the same key again is the same bytes (it names their hash). */
  put(key: string, bytes: Uint8Array): Promise<void>;
  /** The bytes, or null if there is no such key. */
  get(key: string): Promise<Uint8Array | null>;
  /** A range of the bytes as a stream (all of them without one), or null if there is no such key. */
  read(key: string, range?: ByteRange): Promise<ReadableStream<Uint8Array> | null>;
  /** Removes the key; a no-op if it is not there. */
  delete(key: string): Promise<void>;
  /**
   * An upload in parts: started, given its parts in order (a part again
   * replaces it), then finished, when the object appears under the key, or
   * aborted. `offset` is where the part starts in the whole; the token a
   * part returns goes back to `finishUpload`, in part order.
   */
  startUpload(key: string): Promise<string>;
  putPart(key: string, uploadId: string, part: number, offset: number, bytes: Uint8Array): Promise<string>;
  finishUpload(key: string, uploadId: string, parts: string[]): Promise<void>;
  abortUpload(key: string, uploadId: string): Promise<void>;
}

/** Reads a whole stream. */
export async function streamBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function memoryStorage(): MediaStorage & { keys(): string[]; uploads(): number } {
  const objects = new Map<string, Uint8Array>();
  const uploads = new Map<string, Map<number, Uint8Array>>();
  let next = 0;
  return {
    put: async (key, bytes) => void objects.set(key, bytes.slice()),
    get: async (key) => objects.get(key)?.slice() ?? null,
    async read(key, range) {
      const bytes = objects.get(key);
      if (!bytes) return null;
      const part = range ? bytes.slice(range.offset, range.offset + range.length) : bytes.slice();
      return new Blob([part as BlobPart]).stream();
    },
    delete: async (key) => void objects.delete(key),
    async startUpload(key) {
      const id = `${key}#${next++}`;
      uploads.set(id, new Map());
      return id;
    },
    async putPart(_key, uploadId, part, _offset, bytes) {
      const parts = uploads.get(uploadId);
      if (!parts) throw new Error('no such upload');
      parts.set(part, bytes.slice());
      return String(part);
    },
    async finishUpload(key, uploadId, tokens) {
      const parts = uploads.get(uploadId);
      if (!parts) throw new Error('no such upload');
      const chunks = tokens.map((t) => parts.get(Number(t))!);
      const whole = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
      let at = 0;
      for (const c of chunks) {
        whole.set(c, at);
        at += c.length;
      }
      objects.set(key, whole);
      uploads.delete(uploadId);
    },
    abortUpload: async (_key, uploadId) => void uploads.delete(uploadId),
    keys: () => [...objects.keys()],
    uploads: () => uploads.size,
  };
}

/** The part of an R2 bucket this uses: the binding in a Worker, and a fake in tests. */
export interface R2Like {
  put(key: string, value: ArrayBuffer | Uint8Array): Promise<unknown>;
  get(key: string, options?: { range?: ByteRange }): Promise<{ arrayBuffer(): Promise<ArrayBuffer>; body: ReadableStream<Uint8Array> } | null>;
  delete(key: string): Promise<void>;
  createMultipartUpload(key: string): Promise<{ uploadId: string }>;
  resumeMultipartUpload(
    key: string,
    uploadId: string,
  ): {
    uploadPart(part: number, value: Uint8Array): Promise<{ partNumber: number; etag: string }>;
    complete(parts: { partNumber: number; etag: string }[]): Promise<unknown>;
    abort(): Promise<void>;
  };
}

export function r2Storage(bucket: R2Like): MediaStorage {
  return {
    put: async (key, bytes) => void (await bucket.put(key, bytes)),
    get: async (key) => {
      const object = await bucket.get(key);
      return object ? new Uint8Array(await object.arrayBuffer()) : null;
    },
    read: async (key, range) => (await bucket.get(key, range ? { range } : undefined))?.body ?? null,
    delete: (key) => bucket.delete(key),
    startUpload: async (key) => (await bucket.createMultipartUpload(key)).uploadId,
    putPart: async (key, uploadId, part, _offset, bytes) => (await bucket.resumeMultipartUpload(key, uploadId).uploadPart(part, bytes)).etag,
    finishUpload: async (key, uploadId, etags) => void (await bucket.resumeMultipartUpload(key, uploadId).complete(etags.map((etag, i) => ({ partNumber: i + 1, etag })))),
    abortUpload: async (key, uploadId) => {
      // An upload R2 no longer knows (finished, aborted, or expired after seven days) has nothing to abort.
      await bucket
        .resumeMultipartUpload(key, uploadId)
        .abort()
        .catch(() => undefined);
    },
  };
}
