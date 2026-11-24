// Trial: the largest picture (10 MiB) and sound (20 MiB) through the Worker into R2 and back.
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { MEDIA_LIMITS } from '../../../packages/core/src/index.ts';
import { setRole, startAdapter, tokenOf } from '../../../apps/server/test/harness.ts';

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
function fill(head: number[], size: number, seed: number) {
  const b = new Uint8Array(size);
  for (let i = 0; i < size; i++) b[i] = (i * 2654435761 + seed) >>> 24;
  b.set(head);
  return b;
}

it('a 10 MiB picture and a 20 MiB sound are stored in R2 and come back byte for byte; one byte more is refused', async () => {
  const h = await startAdapter('remote');
  const org = 'org-size-' + crypto.randomUUID();
  await setRole(h, 'anna', org, 'admin');
  const auth = { authorization: `Bearer ${tokenOf(h, org, 'anna')}` };
  const out: string[] = [];
  for (const [kind, head, size] of [
    ['picture', [0xff, 0xd8, 0xff, 0xe0], MEDIA_LIMITS.blobBytes],
    ['sound', [0x4f, 0x67, 0x67, 0x53], MEDIA_LIMITS.audioBytes],
  ] as const) {
    const bytes = fill([...head], size, kind.length);
    const hash = sha(bytes);
    let t = performance.now();
    const put = await fetch(`${h.url}/api/media/${hash}`, { method: 'PUT', headers: { ...auth, 'content-type': 'application/octet-stream' }, body: bytes });
    const putMs = performance.now() - t;
    expect(put.status, await put.clone().text()).toBe(204);
    t = performance.now();
    const res = await fetch(`${h.url}/api/media/${hash}`, { headers: auth });
    const back = new Uint8Array(await res.arrayBuffer());
    const getMs = performance.now() - t;
    expect(res.status).toBe(200);
    expect(back.length).toBe(size);
    expect(sha(back)).toBe(hash);
    out.push(`${kind} ${(size / 1048576).toFixed(0)} MiB: upload ${Math.round(putMs)} ms, download ${Math.round(getMs)} ms (${res.headers.get('content-type')})`);
    const over = fill([...head], size + 1, 7);
    let status: number | string;
    try {
      status = (await fetch(`${h.url}/api/media/${sha(over)}`, { method: 'PUT', headers: { ...auth, 'content-type': 'application/octet-stream' }, body: over })).status;
    } catch (e) {
      status = String((e as { cause?: { code?: string } }).cause?.code ?? e);
    }
    out.push(`${kind} +1 byte: ${status}`);
    expect([413, 'EPIPE', 'ECONNRESET']).toContain(status);
  }
  console.log('[measure] media:', out.join('; '));
}, 300_000);
