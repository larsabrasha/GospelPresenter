// The worker thread a picture for MCP is made in on Node (picture-thread.ts): decoding, fitting and encoding take the
// processor for seconds on a large photo, which on the server's own thread would hold up sync and a live service (and,
// in the desktop app, its main process). Bundled on its own beside the server (apps/server/build-node.mjs,
// apps/desktop/build.mjs).
import { parentPort } from 'node:worker_threads';
import { MutationError } from '@gp/core';
import { pictureCodecs } from './picture-codecs.ts';
import { makePicture } from './picture-import.ts';

parentPort?.on('message', async ({ id, bytes }: { id: number; bytes: Uint8Array }) => {
  try {
    const made = await makePicture(bytes, pictureCodecs);
    parentPort?.postMessage({ id, made });
  } catch (e) {
    // A refusal keeps its code, for the assistant to read; anything else is the server's error.
    parentPort?.postMessage({ id, error: e instanceof MutationError ? { code: e.code, message: e.message } : { message: e instanceof Error ? e.message : String(e) } });
  }
});
