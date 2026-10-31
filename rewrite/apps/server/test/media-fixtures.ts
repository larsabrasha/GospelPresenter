// Pictures and the media routes as the media tests use them: blobs with their own hashes, and requests as a user.
import { expect } from 'vitest';
import { DEFAULT_MEDIA_POLICY, storeMediaBlob, type MediaPolicy } from '@gp/sync/client';
import { tokenOf, type Device, type Harness } from './harness.ts';

/** Today as `syncMedia` sees it by default. */
export const TODAY = new Date().toISOString().slice(0, 10);

/** Bytes that start like a JPEG; the rest is made from the seed, so each picture has its own hash. Not a decodable picture. */
export function jpeg(seed: string, size = 300): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0xff, 0xd8, 0xff, 0xe0]);
  for (let i = 4; i < size; i++) bytes[i] = (seed.charCodeAt(i % seed.length) * 31 + i * 7) & 0xff;
  return bytes;
}

export function webp(seed: string): Uint8Array {
  const bytes = jpeg(seed, 200);
  bytes.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  return bytes;
}

export function put(h: Harness, org: string, user: string | null, hash: string, body: Uint8Array | string) {
  return fetch(`${h.url}/api/media/${hash}`, {
    method: 'PUT',
    headers: { ...(user ? { authorization: `Bearer ${tokenOf(h, org, user)}` } : {}), 'content-type': 'application/octet-stream' },
    body: body as BodyInit,
  });
}

/**
 * A too-large upload is refused from its content-length, before the body is
 * read: the client gets the 413, or, when the server closes the connection
 * while the body is still being sent (workerd does), a broken pipe. Either is
 * a refusal; a stored file would be a 204.
 */
export async function refusedAsTooLarge(response: Promise<Response>): Promise<boolean> {
  try {
    return (await response).status === 413;
  } catch (e) {
    const code = (e as { cause?: { code?: string } }).cause?.code;
    return code === 'EPIPE' || code === 'ECONNRESET';
  }
}

export function get(h: Harness, org: string, user: string | null, hash: string) {
  return fetch(`${h.url}/api/media/${hash}`, { headers: user ? { authorization: `Bearer ${tokenOf(h, org, user)}` } : {} });
}

export function downloader(h: Harness, org: string, user: string) {
  return async (hash: string) => {
    const res = await get(h, org, user, hash);
    return res.status === 200 ? new Uint8Array(await res.arrayBuffer()) : null;
  };
}

/** What a device fetches while it presents P. */
export const presentingP: MediaPolicy = { ...DEFAULT_MEDIA_POLICY, presenting: 'P', today: TODAY };

export const imageArgs = (id: string, fullHash: string, thumbHash: string, fileName = 'logo.jpg') => ({
  id,
  fileName,
  contentType: 'image/jpeg' as const,
  fullHash,
  thumbHash,
  width: 1440,
  height: 1080,
  createdAt: 1_700_000_000_000,
});

/** Stores a picture's two blobs on the device and uploads them, as an import does before `addImage`. */
export async function uploaded(h: Harness, org: string, d: Device, seed: string) {
  const full = jpeg(`${seed}-full`);
  const thumb = jpeg(`${seed}-thumb`, 120);
  const fullHash = await storeMediaBlob(d.client, full, 'image/jpeg');
  const thumbHash = await storeMediaBlob(d.client, thumb, 'image/jpeg');
  expect((await put(h, org, d.user, fullHash, full)).status).toBe(204);
  expect((await put(h, org, d.user, thumbHash, thumb)).status).toBe(204);
  return { full, thumb, fullHash, thumbHash };
}
