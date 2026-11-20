import { deviceToken, storedSession } from './session.ts';
import { serverUrl } from '../server.ts';

/** An answer from the server's auth API. A network failure throws instead. */
export interface ApiResult<T> {
  status: number;
  body: T;
  /** The `error` code of a refusal. */
  error: string | null;
}

/** The session token (or `token`) and the paired-device token, as headers. */
export function authHeaders(token = storedSession()?.token): Record<string, string> {
  const device = deviceToken();
  return { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(device ? { 'x-gp-device': device } : {}) };
}

/** Calls the server (server.ts: the one the page came from, or the phone app's), with the session token (or `token`) and the paired-device token. */
export async function api<T = unknown>(method: string, path: string, body?: unknown, opts: { token?: string } = {}): Promise<ApiResult<T>> {
  const res = await fetch(serverUrl(path), {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...authHeaders(opts.token ?? storedSession()?.token),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  // A body that did not arrive whole (a reload or the network cutting it short) is no answer, even under a 2xx: as a
  // success with no body it once stored an empty identity and signed the device out at its next start. An empty body
  // (204) is an answer.
  const text = await res.text().catch(() => null);
  let parsed = null as T;
  let unreadable = text === null;
  if (text) {
    try {
      parsed = JSON.parse(text) as T;
    } catch {
      unreadable = true;
    }
  }
  const error = res.ok ? (unreadable ? 'unreadable' : null) : ((parsed as { error?: string } | null)?.error ?? `http-${res.status}`);
  return { status: res.status, body: parsed, error };
}
