// The server on its own, as the Docker image runs it (docs/self-hosting.md): the web app and the API from one origin,
// its data in GP_DATA_DIR, configured by GP_* (node-env.ts). Bundled by build-node.mjs into dist/node-server.mjs.
import { startNodeServer } from './node.ts';
import { proxiesFromEnv, signInFromEnv } from './node-env.ts';

const env = process.env;
const server = await startNodeServer({
  // Node's own SQLite: nothing to compile in the image.
  driver: 'node:sqlite',
  dataDir: env.GP_DATA_DIR ?? '/data',
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

// `docker stop` sends SIGTERM: close the databases cleanly before the container goes.
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.once(signal, () => {
    void server.close().then(() => process.exit(0));
  });
