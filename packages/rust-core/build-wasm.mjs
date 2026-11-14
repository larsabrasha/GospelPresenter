// Builds the Rust core (crates/gp-core) to WASM in dist/gp_core.wasm, for the web's database worker, the Worker
// and Node. Turbo runs it as the `wasm` task before the packages that load it build or test (turbo.json).
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
execFileSync('cargo', ['build', '-p', 'gp-core', '--release', '--target', 'wasm32-unknown-unknown', '--quiet'], { cwd: root, stdio: 'inherit' });
mkdirSync(new URL('dist', import.meta.url), { recursive: true });
copyFileSync(`${root}target/wasm32-unknown-unknown/release/gp_core.wasm`, new URL('dist/gp_core.wasm', import.meta.url));
