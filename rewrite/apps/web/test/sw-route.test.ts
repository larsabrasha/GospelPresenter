import { describe, expect, it } from 'vitest';
import { handling } from '../sw/route.ts';

const origin = 'https://192.168.1.59:47843';
const get = (path: string, mode = 'cors') => handling({ method: 'GET', mode, url: new URL(path, origin).toString() }, origin);

describe('what the service worker does with a request', () => {
  it('never answers the API from a cache, a page load included', () => {
    for (const path of ['/api', '/api/sync/pull', '/api/media/abc', '/api/watch/abc1234/stream?v=1', '/api/auth/google/callback?code=x'])
      for (const mode of ['cors', 'navigate', 'same-origin']) expect(get(path, mode), `${mode} ${path}`).toBe('pass');
  });

  it('leaves writes and other origins to the network', () => {
    expect(handling({ method: 'POST', mode: 'cors', url: `${origin}/assets/index-x.js` }, origin)).toBe('pass');
    expect(handling({ method: 'GET', mode: 'cors', url: 'https://example.com/assets/x.js' }, origin)).toBe('pass');
    expect(handling({ method: 'GET', mode: 'navigate', url: 'http://192.168.1.59:47843/songs' }, origin)).toBe('pass');
  });

  it('opens every page of the app, the root included, network first with index.html behind it', () => {
    for (const path of ['/', '/songs', '/presentations/P1', '/admin/overlays', '/live/P1?remote=1', '/watch/abc1234', '/output', '/index.html', '/apis'])
      expect(get(path, 'navigate'), path).toBe('page');
  });

  it('takes the build\'s files from the kept copy first', () => {
    expect(get('/assets/index-BRZFqWBC.js')).toBe('file');
    expect(get('/assets/wa-sqlite-CePoIZt_.wasm')).toBe('file');
    expect(get('/assets/index-x.js', 'navigate')).toBe('file');
  });
});
