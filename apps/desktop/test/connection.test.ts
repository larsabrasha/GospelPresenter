import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { savedServer, saveServer, serverUrl } from '../src/connection.ts';

describe('a server address as typed', () => {
  it('without a scheme is https, its origin only', () => {
    expect(serverUrl(' app.gospelpresenter.com/songs ')).toBe('https://app.gospelpresenter.com');
  });

  it('may be plain http on this machine or the local network, where a desktop host is', () => {
    expect(['http://127.0.0.1:47800', 'http://192.168.1.20:47800', 'http://kyrkan.local:47800'].map(serverUrl)).toEqual([
      'http://127.0.0.1:47800',
      'http://192.168.1.20:47800',
      'http://kyrkan.local:47800',
    ]);
  });

  it('is refused as plain http on the internet, with a user or password, or as no address at all', () => {
    expect(['http://example.com', 'https://anna:secret@example.com', 'ftp://example.com', '', 'not a url'].map(serverUrl)).toEqual([null, null, null, null, null]);
  });
});

describe('the server kept for the next start', () => {
  it('is the one saved', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gp-connection-'));

    saveServer(dir, 'https://app.gospelpresenter.com');

    expect(savedServer(dir)).toBe('https://app.gospelpresenter.com');
  });

  it('is none once it is forgotten: this computer is the host again', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gp-connection-'));
    saveServer(dir, 'https://app.gospelpresenter.com');

    saveServer(dir, null);

    expect(savedServer(dir)).toBeNull();
  });

  it('is none when the file holds no server address', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gp-connection-'));
    writeFileSync(join(dir, 'connection.json'), JSON.stringify({ server: 'http://example.com' }));

    expect(savedServer(dir)).toBeNull();
  });
});
