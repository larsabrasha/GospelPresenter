// The page: starts the database worker and exposes it as window.gp for the tests.
import type { WorkerCall, WorkerReply } from './protocol.ts';

const worker = new Worker('/db-worker.js', { type: 'module' });
const waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
let next = 1;

worker.onmessage = (e: MessageEvent<WorkerReply>) => {
  const w = waiting.get(e.data.id);
  waiting.delete(e.data.id);
  if (e.data.ok) w?.resolve(e.data.value);
  else w?.reject(new Error(e.data.error));
};

function call(c: WorkerCall): Promise<unknown> {
  const id = next++;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    worker.postMessage({ id, call: c });
  });
}

(window as unknown as { gp: unknown }).gp = { call };
