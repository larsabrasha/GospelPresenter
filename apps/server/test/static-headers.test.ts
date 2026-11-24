// The static app's headers on Cloudflare (web/public/_headers, set without the Worker) are the Node server's
// (src/static.ts): the same CSP and the rest on every file, `no-cache` outside /assets/, and hashed files kept.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { staticHeaders } from '../src/static.ts';

/** The rules of a _headers file: each path pattern with its headers, `!` lines (removals) left out. */
function rules(text: string): Map<string, Record<string, string>> {
  const out = new Map<string, Record<string, string>>();
  let current: Record<string, string> | null = null;
  for (const line of text.split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    if (!line.startsWith(' ')) out.set(line.trim(), (current = {}));
    else if (current && !line.trim().startsWith('!')) {
      const at = line.indexOf(':');
      current[line.slice(0, at).trim().toLowerCase()] = line.slice(at + 1).trim();
    }
  }
  return out;
}

const file = rules(readFileSync(new URL('../../web/public/_headers', import.meta.url), 'utf8'));

describe('the _headers file', () => {
  it('gives every file the Node server headers of a page, no-cache included', () => {
    expect(file.get('/*')).toEqual(staticHeaders('/'));
  });

  it('keeps hashed assets for good instead of asking again', () => {
    const { 'cache-control': cache, ...rest } = { ...file.get('/*'), ...file.get('/assets/*') };
    expect(rest).toEqual(staticHeaders('/assets/index-abc.js'));
    expect(cache).toContain('immutable');
  });
});
