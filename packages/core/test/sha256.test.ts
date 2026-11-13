import { describe, expect, it } from 'vitest';
import { Sha256, sha256, sha256Async, utf8Encode, type Sha256State } from '@gp/core';

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const subtle = (globalThis as unknown as { crypto: { subtle: { digest(a: string, d: Uint8Array): Promise<ArrayBuffer> } } }).crypto.subtle;

// The plain-JavaScript SHA-256 for pages without Web Crypto (a tablet over http on the LAN).
describe('sha256 without Web Crypto', () => {
  it('gives the published test vectors (FIPS 180-4)', () => {
    expect(hex(sha256(utf8Encode('')))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(hex(sha256(utf8Encode('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(hex(sha256(utf8Encode('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')))).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('in slices gives the same hash, and gives the thread back every 256 KiB', async () => {
    const data = Uint8Array.from({ length: 1024 * 1024 + 7 }, (_, i) => (i * 13) & 0xff);
    let pauses = 0;
    const sliced = await sha256Async(data, async () => void pauses++);
    expect(hex(sliced)).toBe(hex(sha256(data)));
    expect(pauses).toBe(4); // 1 MiB and a little: four breaks
    expect(hex(await sha256Async(utf8Encode('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('agrees with Web Crypto at every padding boundary and on a megabyte', async () => {
    const sizes = [1, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 1000, 1024 * 1024 + 3];
    for (const n of sizes) {
      const data = Uint8Array.from({ length: n }, (_, i) => (i * 31 + n) & 0xff);
      expect(hex(sha256(data)), `${n} bytes`).toBe(hex(new Uint8Array(await subtle.digest('SHA-256', data))));
    }
  });
});

describe('sha256 in steps', () => {
  const data = Uint8Array.from({ length: 300_000 }, (_, i) => (i * 7 + 3) & 0xff);

  it('gives the hash of the whole whatever the steps', () => {
    const hash = new Sha256();
    for (const [from, to] of [[0, 1], [1, 64], [64, 65], [65, 200_000], [200_000, 300_000]] as const) hash.update(data.subarray(from, to));

    expect(hash.hex()).toBe(hex(sha256(data)));
  });

  it('takes up again from a written-down state, as a server does between two parts', () => {
    const first = new Sha256().update(data.subarray(0, 131_072 + 5));
    const state = JSON.parse(JSON.stringify(first.state())) as Sha256State;

    const resumed = Sha256.from(state).update(data.subarray(131_072 + 5));

    expect(resumed.hex()).toBe(hex(sha256(data)));
  });
});
