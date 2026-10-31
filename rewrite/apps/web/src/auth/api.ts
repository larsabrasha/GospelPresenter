import { deviceToken, storedSession } from './session.ts';

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

/** Calls the server this page came from, with the session token (or `token`) and the paired-device token. */
export async function api<T = unknown>(method: string, path: string, body?: unknown, opts: { token?: string } = {}): Promise<ApiResult<T>> {
  const res = await fetch(path, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...authHeaders(opts.token ?? storedSession()?.token),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const parsed = (await res.json().catch(() => null)) as T;
  const error = res.ok ? null : ((parsed as { error?: string } | null)?.error ?? `http-${res.status}`);
  return { status: res.status, body: parsed, error };
}
