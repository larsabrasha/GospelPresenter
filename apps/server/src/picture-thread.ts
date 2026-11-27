// A picture for MCP made in a worker thread on Node (picture-worker.ts), off the thread that runs sync and live: the
// desktop host and a self-hosted server pass where the bundled worker is. Without one (the tests, a server run from
// source) the picture is made on the server's own thread, as before.
import { Worker } from 'node:worker_threads';
import { MutationError } from '@gp/core';
import type { MadePicture } from './picture-import.ts';

export type MakePicture = (bytes: Uint8Array) => Promise<MadePicture>;

type Answer = { id: number; made?: MadePicture; error?: { code?: string; message: string } };

/** Makes pictures one worker thread at a time, started on the first and started again if it dies. */
export function threadPictureMaker(workerFile: string): MakePicture {
  let worker: Worker | null = null;
  let next = 0;
  const waiting = new Map<number, { resolve: (m: MadePicture) => void; reject: (e: Error) => void }>();
  const started = () => {
    if (worker) return worker;
    const w = new Worker(workerFile);
    w.on('message', (a: Answer) => {
      const p = waiting.get(a.id);
      waiting.delete(a.id);
      if (!p) return;
      if (a.made) p.resolve(a.made);
      else p.reject(a.error?.code ? new MutationError(a.error.code, a.error.message) : new Error(a.error?.message ?? 'the picture was not made'));
    });
    // A thread that dies takes its pictures with it; the next one starts a new thread.
    const fail = (e: Error) => {
      for (const p of waiting.values()) p.reject(e);
      waiting.clear();
      worker = null;
    };
    w.on('error', fail);
    w.on('exit', (code) => code !== 0 && fail(new Error(`the picture thread stopped (${code})`)));
    // It keeps no Node process alive by itself: a server that is closed ends.
    w.unref();
    worker = w;
    return w;
  };
  return (bytes) =>
    new Promise<MadePicture>((resolve, reject) => {
      const id = next++;
      waiting.set(id, { resolve, reject });
      started().postMessage({ id, bytes });
    });
}
