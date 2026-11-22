// A video's upload in parts as the video tests and the native ones make it (`/api/media/:hash/upload`): start, the
// parts left, finish.
import { expect } from 'vitest';
import { sha256HexBytes } from '@gp/core';
import { api, tokenOf, type Harness } from './harness.ts';

type Started = { done: boolean; partBytes: number; received: number };
export type Finished = { done?: boolean; type?: string; codec?: string; error?: string; problem?: string; entry?: string };

export const auth = (h: Harness, org: string, user: string) => ({ authorization: `Bearer ${tokenOf(h, org, user)}` });

export function start(h: Harness, org: string, user: string, hash: string, size: number) {
  return api<Started & { error?: string }>(h, 'POST', `/api/media/${hash}/upload`, { user, org, body: { size } });
}

export async function putPart(h: Harness, org: string, user: string, hash: string, part: number, bytes: Uint8Array) {
  const res = await fetch(`${h.url}/api/media/${hash}/upload/${part}`, { method: 'PUT', headers: auth(h, org, user), body: bytes as BodyInit });
  return { status: res.status, body: (await res.json()) as { received?: number; error?: string } };
}

export const finish = (h: Harness, org: string, user: string, hash: string) => api<Finished>(h, 'POST', `/api/media/${hash}/upload/finish`, { user, org });

/** The whole upload, from where the server is: start, the parts left, finish. */
export async function upload(h: Harness, org: string, user: string, bytes: Uint8Array): Promise<{ hash: string; status: number; body: Finished }> {
  const hash = await sha256HexBytes(bytes);
  const s = await start(h, org, user, hash, bytes.length);
  expect(s.status).toBe(200);
  for (let at = s.body.received; at < bytes.length; at += s.body.partBytes) {
    expect((await putPart(h, org, user, hash, at / s.body.partBytes + 1, bytes.subarray(at, at + s.body.partBytes))).status).toBe(200);
  }
  return { hash, ...(await finish(h, org, user, hash)) };
}
