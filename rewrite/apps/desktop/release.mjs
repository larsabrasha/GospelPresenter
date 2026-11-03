// Makes the installable desktop app (D32, docs/desktop-app.md): a release build of the web app, which shows this
// commit as its version, and of the main process, which never points sign-in at a fake Google (build.mjs); then
// electron-builder's packages for this system in release/. Arguments go on to electron-builder (`-- --mac --arm64`).
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const commit = execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { encoding: 'utf8' }).trim();
const env = { ...process.env, GP_RELEASE: '1', GP_COMMIT: commit };

execFileSync('pnpm', ['exec', 'turbo', 'run', 'build', '--filter=@gp/desktop...'], { cwd: root, env, stdio: 'inherit' });
execFileSync('pnpm', ['exec', 'electron-builder', ...process.argv.slice(2).filter((a) => a !== '--')], { env, stdio: 'inherit' });
