// Bundles the Electron main process, its preload, and a plain-Node server for
// development. better-sqlite3 stays external; the desktop uses node:sqlite.
import { execFileSync } from 'node:child_process';
import { copyFileSync } from 'node:fs';
import { build } from 'esbuild';

// Only a development or test build may point sign-in at a fake Google
// (apps/server/src/google.ts); GP_RELEASE=1 is the build a package is made from.
const release = process.env.GP_RELEASE === '1';
// A release carries the host's Google client (main.ts `googleConfig`), from GP_GOOGLE_CLIENT_ID and
// GP_GOOGLE_CLIENT_SECRET when it is built (the release workflow's secrets): an app started from the Dock or the
// Start menu has no environment to read them from. A desktop app's client secret is no secret to Google (an installed
// app's), and the build does not need one to run.
const builtGoogle =
  release && process.env.GP_GOOGLE_CLIENT_ID && process.env.GP_GOOGLE_CLIENT_SECRET
    ? JSON.stringify({ clientId: process.env.GP_GOOGLE_CLIENT_ID, clientSecret: process.env.GP_GOOGLE_CLIENT_SECRET })
    : 'undefined';
const define = { GP_TEST_ISSUER: release ? 'false' : 'true', GP_BUILT_GOOGLE: builtGoogle };

const common = {
  define,
  bundle: true,
  platform: 'node',
  target: 'node22',
  outdir: 'dist',
  logLevel: 'warning',
  external: ['electron', 'better-sqlite3', 'bufferutil', 'utf-8-validate'],
  // The server's picture codecs' WebAssembly inside the bundle, as bytes (apps/server/src/picture-codecs.ts): no
  // node_modules go along in a package.
  loader: { '.wasm': 'binary' },
};

await build({
  ...common,
  // The server's picture worker beside them (apps/server/src/picture-worker.ts), where MCP's pictures are made off the
  // main process; electron-builder.yml puts it among a package's resources.
  // Named, so all three land flat in dist/ though the worker's source is in another package.
  entryPoints: { main: 'src/main.ts', serve: 'src/serve.ts', 'picture-worker': '../server/src/picture-worker.ts' },
  format: 'esm',
  outExtension: { '.js': '.mjs' },
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
// A sandboxed preload must be CommonJS.
await build({ ...common, entryPoints: ['src/preload.ts'], format: 'cjs', outExtension: { '.js': '.cjs' } });
// The host's PowerPoint drawing (crates/gp-pptx, docs/powerpoint-deckcraft.md) beside the bundle, where host.ts looks;
// electron-builder.yml puts it among a package's resources. Built for this machine; a release on a Mac, whose
// packages are arm64 and x64 alike from this one dist/, builds both and joins them into one program (lipo). Windows
// and Linux packages are this machine's architecture, as their electron-builder targets are.
const program = `gp-pptx${process.platform === 'win32' ? '.exe' : ''}`;
// A workspace of its own, so it builds into crates/gp-pptx/target.
const crate = '../../crates/gp-pptx';
const cargo = (...args) => execFileSync('cargo', ['build', '--release', '--quiet', ...args], { cwd: crate, stdio: 'inherit' });
if (process.env.GP_RELEASE === '1' && process.platform === 'darwin') {
  const macs = ['aarch64-apple-darwin', 'x86_64-apple-darwin'];
  // The Intel target only here, not in rust-toolchain.toml: no other build needs it.
  execFileSync('rustup', ['target', 'add', ...macs], { cwd: crate, stdio: 'inherit' });
  for (const target of macs) cargo('--target', target);
  execFileSync('lipo', ['-create', ...macs.map((t) => `${crate}/target/${t}/release/gp-pptx`), '-output', `dist/${program}`], { stdio: 'inherit' });
} else {
  cargo();
  copyFileSync(`${crate}/target/release/${program}`, `dist/${program}`);
}
