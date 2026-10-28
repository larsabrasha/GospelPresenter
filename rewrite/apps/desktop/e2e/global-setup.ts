// The e2e runs the built app (dist/, and the web app's dist/). Run through `pnpm e2e`, turbo has
// built it first (turbo.json: e2e depends on build) and sets TURBO_HASH. Run directly
// (`playwright test <spec>`), it builds here, so a test never runs against a stale build. Turbo
// rebuilds only what changed, so with nothing changed this takes a second or two.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export default function globalSetup(): void {
  if (process.env.TURBO_HASH) return;
  const root = fileURLToPath(new URL('../../..', import.meta.url));
  const started = Date.now();
  execFileSync('pnpm', ['turbo', 'run', 'build', '--filter=@gp/desktop...', '--output-logs=errors-only'], { cwd: root, stdio: 'inherit' });
  console.log(`e2e: the app is built (${((Date.now() - started) / 1000).toFixed(1)} s)`);
}
