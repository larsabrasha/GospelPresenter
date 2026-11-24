// The Mac and iOS app's sync (apps/mac/Sources/Shell/Sync.swift, doing what the core's sync driver says) against this
// server: apps/mac's `parity sync` (SyncCheck.swift) on two devices and one with refused credentials. Only with
// GP_NATIVE_SYNC=1 and the Swift binary built (crates/gp-core/build.sh builds it, and its `test` runs this).
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serverDump, setRole, startAdapter, type Harness } from './harness.ts';

const binary = fileURLToPath(new URL('../../mac/.build/release/parity', import.meta.url));
const run = process.env.GP_NATIVE_SYNC === '1' && existsSync(binary);

describe.runIf(run)('the native shell syncs as the core says', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startAdapter('node');
  }, 60_000);
  afterAll(async () => {
    await h?.close();
  });

  it('two devices see each other through pokes, and refused credentials stop syncing', async () => {
    const org = `org-${crypto.randomUUID()}`;
    const session = async (userId: string, role: 'admin' | 'user') => ({
      server: h.url,
      token: await setRole(h, userId, org, role),
      device: null,
      me: { userId, name: userId, role, orgId: org, orgName: 'Församlingen' },
    });
    const dir = mkdtempSync(join(tmpdir(), 'gp-native-sync-'));
    const sessions = { alice: await session('alice', 'admin'), bob: await session('bob', 'user'), stranger: { ...(await session('dave', 'user')), token: 'not-a-session' } };
    writeFileSync(join(dir, 'sessions.json'), JSON.stringify(sessions));

    const out = await promisify(execFile)(binary, ['sync', join(dir, 'sessions.json'), dir]).then(
      (r) => r.stdout,
      (e: { stdout?: string }) => e.stdout ?? String(e),
    );
    console.log(out.trim());
    const server = await serverDump(h, org, 'alice');
    rmSync(dir, { recursive: true, force: true });

    expect(out).not.toContain('FAIL');
    expect(server.tables.presentations.map((p) => [p.id, p.name])).toEqual([['N1', 'Omdöpt']]);
  }, 60_000);
});
