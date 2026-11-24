import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../src/auth/api.ts';

vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });

/** The server's answer as fetch gives it: its status and its body's text, or a body that fails to arrive. */
function answer(status: number, body: string | Error) {
  vi.stubGlobal('fetch', async () => ({ ok: status >= 200 && status < 300, status, text: async () => (body instanceof Error ? Promise.reject(body) : body) }));
}

describe('api', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('gives a 2xx with its JSON body as an answer', async () => {
    answer(200, '{"userId":"anna"}');

    expect(await api('GET', '/api/auth/me')).toEqual({ status: 200, body: { userId: 'anna' }, error: null });
  });

  it('gives a 204 without a body as an answer', async () => {
    answer(204, '');

    expect((await api('PUT', '/api/x')).error).toBeNull();
  });

  it('gives a 2xx whose body was cut short as no answer', async () => {
    answer(200, new TypeError('network error'));

    expect((await api('GET', '/api/auth/me')).error).toBe('unreadable');
  });

  it('gives a 2xx whose body is not JSON as no answer', async () => {
    answer(200, '{"userId":"an');

    expect((await api('GET', '/api/auth/me')).error).toBe('unreadable');
  });

  it("gives a refusal's own error", async () => {
    answer(403, '{"error":"forbidden"}');

    expect((await api('GET', '/api/x')).error).toBe('forbidden');
  });
});
