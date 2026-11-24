// Sends the trial's debug token with every request to a debug route of the trial Worker (gate.ts).
import { trialToken } from './tokens.ts';

const base = process.env.SYNC_REMOTE_URL ?? '';
const token = trialToken('TRIAL_DEBUG_TOKEN');
const real = globalThis.fetch;
globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (base && url.startsWith(base) && url.includes('/api/debug/')) {
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.set('x-trial-token', token);
    return real(input, { ...init, headers });
  }
  return real(input, init);
};
