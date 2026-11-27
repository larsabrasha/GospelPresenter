// A picture for MCP made in the bundled worker thread (src/picture-thread.ts, src/picture-worker.ts), as the desktop
// host and a self-hosted server make one: off the thread that runs sync and live. And a fetch that takes too long.
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { webFetchPicture } from '../src/picture-fetch.ts';
import { threadPictureMaker } from '../src/picture-thread.ts';

/** A small opaque PNG, made here. */
function png(width: number, height: number): Uint8Array {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8 bits, RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 200)]);
  const pixels = deflateSync(Buffer.concat(Array.from({ length: height }, () => row)));
  return new Uint8Array(Buffer.concat([Buffer.from('\x89PNG\r\n\x1a\n', 'binary'), chunk('IHDR', header), chunk('IDAT', pixels), chunk('IEND', Buffer.alloc(0))]));
}

describe('a picture made in the worker thread', () => {
  let dir: string;
  let worker: string;
  beforeAll(async () => {
    // Bundled as build-node.mjs bundles it: the codecs' WebAssembly inside, as bytes.
    dir = mkdtempSync(join(tmpdir(), 'gp-picture-'));
    worker = join(dir, 'picture-worker.mjs');
    await build({ entryPoints: [join(import.meta.dirname, '..', 'src', 'picture-worker.ts')], outfile: worker, bundle: true, platform: 'node', target: 'node22', format: 'esm', loader: { '.wasm': 'binary' }, logLevel: 'silent' });
  }, 60_000);
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('comes back fitted within 1920×1080, in both sizes', async () => {
    const make = threadPictureMaker(worker);

    const made = await make(png(3000, 1000));

    expect([made.type, made.width, made.height, made.thumb.length > 0]).toEqual(['image/webp', 1920, 640, true]);
  });

  it('keeps the reason a file is refused, for the assistant to read', async () => {
    const make = threadPictureMaker(worker);

    await expect(make(new TextEncoder().encode('<!doctype html>'))).rejects.toMatchObject({ code: 'invalid-image' });
  });
});

describe('a picture fetched from a server that answers too slowly', () => {
  let slow: Server;
  let url: string;
  beforeAll(async () => {
    // Sends its header and a first byte, then nothing more.
    slow = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.write(Buffer.from([0x89]));
    });
    await new Promise<void>((resolve) => slow.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(slow.address() as AddressInfo).port}/logo.png`;
  });
  afterAll(() => {
    slow.closeAllConnections();
    slow.close();
  });

  it('is given up at its time limit, the body read too', async () => {
    const fetchPicture = webFetchPicture({ allowLoopback: true, timeoutMs: 300 });

    await expect(fetchPicture(url)).rejects.toMatchObject({ code: 'fetch-failed' });
  });
});
