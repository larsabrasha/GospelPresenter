// The phone app's web bundle: the web app built with its default server built in (GP_APP_SERVER, apps/web/src/server.ts)
// into www/, then copied into the native projects by `cap sync`. Not turbo's build: the bundle differs from the
// browser's by that one value, and turbo would take one for the other.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** The test environment on Cloudflare (docs/cloudflare.md) until the app has a cloud of its own. */
const DEFAULT_SERVER = 'https://gp-test.lars-arvidsson.workers.dev';

const here = fileURLToPath(new URL('.', import.meta.url));
const env = { ...process.env, GP_APP_SERVER: process.env.GP_APP_SERVER || DEFAULT_SERVER };
execFileSync('pnpm', ['--filter', '@gp/web', 'build', '--outDir', `${here}www`, '--emptyOutDir'], { env, stdio: 'inherit' });
execFileSync('pnpm', ['exec', 'cap', 'sync', 'ios'], { cwd: here, stdio: 'inherit' });
