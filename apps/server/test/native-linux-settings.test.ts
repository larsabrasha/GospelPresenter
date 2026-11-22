// The Linux app's Inställningar against this server, in Docker (apps/linux/docker.sh shoot; settings.rs and
// settings_mine.rs over the core's `settingsListView` and `mySettingsView`): Mina inställningar's name changed and
// applied reaches the server; the theme and language kept on the device (prefs.json) are the app's at its start (the
// pictures `mine` and `renamed`, in English and dark, looked at). Only with GP_NATIVE_LINUX=1 and the app built;
// pictures in GP_NATIVE_LINUX_SHOTS, else a temporary folder.
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, setRole, startAdapter, type Harness } from './harness.ts';

const docker = fileURLToPath(new URL('../../linux/docker.sh', import.meta.url));
const run = process.env.GP_NATIVE_LINUX === '1';
// Signed in; Ctrl+, opens Inställningar at Mina inställningar; the name field, the name typed (ASCII: xdotool drops å
// in Xvfb) and applied by ↵; a moment for the request. Places in a 1440 × 900 screen, the window at its top left.
const STEPS = 'wait 25; key ctrl+comma; wait 3; shot mine; click 600 142; key ctrl+a; type Robert Bob; key Return; wait 4; shot renamed';

describe.runIf(run)("the Linux app's Inställningar", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startAdapter('node');
  }, 60_000);
  afterAll(async () => {
    await h?.close();
  });

  it('saves a name applied under Mina inställningar to the server', async () => {
    const org = `org-${crypto.randomUUID()}`;
    const token = await setRole(h, 'bob', org, 'admin');
    const config = mkdtempSync(join(tmpdir(), 'gp-native-linux-settings-'));
    const shots = process.env.GP_NATIVE_LINUX_SHOTS ?? join(config, 'shots');
    mkdirSync(shots, { recursive: true });
    const server = h.url.replace('127.0.0.1', 'host.docker.internal').replace('localhost', 'host.docker.internal');
    writeFileSync(join(config, 'session.json'), JSON.stringify({
      server, token, device: null, me: { userId: 'bob', name: 'Bob', role: 'admin', orgId: org, orgName: 'Församlingen' },
    }));
    writeFileSync(join(config, 'prefs.json'), JSON.stringify({ theme: 'dark', language: 'en' }));

    await promisify(execFile)(docker, ['shoot', shots, process.env.GP_NATIVE_LINUX_STEPS ?? STEPS], { env: { ...process.env, GP_CONFIG: config }, maxBuffer: 16 << 20 });
    const me = await api<{ name: string }>(h, 'GET', '/api/auth/me', { user: 'bob', org });
    rmSync(config, { recursive: true, force: true });

    expect(me.body.name).toBe('Robert Bob');
  }, 300_000);
});
