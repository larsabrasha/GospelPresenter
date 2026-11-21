// The Mac and iOS app's Inställningar against this server: apps/mac's `parity settings` (SettingsCheck.swift): a file
// and a Bible imported go up before the changes naming them, the endpoints the pages read answer what they decode, and
// an organisation exported by the core's plan imports into another. Only with GP_NATIVE_SYNC=1 and the Swift binary
// built (crates/gp-core/build.sh builds it, and its `test` runs this).
import { execFile, execFileSync } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startNodeServer, type PptxPages, type RunningServer } from '../src/node.ts';
import { setRole, startAdapter, type Harness } from './harness.ts';

const binary = fileURLToPath(new URL('../../mac/.build/release/parity', import.meta.url));
const run = process.env.GP_NATIVE_SYNC === '1' && existsSync(binary);
/** crates/gp-pptx's program and its fixture deck, as the desktop host draws decks (apps/desktop/src/pptx.ts). */
const pptxProgram = fileURLToPath(new URL('../../../crates/gp-pptx/target/release/gp-pptx', import.meta.url));
const deck = fileURLToPath(new URL('../../../crates/gp-pptx/fixtures/deck.pptx', import.meta.url));

/** The host's renderer, as apps/desktop's pptxPages runs it: the program on a folder of its own, its pages read back. */
const drawDeck: PptxPages = async (pptx, max) => {
  const dir = mkdtempSync(join(tmpdir(), 'gp-pptx-'));
  try {
    writeFileSync(join(dir, 'deck.pptx'), pptx);
    const { stdout } = await promisify(execFile)(pptxProgram, [join(dir, 'deck.pptx'), dir, String(max)], { maxBuffer: 1 << 20 });
    const drawn = JSON.parse(stdout) as { charts: boolean; pages: { full: string; thumb: string }[] };
    return { charts: drawn.charts, pages: drawn.pages.map((p) => ({ full: new Uint8Array(readFileSync(join(dir, p.full))), thumb: new Uint8Array(readFileSync(join(dir, p.thumb))) })) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe.runIf(run)('the native settings against the server', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startAdapter('node', existsSync(pptxProgram) ? { pptx: drawDeck } : {});
  }, 60_000);
  afterAll(async () => {
    await h?.close();
  });

  it('uploads before a push, reads the endpoints, and moves an organisation', async () => {
    const org = `org-${crypto.randomUUID()}`;
    const other = `org-${crypto.randomUUID()}`;
    const session = async (userId: string, orgId: string, role: 'admin' | 'user') => ({
      server: h.url,
      token: await setRole(h, userId, orgId, role),
      device: null,
      me: { userId, name: userId, role, orgId, orgName: 'Församlingen' },
    });
    const dir = mkdtempSync(join(tmpdir(), 'gp-native-settings-'));
    writeFileSync(join(dir, 'sessions.json'), JSON.stringify({ alice: await session('alice', org, 'admin'), bob: await session('bob', org, 'user'), carol: await session('carol', other, 'admin') }));

    const env = { ...process.env, ...(existsSync(pptxProgram) ? { GP_PPTX_DECK: deck } : {}) };
    const out = await promisify(execFile)(binary, ['settings', join(dir, 'sessions.json'), dir], { env, maxBuffer: 1 << 20 }).then(
      (r) => r.stdout,
      (e: { stdout?: string }) => e.stdout ?? String(e),
    );
    console.log(out.trim());
    rmSync(dir, { recursive: true, force: true });

    expect(out).toContain('ok: the other organisation has the sound and the Bible');
    expect(out).not.toContain('FAIL');
  }, 180_000);
});

/** A self-signed certificate for 127.0.0.1, made with openssl for this test only, as tls.test.ts makes one. */
function certificate(dir: string): { key: string; cert: string } | null {
  try {
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes',
      '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem'), '-days', '1',
      '-subj', '/CN=gospel-presenter-test', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost',
    ], { stdio: 'ignore' });
    return { key: readFileSync(join(dir, 'key.pem'), 'utf8'), cert: readFileSync(join(dir, 'cert.pem'), 'utf8') };
  } catch {
    return null; // no openssl here
  }
}

describe.runIf(run)('the native Videor preview from a self-signed host', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gp-native-tls-'));
  const pem = certificate(dir);
  let server: RunningServer;
  let h: Harness;
  beforeAll(async () => {
    if (!pem) return;
    server = await startNodeServer({ dataDir: join(dir, 'data'), debug: true, tls: { ...pem, port: 0 }, log: () => undefined });
    h = { name: 'node', url: server.url, mediaKeys: async () => [], dropMedia: async () => {}, close: () => server.close() };
  }, 60_000);
  afterAll(async () => {
    await server?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it.skipIf(!pem)('fetches a video through the accepted certificate and plays it, where AVPlayer cannot stream', async () => {
    const org = `org-${crypto.randomUUID()}`;
    const session = async (userId: string, role: 'admin' | 'user') => ({
      server: server.tls!.url,
      token: await setRole(h, userId, org, role),
      device: null,
      me: { userId, name: userId, role, orgId: org, orgName: 'Församlingen' },
    });
    writeFileSync(join(dir, 'sessions.json'), JSON.stringify({ alice: await session('alice', 'admin'), bob: await session('bob', 'user') }));
    const fingerprint = new X509Certificate(pem!.cert).fingerprint256;

    const out = await promisify(execFile)(binary, ['settings-tls', join(dir, 'sessions.json'), dir, fingerprint], { maxBuffer: 1 << 20 }).then(
      (r) => r.stdout,
      (e: { stdout?: string }) => e.stdout ?? String(e),
    );
    console.log(out.trim());

    expect(out).toContain('ok: https: and plays it from its folder');
    expect(out).not.toContain('FAIL');
  }, 120_000);
});
