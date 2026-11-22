// The Linux app signed in to this server, in Docker (apps/linux/docker.sh shoot): what a web device made shows on its
// start page (pulled), and a presentation it makes reaches the server (pushed). Only with GP_NATIVE_LINUX=1 and the app
// built (apps/linux/docker.sh build); its pictures are kept in GP_NATIVE_LINUX_SHOTS, else a temporary folder.
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { device, serverDump, setRole, startAdapter, type Harness } from './harness.ts';

const docker = fileURLToPath(new URL('../../linux/docker.sh', import.meta.url));
const run = process.env.GP_NATIVE_LINUX === '1';
// The start page once pulled; then + (no templates: the blank form at once), the name typed (ASCII: xdotool drops å in Xvfb), Skapa, and a moment for
// the push. Places in a 1440 × 900 window.
const STEPS = 'wait 20; shot pulled; click 28 27; wait 3; click 700 344; key ctrl+a; type Gjord i Linux; wait 1; shot named; click 863 262; wait 8; shot pushed; click 28 27; wait 10; shot poked';

describe.runIf(run)('the Linux app signed in to a host', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startAdapter('node');
  }, 60_000);
  afterAll(async () => {
    await h?.close();
  });

  it('shows what the web made, and its own presentation reaches the server', async () => {
    const org = `org-${crypto.randomUUID()}`;
    await setRole(h, 'alice', org, 'admin');
    const alice = await device(h, org, 'alice', 'admin');
    await alice.client.mutate('createPresentation', { id: 'P', name: 'Från webben' });
    await alice.client.sync();
    const config = mkdtempSync(join(tmpdir(), 'gp-native-linux-'));
    const shots = process.env.GP_NATIVE_LINUX_SHOTS ?? join(config, 'shots');
    mkdirSync(shots, { recursive: true });
    const token = await setRole(h, 'bob', org, 'admin');
    // The container reaches this machine's server by the name Docker gives it.
    const server = h.url.replace('127.0.0.1', 'host.docker.internal').replace('localhost', 'host.docker.internal');
    writeFileSync(join(config, 'session.json'), JSON.stringify({
      server, token, device: null, me: { userId: 'bob', name: 'Bob', role: 'admin', orgId: org, orgName: 'Församlingen' },
    }));

    const shooting = promisify(execFile)(docker, ['shoot', shots, process.env.GP_NATIVE_LINUX_STEPS ?? STEPS], {
      env: { ...process.env, GP_CONFIG: config },
      maxBuffer: 16 << 20,
    });
    // While the app is open, past its start: the web makes another, which the poke brings (the picture `poked`).
    await new Promise((r) => setTimeout(r, 30_000)); // past the app's start in the container, before `poked`
    await alice.client.mutate('createPresentation', { id: 'Q', name: 'Medan Linux var uppe' });
    await alice.client.sync();
    await shooting;
    const dump = await serverDump(h, org, 'alice');
    rmSync(config, { recursive: true, force: true });

    const names = (dump.tables.presentations ?? []).map((p) => p.name);
    expect(names).toContain('Från webben');
    expect(names).toContain('Gjord i Linux');
  }, 300_000);
});
