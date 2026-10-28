// The quick check, for a change in progress: typecheck, lint and the unit tests, with the server's
// tests on the node adapter only (SYNC_ADAPTERS). Spec files given as arguments then run in e2e,
// on a fresh build. Not a replacement for the full checks (AGENTS.md, "Commands").
// Usage: pnpm check:quick [-- e2e/drag.spec.ts …]
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
// pnpm may pass the `--` through; a spec may be named from the repo's root or the desktop app.
const specs = process.argv
  .slice(2)
  .filter((a) => a !== '--')
  .map((a) => a.replace(/^(rewrite\/)?apps\/desktop\//, ''));

function run(label, cmd, args, env = {}) {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } });
    child.on('exit', (code) => {
      console.log(`check:quick: ${label} ${code === 0 ? 'passed' : 'FAILED'} in ${((Date.now() - started) / 1000).toFixed(1)} s`);
      resolve(code === 0);
    });
  });
}

const started = Date.now();
const results = await Promise.all([
  run('lint', 'pnpm', ['lint']),
  run('typecheck and unit tests', 'pnpm', ['turbo', 'run', 'typecheck', 'test', '--output-logs=errors-only'], { SYNC_ADAPTERS: 'node' }),
]);
let ok = results.every(Boolean);
if (ok && specs.length) {
  // The e2e's global setup (apps/desktop/e2e/global-setup.ts) builds the app first.
  ok = await run('build and e2e', 'pnpm', ['--filter', '@gp/desktop', 'exec', 'playwright', 'test', ...specs]);
}
console.log(`check:quick: ${ok ? 'passed' : 'FAILED'} in ${((Date.now() - started) / 1000).toFixed(1)} s`);
process.exit(ok ? 0 : 1);
