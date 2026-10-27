import { createHash } from 'node:crypto';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/**
 * Builds the service worker (sw/sw.ts) as `/sw.js`, a fixed name at the root
 * so its scope is the whole app, and writes into it the build's files and a
 * hash of their contents: a new build is a new worker, and so a new cache.
 */
function serviceWorker(): Plugin {
  const fileName = 'sw.js';
  return {
    name: 'gp-service-worker',
    apply: 'build',
    enforce: 'post',
    buildStart() {
      this.emitFile({ type: 'chunk', id: 'sw/sw.ts', fileName });
    },
    generateBundle(_options, bundle) {
      const hash = createHash('sha256');
      const files: string[] = [];
      for (const name of Object.keys(bundle).toSorted()) {
        const out = bundle[name]!;
        if (name === fileName || name.endsWith('.map')) continue;
        files.push(`/${name}`);
        hash.update(name).update(out.type === 'chunk' ? out.code : out.source);
      }
      const sw = bundle[fileName];
      if (sw?.type !== 'chunk') throw new Error('the service worker was not built');
      if (!files.includes('/index.html')) throw new Error('the service worker would keep no index.html');
      const build = JSON.stringify({ version: hash.digest('hex').slice(0, 16), files });
      if (!sw.code.includes('GP_BUILD')) throw new Error('the service worker has no GP_BUILD to fill in');
      sw.code = sw.code.replaceAll('GP_BUILD', `(${build})`);
    },
  };
}

export default defineConfig({
  plugins: [react(), serviceWorker()],
  // wa-sqlite loads its own wasm; pre-bundling would break the URL.
  optimizeDeps: { exclude: ['@journeyapps/wa-sqlite'] },
  worker: { format: 'es' },
  build: { target: 'es2022' },
  server: {
    // `pnpm dev` talks to a server started with `pnpm --filter @gp/desktop serve` (port 8787).
    proxy: { '/api': { target: 'http://127.0.0.1:8787', ws: true } },
  },
});
