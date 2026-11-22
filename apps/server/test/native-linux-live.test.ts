// The Linux app's live session against this server, in Docker (apps/linux/docker.sh shoot): it presents with a public
// output switched on and remote control allowed (Utgångar, the core's `liveStepView`), a TV paired by its code
// (`pairScreenStepView`), a member sees it with them, and a member's command moves what it shows; and it drives a session the Mac's `parity present` presents. Only with GP_NATIVE_LINUX=1 and the app built (apps/linux/docker.sh build);
// its pictures are kept in GP_NATIVE_LINUX_SHOTS, else a temporary folder.
import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, device, setRole, startAdapter, type Harness } from './harness.ts';
import { Window } from './live-window.ts';

const docker = fileURLToPath(new URL('../../linux/docker.sh', import.meta.url));
const run = process.env.GP_NATIVE_LINUX === '1';
// The presentation opened from the start page and started; the public output and Tillåt fjärrstyrning switched on in
// the live column; then a while for the member's command. Places in a 1440 × 900 window.
// Then Anslut tillfällig utgång, the TV's code typed (`pin`), and a while for the member's command.
const STEPS = (pin: string) => process.env.GP_NATIVE_LINUX_STEPS
  ?? `wait 25; click 720 141; wait 4; click 1224 27; wait 4; shot presenting; click 500 190; wait 2; click 1385 425; wait 2; click 1385 525; wait 3; shot outputs; click 1250 475; wait 4; click 720 584; type ${pin}; wait 5; shot paired; key Escape; wait 15; shot commanded`;

// Visas just nu's Ta kontroll, the slide tapped on the page driven, and a while for the command to reach the presenter.
const DRIVE = process.env.GP_NATIVE_LINUX_DRIVE ?? 'wait 25; shot drivable; click 940 141; wait 6; shot driving; click 876 190; wait 6; shot driven';
// The Mac app's parity binary (apps/mac: swift build -c release), which presents as another computer.
const parity = fileURLToPath(new URL('../../mac/.build/release/parity', import.meta.url));

describe.runIf(run)('the Linux app presenting to a host', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startAdapter('node');
  }, 60_000);
  afterAll(async () => {
    await h?.close();
  });

  it('reports its session with its output, and takes a member command', async () => {
    const org = `org-${crypto.randomUUID()}`;
    await setRole(h, 'alice', org, 'admin');
    const alice = await device(h, org, 'alice', 'admin');
    await alice.client.mutate('createSong', { id: 's1', name: 'Härlig är jorden' });
    await alice.client.mutate('addSongPart', { id: 's1-v', songId: 's1', labelText: null, content: 'Härlig är jorden' });
    await alice.client.mutate('addSongPart', { id: 's1-r', songId: 's1', labelText: null, content: 'Pilgrimsfärd' });
    await alice.client.mutate('createPresentation', { id: 'p1', name: 'Söndag' });
    await alice.client.mutate('addSongToPresentation', { itemId: 'i1', presentationId: 'p1', songId: 's1', arrangementId: null });
    await alice.client.mutate('createDisplay', { id: 'd1', name: 'Följ med', code: 'abcdefg', kind: 'public' });
    await alice.client.sync();
    const config = mkdtempSync(join(tmpdir(), 'gp-native-linux-live-'));
    const shots = process.env.GP_NATIVE_LINUX_SHOTS ?? join(config, 'shots');
    mkdirSync(shots, { recursive: true });
    const token = await setRole(h, 'bob', org, 'admin');
    const server = h.url.replace('127.0.0.1', 'host.docker.internal').replace('localhost', 'host.docker.internal');
    writeFileSync(join(config, 'session.json'), JSON.stringify({
      server, token, device: null, me: { userId: 'bob', name: 'Bob', role: 'admin', orgId: org, orgName: 'Församlingen' },
    }));
    const member = await Window.open(h, org, 'alice');

    // A TV showing its code, which the Linux app types under Anslut tillfällig utgång.
    const shown = await api<{ id: string; pin: string }>(h, 'POST', '/api/screen', { body: {} });
    const shooting = promisify(execFile)(docker, ['shoot', shots, STEPS(shown.body.pin)], { env: { ...process.env, GP_CONFIG: config }, maxBuffer: 16 << 20 });
    const listed = await waitFor(member, (s) => s.presentationId === 'p1' && s.remote === true && s.outputs.some((o) => o.id === 'd1'));
    const paired = await waitFor(member, (s) => s.id === listed.id && s.outputs.some((o) => o.id === shown.body.id));
    member.send({ type: 'set', sessionId: listed.id, change: { itemId: 'i1', partIndex: 1, black: false } });
    const moved = await waitFor(member, (s) => s.id === listed.id && s.pointer.partIndex === 1);
    await shooting;
    member.close();
    rmSync(config, { recursive: true, force: true });

    expect(listed.deviceName).not.toBe('');
    expect(moved.pointer.itemId).toBe('i1');
    expect(paired.outputs.map((o) => o.id)).toContain(shown.body.id);
  }, 300_000);
});

describe.runIf(run && existsSync(parity))('the Linux app driving a session presented elsewhere', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startAdapter('node');
  }, 60_000);
  afterAll(async () => {
    await h?.close();
  });

  it('takes control from the start page, and its tap is taken by the presenting computer', async () => {
    const org = `org-${crypto.randomUUID()}`;
    const session = async (userId: string, role: 'admin' | 'user', server: string) => ({
      server, token: await setRole(h, userId, org, role), device: null, me: { userId, name: userId, role, orgId: org, orgName: 'Församlingen' },
    });
    const dir = mkdtempSync(join(tmpdir(), 'gp-native-linux-drive-'));
    const shots = process.env.GP_NATIVE_LINUX_SHOTS ?? join(dir, 'shots');
    mkdirSync(shots, { recursive: true });
    mkdirSync(join(dir, 'config'));
    writeFileSync(join(dir, 'sessions.json'), JSON.stringify({ alice: await session('alice', 'admin', h.url) }));
    writeFileSync(join(dir, 'config', 'session.json'), JSON.stringify(await session('bob', 'user', h.url.replace('127.0.0.1', 'host.docker.internal').replace('localhost', 'host.docker.internal'))));
    // The Mac's `parity present`: Alice presents Söndag's first slide with remote control allowed, and writes each
    // command she takes to applied.txt.
    const presenter = spawn(parity, ['present', join(dir, 'sessions.json'), dir, '120'], { stdio: 'inherit' });

    await promisify(execFile)(docker, ['shoot', shots, DRIVE], { env: { ...process.env, GP_CONFIG: join(dir, 'config') }, maxBuffer: 16 << 20 });
    presenter.kill();
    const applied = existsSync(join(dir, 'applied.txt')) ? readFileSync(join(dir, 'applied.txt'), 'utf8') : '';
    rmSync(dir, { recursive: true, force: true });

    expect(applied).toContain('i1/1');
  }, 300_000);
});

/** The first session the member is told of that `match` accepts, within a minute (the app starts slowly in Docker). */
async function waitFor(w: Window, match: (s: Awaited<ReturnType<Window['sessions']>>[number]) => boolean) {
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      const list = await w.sessions((s) => s.some(match));
      return list.find(match)!;
    } catch (e) {
      if (Date.now() > deadline) throw e;
    }
  }
}
