// A picture fetched from the web for MCP (docs/mcp.md, "Pictures"): an assistant names an address, the server fetches
// it. Only https, never this machine or the church's own network, so a key cannot make the server read what only it
// can reach (a router's page, a desktop host's neighbours); at most 10 MB, read as it comes; a redirect followed only
// to an address that passes the same checks, three at most.
import { MEDIA_LIMITS, MutationError } from '@gp/core';

export type FetchPicture = (url: string) => Promise<Uint8Array>;

const MAX_REDIRECTS = 3;

/** The longest a picture's fetch may take, the body read too: a server that answers slowly holds nothing up longer. */
const FETCH_MS = 20_000;

/** Whether an IPv4 address is this machine's, a private network's, a link's or not on the internet at all. */
function privateV4(ip: string) {
  const [a = 0, b = 0] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

/** Whether an address, IPv4 or IPv6, is one the server must not fetch from. */
export function privateAddress(ip: string): boolean {
  const v6 = ip.toLowerCase().replace(/^\[|\]$/g, '');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v6)) return privateV4(v6);
  const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return privateV4(mapped[1]!);
  return v6 === '::' || v6 === '::1' || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6) || v6.startsWith('ff');
}

/** Whether a host name is one that names this machine or a local network rather than a place on the web. */
function localName(host: string) {
  const h = host.toLowerCase().replace(/\.$/, '');
  return h === 'localhost' || /\.(localhost|local|internal|lan|home|arpa)$/.test(h) || !h.includes('.');
}

interface FetchOptions {
  fetch?: typeof fetch;
  /** The host name's addresses, where the runtime can look them up (Node); a Worker reaches no private network anyway. */
  resolve?: (host: string) => Promise<string[]>;
  /** Tests only: the picture is served from this machine, over http. */
  allowLoopback?: boolean;
  /** FETCH_MS unless a test shortens it. */
  timeoutMs?: number;
}

async function checkAddress(url: URL, o: FetchOptions) {
  const loopback = o.allowLoopback && (url.hostname === '127.0.0.1' || url.hostname === 'localhost');
  if (loopback) return;
  if (url.protocol !== 'https:') throw new MutationError('invalid-url', 'only an https address');
  const host = url.hostname;
  if (localName(host) || privateAddress(host)) throw new MutationError('invalid-url', 'not an address on the internet');
  const addresses = o.resolve ? await o.resolve(host).catch(() => []) : null;
  if (addresses && (!addresses.length || addresses.some(privateAddress))) throw new MutationError('invalid-url', 'not an address on the internet');
}

/** Reads a body up to `max` bytes, stopping as soon as it is past them. */
async function readCapped(res: Response, max: number): Promise<Uint8Array> {
  if (Number(res.headers.get('content-length') ?? 0) > max) throw new MutationError('too-large', `larger than ${max / 1024 / 1024} MB`);
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      throw new MutationError('too-large', `larger than ${max / 1024 / 1024} MB`);
    }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** The picture-fetching of a runtime: its fetch, and on Node its look-up of a host name's addresses. */
export function webFetchPicture(o: FetchOptions = {}): FetchPicture {
  const get = o.fetch ?? fetch;
  return async (address) => {
    let url = new URL(address);
    // One limit for every hop and the body, which the signal stops as it is read.
    const signal = AbortSignal.timeout(o.timeoutMs ?? FETCH_MS);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await checkAddress(url, o);
      try {
        // Named, as sites such as Wikimedia ask of a program that fetches from them; the app's name only.
        const res = await get(url, {
          redirect: 'manual',
          signal,
          headers: { accept: 'image/png, image/jpeg, image/webp, image/svg+xml', 'user-agent': 'GospelPresenter/2.0 (+https://gospelpresenter.com)' },
        });
        const next = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
        if (next) {
          await res.body?.cancel();
          url = new URL(next, url);
          continue;
        }
        if (!res.ok) throw new MutationError('fetch-failed', `${url.href} answered ${res.status}`);
        return await readCapped(res, MEDIA_LIMITS.sourceBytes);
      } catch (e) {
        if (e instanceof MutationError) throw e;
        throw new MutationError('fetch-failed', signal.aborted ? `${url.href} took longer than ${(o.timeoutMs ?? FETCH_MS) / 1000} s` : `could not fetch ${url.href}`);
      }
    }
    throw new MutationError('fetch-failed', 'too many redirects');
  };
}
