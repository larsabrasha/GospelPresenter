// A deploy that can be traced to its commit (the review, 2026-11-09): `pnpm deploy:test` or `pnpm deploy:apptest`.
// It refuses a working tree with changes (wrangler bundles the Worker from the files as they are), builds the web app
// with GP_COMMIT, so its page says which commit it is, and names the Worker version by the commit, so
// `wrangler rollback` can find the one before. `--dry-run` builds and checks without uploading.
import { execFileSync } from 'node:child_process';

const env = process.argv[2];
const configs = { test: 'wrangler.test.toml', apptest: 'wrangler.apptest.toml' };
if (!configs[env]) {
  console.error(`usage: node scripts/deploy.mjs <${Object.keys(configs).join('|')}> [--dry-run]`);
  process.exit(2);
}
const dryRun = process.argv.includes('--dry-run');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const changed = git('status', '--porcelain', '--', '.');
if (changed && !dryRun) {
  console.error(`Not deployed: the working tree has changes, and the Worker would not be the commit's.\n${changed}`);
  process.exit(1);
}
const commit = git('rev-parse', 'HEAD');
const subject = git('log', '-1', '--format=%s').slice(0, 100);
const run = (cmd, args, cwd = '.') => execFileSync(cmd, args, { cwd, stdio: 'inherit', env: { ...process.env, GP_COMMIT: commit } });
run('pnpm', ['build']);
run('npx', ['wrangler', 'deploy', '--config', configs[env], '--tag', commit.slice(0, 7), '--message', subject, ...(dryRun ? ['--dry-run'] : [])], 'apps/server');
