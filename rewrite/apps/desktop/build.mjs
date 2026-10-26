// Bundles the Electron main process, its preload, and a plain-Node server for
// development. better-sqlite3 stays external; the desktop uses node:sqlite.
import { build } from 'esbuild';

const common = {
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
