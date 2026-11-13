// The desktop host's windows as Electron's security checklist asks (and as Signal Desktop checks): a page reaches
// the main process only through the preload, runs sandboxed, and stays on the app.
import { describe, expect, it } from 'vitest';
import { FILES } from './source.ts';

const MAIN = 'apps/desktop/src/main.ts';
const desktop = () => FILES.filter((f) => f.pkg === 'apps/desktop' && f.kind === 'source');
const text = (path: string) => FILES.find((f) => f.path === path)!.lines.join('\n');

/** Settings that open a page to Node, to other sites or to old Electron APIs. */
const UNSAFE = [/nodeIntegration\w*:\s*true/, /contextIsolation:\s*false/, /sandbox:\s*false/, /webSecurity:\s*false/, /allowRunningInsecureContent:\s*true/, /webviewTag:\s*true/, /enableRemoteModule/];

describe("the desktop host's windows", () => {
  it('turn on context isolation and the sandbox, and leave Node out, in the settings every window shares', () => {
    const shared = /const webPreferences = \{([\s\S]*?)\n\};/.exec(text(MAIN))?.[1] ?? '';

    expect([/contextIsolation: true/, /nodeIntegration: false/, /sandbox: true/].filter((r) => !r.test(shared)).map(String)).toEqual([]);
  });

  it('give every window those settings and the guard that keeps it on the app', () => {
    const main = text(MAIN);
    const windows = [...main.matchAll(/new BrowserWindow\(\{([\s\S]*?)\}\);/g)].map((m) => m[1]!);

    expect(windows.length).toBeGreaterThan(0);
    expect(windows.filter((w) => !/\bwebPreferences\b(?!:)/.test(w))).toEqual([]);
    expect(main.match(/\bguardWindow\((?!win)/g)?.length).toBe(windows.length);
  });

  it('turn nothing unsafe on anywhere', () => {
    const unsafe = desktop().flatMap((f) => f.lines.flatMap((line, i) => (UNSAFE.some((r) => r.test(line)) ? [`${f.path}:${i + 1}`] : [])));

    expect(unsafe).toEqual([]);
  });
});
