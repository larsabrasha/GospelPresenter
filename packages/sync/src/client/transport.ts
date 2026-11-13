export interface TransportResponse<T> {
  status: number;
  body: T;
}

export interface Transport {
  post<T>(path: string, body: unknown): Promise<TransportResponse<T>>;
}

/** What a request carries: the session's bearer token, and on a desktop host's LAN the paired-device token. */
export interface Credentials {
  token: string;
  device?: string | null;
}

export function authHeaders(c: Credentials): Record<string, string> {
  return { authorization: `Bearer ${c.token}`, ...(c.device ? { 'x-gp-device': c.device } : {}) };
}

/**
 * The same credentials for a WebSocket, which takes no headers from a
 * browser: as subprotocols, so they stay out of URLs and logs. The server
 * answers with `gp.v1`.
 */
export function socketProtocols(c: Credentials): string[] {
  return ['gp.v1', `gp.auth.${c.token}`, ...(c.device ? [`gp.device.${c.device}`] : [])];
}

/** HTTP to the sync server. A network failure throws; any HTTP answer resolves. */
export function httpTransport(opts: { baseUrl: string } & Credentials): Transport {
  return {
    async post<T>(path: string, body: unknown) {
      const res = await fetch(opts.baseUrl + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeaders(opts) },
        body: JSON.stringify(body),
      });
      return { status: res.status, body: (await res.json()) as T };
    },
  };
}
