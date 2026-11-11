import { parseArgs } from 'node:util';
import { exportOrg } from './export.ts';
import { listOrgs, readOrg } from './old-db.ts';
import { s3Store } from './s3.ts';

// The export from 1.x (docs/import-from-1x.md): the Docker image beside the old app (Dockerfile here), or
// `pnpm --filter @gp/legacy export --org <id>` where the old database and Garage are reachable. Without `--org`
// it lists the organisations. Nothing in 1.x changes.

const HELP = `Exports one organisation of Gospel Presenter 1.x as a zip that 2.0 imports.

  --org <id>     the organisation (without it, the organisations are listed)
  --out <file>   where the zip goes (default: gospel-presenter-<org>.zip)

The old app is reached through its own .env, as its docker-compose.yml names it, from a container on its network:
  POSTGRES_PASSWORD, S3_ACCESS_KEY, S3_SECRET_KEY, S3_BUCKET_NAME (default gospelpresenter)
or, from anywhere else, through these:
  GP_OLD_DATABASE     PostgreSQL, e.g. postgres://gospelpresenter:…@localhost:5432/gospelpresenter
  GP_OLD_S3_ENDPOINT  Garage's S3 address, e.g. http://localhost:3900
  GP_OLD_S3_ACCESS_KEY, GP_OLD_S3_SECRET_KEY, GP_OLD_S3_BUCKET, GP_OLD_S3_REGION (default garage)
`;

const say = (line: string) => process.stdout.write(`${line}\n`);

/** The first of `names` that is set, else `fallback`. */
function env(names: string[], fallback?: string): string {
  const v = names.map((n) => process.env[n]).find(Boolean) ?? fallback;
  if (!v) throw new Error(`${names.join(' or ')} is not set (--help)`);
  return v;
}

/** The old app's database: GP_OLD_DATABASE, or its compose service with the password from its .env. */
function database(): string {
  const password = process.env.POSTGRES_PASSWORD;
  return env(['GP_OLD_DATABASE'], password ? `postgres://gospelpresenter:${encodeURIComponent(password)}@postgres:5432/gospelpresenter` : undefined);
}

async function main() {
  const { values } = parseArgs({ options: { org: { type: 'string' }, out: { type: 'string' }, help: { type: 'boolean' } } });
  if (values.help) return say(HELP);
  const url = database();
  if (!values.org) {
    for (const o of await listOrgs(url)) say(`${o.id}  ${o.name} (${o.users} users)`);
    return say('\nExport one with --org <id>.');
  }
  const store = s3Store({
    endpoint: env(['GP_OLD_S3_ENDPOINT'], 'http://garage:3900'),
    bucket: env(['GP_OLD_S3_BUCKET', 'S3_BUCKET_NAME'], 'gospelpresenter'),
    accessKey: env(['GP_OLD_S3_ACCESS_KEY', 'S3_ACCESS_KEY']),
    secretKey: env(['GP_OLD_S3_SECRET_KEY', 'S3_SECRET_KEY']),
    region: env(['GP_OLD_S3_REGION'], 'garage'),
  });
  const data = await readOrg(url, values.org);
  const out = values.out ?? `gospel-presenter-${values.org}.zip`;
  say(`${data.org.Name}: ${data.songs.length} songs, ${data.presentations.length} presentations, ${data.users.length} users`);
  const report = await exportOrg(data, store, out, (done, total) => process.stdout.write(`\rFiles: ${done} of ${total}`));
  say('');
  for (const [what, n] of Object.entries(report.manifest.counts)) say(`  ${what}: ${n}`);
  for (const p of report.problems) say(`  not moved: ${p}`);
  for (const s of report.skipped) say(`  left out of a running order: "${s.title}" (${s.reason})`);
  say(`Written to ${out}`);
}

main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  process.exitCode = 1;
});
