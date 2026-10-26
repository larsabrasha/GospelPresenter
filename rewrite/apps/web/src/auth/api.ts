import { deviceToken, storedSession } from './session.ts';

/** An answer from the server's auth API. A network failure throws instead. */
export interface ApiResult<T> {
  status: number;
  body: T;
  /** The `error` code of a refusal. */
  error: string | null;
}

/** Calls the server this page came from, with the session token and the paired-device token. */
export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
  const token = storedSession()?.token;
  const device = deviceToken();
  const res = await fetch(path, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(device ? { 'x-gp-device': device } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const parsed = (await res.json().catch(() => null)) as T;
  const error = res.ok ? null : ((parsed as { error?: string } | null)?.error ?? `http-${res.status}`);
  return { status: res.status, body: parsed, error };
}
