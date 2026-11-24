import { describe, expect, it } from 'vitest';
import { serverCandidates } from '../src/pages/ServerChoice.tsx';
import { serverUrl, socketUrl } from '../src/server.ts';

// The server the app talks to (server.ts): its own in a browser, a chosen one in the phone app.

describe('serverUrl', () => {
  it("leaves a path on the page's own server in the browser's build", () => {
    expect(serverUrl('/api/auth/me')).toBe('/api/auth/me');
  });

  it('leaves a whole URL as it is', () => {
    expect(serverUrl('https://cdn.example/x')).toBe('https://cdn.example/x');
  });
});

describe('socketUrl', () => {
  it('makes an https server a wss address', () => {
    expect(socketUrl('/api/sync/poke', 'https://gp.example')).toBe('wss://gp.example/api/sync/poke');
  });

  it('makes a LAN host over http a ws address', () => {
    expect(socketUrl('/api/live/socket', 'http://192.168.1.10:47800')).toBe('ws://192.168.1.10:47800/api/live/socket');
  });
});

describe('serverCandidates', () => {
  it('tries https and then http for an address typed without a scheme', () => {
    expect(serverCandidates(' kyrkan.se/ ')).toEqual(['https://kyrkan.se', 'http://kyrkan.se']);
  });

  it('takes an address with a scheme as it is', () => {
    expect(serverCandidates('http://192.168.1.10:47800')).toEqual(['http://192.168.1.10:47800']);
  });

  it('has nothing to try for an empty field', () => {
    expect(serverCandidates('   ')).toEqual([]);
  });
});
