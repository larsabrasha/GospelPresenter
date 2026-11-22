// The iOS app driving a session presented elsewhere, in the simulator against this server: `parity present` presents
// as another computer with remote control allowed, and the UI test RemoteTests.swift takes control and taps a part;
// the presenting computer must have taken the command. Only with GP_NATIVE_UI=1, the Swift binary and the iOS app built
// (apps/mac/apple.sh ios), and a simulator's id in GP_SIMULATOR (`xcrun simctl list devices`).
import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, setRole, startAdapter, type Harness } from './harness.ts';

const binary = fileURLToPath(new URL('../../mac/.build/release/parity', import.meta.url));
const mac = fileURLToPath(new URL('../../mac', import.meta.url));
const simulator = process.env.GP_SIMULATOR;
const run = process.env.GP_NATIVE_UI === '1' && !!simulator && existsSync(binary);

describe.runIf(run)('the iOS app driving a session elsewhere', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startAdapter('node');
  }, 60_000);
  afterAll(async () => {
    await h?.close();
  });

  it('takes control and its tap is taken by the presenting computer, and switches an output on while presenting', async () => {
    const org = `org-${crypto.randomUUID()}`;
    const session = async (userId: string, role: 'admin' | 'user') => ({
      server: h.url,
      token: await setRole(h, userId, org, role),
      device: null,
      me: { userId, name: userId, role, orgId: org, orgName: 'Församlingen' },
    });
    const dir = mkdtempSync(join(tmpdir(), 'gp-native-remote-'));
    const bob = await session('bob', 'user');
    writeFileSync(join(dir, 'sessions.json'), JSON.stringify({ alice: await session('alice', 'admin') }));
    const presenter = spawn(binary, ['present', join(dir, 'sessions.json'), dir, '240'], { stdio: 'inherit' });

    // A TV showing its code, which the app pairs under Anslut tillfällig utgång.
    const shown = await api<{ pin: string }>(h, 'POST', '/api/screen', { body: {} });
    const out = await promisify(execFile)(
      'xcodebuild',
      ['-project', 'ios/GPiOS.xcodeproj', '-scheme', 'GPiOS', '-configuration', 'Debug', '-derivedDataPath', 'build/derived',
        '-destination', `platform=iOS Simulator,id=${simulator}`, 'test', '-only-testing:GPiOSUITests/RemoteTests'],
      { cwd: mac, env: { ...process.env, TEST_RUNNER_GP_REPO: fileURLToPath(new URL('../../..', import.meta.url)), TEST_RUNNER_GP_SESSION: Buffer.from(JSON.stringify(bob)).toString('base64'), TEST_RUNNER_GP_PIN: shown.body.pin }, maxBuffer: 64 << 20 },
    ).then((r) => r.stdout, (e: { stdout?: string }) => e.stdout ?? String(e));
    presenter.kill();
    const applied = existsSync(join(dir, 'applied.txt')) ? readFileSync(join(dir, 'applied.txt'), 'utf8') : '';
    console.log(out.split('\n').filter((l) => /Test Case|error:|SUCCEEDED|FAILED/.test(l)).join('\n'));
    console.log(`applied: ${applied}`);
    rmSync(dir, { recursive: true, force: true });

    expect(out, out.split('\n').filter((l) => /error:/.test(l)).join('\n')).toContain('** TEST SUCCEEDED **');
    expect(applied).toContain('i1/1');
  }, 600_000);
});
