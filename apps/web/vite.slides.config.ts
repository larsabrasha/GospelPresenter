// The slide renderer of the native apps (slides.html, src/slides/main.tsx; docs/native-apps.md): the web's SlideView on
// a page of its own, with relative addresses, so the app serves it from its own files. Not part of the web app's build.
//   pnpm --filter @gp/web exec vite build -c vite.slides.config.ts      (apps/mac/apple.sh runs it)
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  // What the app's modules read of the web app's build; the renderer uses neither.
  define: { GP_COMMIT: 'null', GP_APP_SERVER: '""' },
  build: { target: 'es2022', outDir: 'dist-slides', emptyOutDir: true, rollupOptions: { input: 'slides.html' } },
});
