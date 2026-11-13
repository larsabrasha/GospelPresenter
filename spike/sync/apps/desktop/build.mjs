// Bundles the Electron main process (and the same code for plain Node).
// better-sqlite3 stays external: it is a native (Node-API) module.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/main.ts', 'src/node-main.ts', 'src/lan-check.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outdir: 'dist',
  outExtension: { '.js': '.mjs' },
  external: ['electron', 'better-sqlite3', 'bufferutil', 'utf-8-validate', '@journeyapps/wa-sqlite'],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'warning',
});
