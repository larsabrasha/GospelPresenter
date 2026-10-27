import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // wa-sqlite loads its own wasm; pre-bundling would break the URL.
  optimizeDeps: { exclude: ['@journeyapps/wa-sqlite'] },
  worker: { format: 'es' },
  build: { target: 'es2022' },
  server: {
    // `pnpm dev` talks to a server started with `pnpm --filter @gp/desktop serve` (port 8787).
    proxy: { '/api': { target: 'http://127.0.0.1:8787', ws: true } },
  },
});
