// Bundles the Electron main process, its preload, and a plain-Node server for
// development. better-sqlite3 stays external; the desktop uses node:sqlite.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

// Only a development or test build may point sign-in at a fake Google
// (apps/server/src/google.ts); GP_RELEASE=1 is the build a package is made from.
const define = { GP_TEST_ISSUER: process.env.GP_RELEASE === '1' ? 'false' : 'true' };

const common = {
  define,
  bundle: true,
  platform: 'node',
  target: 'node22',
  outdir: 'dist',
  logLevel: 'warning',
  external: ['electron', 'better-sqlite3', 'bufferutil', 'utf-8-validate'],
};

await build({
  ...common,
  entryPoints: ['src/main.ts', 'src/serve.ts'],
  format: 'esm',
  outExtension: { '.js': '.mjs' },
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
// A sandboxed preload must be CommonJS.
await build({ ...common, entryPoints: ['src/preload.ts'], format: 'cjs', outExtension: { '.js': '.cjs' } });
// The Rust core's WASM beside the bundle, where the server's copy of @gp/rust-core/node reads it (`../dist/` from
// dist/main.mjs is dist/ itself).
mkdirSync('dist', { recursive: true });
copyFileSync(createRequire(import.meta.url).resolve('@gp/rust-core/gp_core.wasm'), 'dist/gp_core.wasm');
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
