// The Mac and iOS app as the owner of a live session against this server: apps/mac's `parity live` (LiveCheck.swift):
// its report reaches the organisation's members and a public output, a controller's command reaches it, and Avsluta
// ends the session. Only with GP_NATIVE_SYNC=1 and the Swift binary built (crates/gp-core/build.sh builds it).
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setRole, startAdapter, type Harness } from './harness.ts';

const binary = fileURLToPath(new URL('../../mac/.build/release/parity', import.meta.url));
const run = process.env.GP_NATIVE_SYNC === '1' && existsSync(binary);

describe.runIf(run)('the native live session against the server', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startAdapter('node');
  }, 60_000);
  afterAll(async () => {
    await h?.close();
  });

  it('reports to members and a public output, takes a command, and ends', async () => {
    const org = `org-${crypto.randomUUID()}`;
    const session = async (userId: string, role: 'admin' | 'user') => ({
      server: h.url,
      token: await setRole(h, userId, org, role),
      device: null,
      me: { userId, name: userId, role, orgId: org, orgName: 'Församlingen' },
    });
    const dir = mkdtempSync(join(tmpdir(), 'gp-native-live-'));
    writeFileSync(join(dir, 'sessions.json'), JSON.stringify({ alice: await session('alice', 'admin'), bob: await session('bob', 'user') }));

    const out = await promisify(execFile)(binary, ['live', join(dir, 'sessions.json'), dir], { maxBuffer: 1 << 20 }).then(
      (r) => r.stdout,
      (e: { stdout?: string }) => e.stdout ?? String(e),
    );
    console.log(out.trim());
    rmSync(dir, { recursive: true, force: true });

    expect(out).toContain('ok: Avsluta ends the session');
    expect(out).not.toContain('FAIL');
  }, 120_000);
});
