export interface TransportResponse<T> {
  status: number;
  body: T;
}

export interface Transport {
  post<T>(path: string, body: unknown): Promise<TransportResponse<T>>;
}

/** HTTP to the sync server. A network failure throws; any HTTP answer resolves. */
export function httpTransport(opts: { baseUrl: string; token: string; org: string }): Transport {
  return {
    async post<T>(path: string, body: unknown) {
      const res = await fetch(opts.baseUrl + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${opts.token}`, 'x-org': opts.org },
        body: JSON.stringify(body),
      });
      return { status: res.status, body: (await res.json()) as T };
    },
  };
}
