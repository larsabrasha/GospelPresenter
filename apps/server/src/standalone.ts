// The server on its own, as the Docker image runs it (docs/self-hosting.md): the web app and the API from one origin,
// its data in GP_DATA_DIR, configured by GP_* (node-env.ts). Bundled by build-node.mjs into dist/node-server.mjs.
// `node node-server.mjs backup` makes tonight's backup and stops, beside a running server too.
import { join } from 'node:path';
import { backupDataDir } from './backup-node.ts';
import { startNodeServer } from './node.ts';
import { proxiesFromEnv, signInFromEnv } from './node-env.ts';

const env = process.env;
const dataDir = env.GP_DATA_DIR ?? '/data';
const backupDir = env.GP_BACKUP_DIR ?? join(dataDir, 'backups');
const HOUR_MS = 3_600_000;

if (process.argv[2] === 'backup') {
  const r = backupDataDir(dataDir, backupDir);
  console.log(r.made ? `Backup made: ${join(backupDir, r.day)}` : `Tonight's backup is there already: ${join(backupDir, r.day)}`);
  if (r.removed.length) console.log(`Removed by the thinning: ${r.removed.join(', ')}`);
  process.exit(0);
}

const server = await startNodeServer({
  // Node's own SQLite: nothing to compile in the image.
  driver: 'node:sqlite',
  dataDir,
  webRoot: env.GP_WEB_ROOT ?? new URL('./web', import.meta.url).pathname,
  port: Number(env.PORT ?? 8080),
  // Every address of the container: its port is reached through Docker's, or a reverse proxy beside it.
  hostname: env.GP_HOSTNAME ?? '0.0.0.0',
  // Without one, a random token is made and printed below until setup is done.
  setupToken: env.GP_SETUP_TOKEN || undefined,
  trustedProxies: proxiesFromEnv(env),
  ...signInFromEnv(env),
});
console.log(`Gospel Presenter is listening on port ${server.port}`);
if (server.setupToken) console.log(`Setup token: ${server.setupToken}`);

// The nightly backup (backup-node.ts), unless GP_BACKUPS=off: looked for each hour, so the first look of a day in UTC
// makes it, a minute after a start too.
if (env.GP_BACKUPS !== 'off') {
  const nightly = () => {
    try {
      const r = backupDataDir(dataDir, backupDir);
      if (r.made) console.warn(JSON.stringify({ event: 'backup-made', day: r.day, removed: r.removed }));
    } catch (e) {
      console.warn(JSON.stringify({ event: 'backup-failed', error: String(e) }));
    }
  };
  setTimeout(nightly, 60_000);
  setInterval(nightly, HOUR_MS);
}

// `docker stop` sends SIGTERM: close the databases cleanly before the container goes.
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.once(signal, () => {
    void server.close().then(() => process.exit(0));
  });
