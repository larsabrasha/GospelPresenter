// A night of the Cloudflare backup (apps/server/src/backup-r2.ts) as an export zip, which Importera under Organisationen
// reads (docs/cloudflare.md, "Backups"). Fetched with wrangler, so `wrangler login` first. From the repository's root:
//   pnpm backup:zip -- --config apps/server/wrangler.app.toml --org <id>                 # lists the nights, makes the newest
//   pnpm backup:zip -- --config apps/server/wrangler.app.toml --org <id> --night 2026-11-25 --out kyrkan.zip
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { LEGACY_ENTRIES } from '../packages/core/src/legacy.ts';
import { makeZip } from '../packages/core/src/zip.ts';

const { values: a } = parseArgs({ options: { config: { type: 'string' }, org: { type: 'string' }, night: { type: 'string' }, out: { type: 'string' } } });
if (!a.config || !a.org) {
  console.error('usage: pnpm backup:zip -- --config apps/server/wrangler.<env>.toml --org <id> [--night YYYY-MM-DD] [--out file.zip]');
  process.exit(2);
}
// The bucket bound as BACKUPS in that config.
const bucket = /binding\s*=\s*"BACKUPS"\s*\n\s*bucket_name\s*=\s*"([^"]+)"/.exec(readFileSync(a.config, 'utf8'))?.[1];
if (!bucket) {
  console.error(`${a.config} binds no BACKUPS bucket`);
  process.exit(2);
}

const work = mkdtempSync(join(tmpdir(), 'gp-backup-zip-'));
/** An object of the bucket, or null if it is not there. */
function fetchObject(key) {
  const file = join(work, 'object');
  try {
    execFileSync('npx', ['wrangler', 'r2', 'object', 'get', `${bucket}/${key}`, '--file', file, '--remote'], { stdio: ['ignore', 'ignore', 'pipe'] });
    return readFileSync(file);
  } catch {
    return null;
  } finally {
    rmSync(file, { force: true });
  }
}

try {
  const at = `orgs/${a.org}/`;
  const index = fetchObject(`${at}index.json`);
  if (!index) throw new Error(`no backups of organisation ${a.org} in ${bucket}`);
  const nights = Object.keys(JSON.parse(index.toString()).nights).toSorted();
  console.log(`Nights: ${nights.join(', ')}`);
  const day = a.night ?? nights.at(-1);
  const night = fetchObject(`${at}nights/${day}.json`);
  if (!night) throw new Error(`no night ${day}`);
  const n = JSON.parse(night.toString());

  const json = (v) => new TextEncoder().encode(JSON.stringify(v));
  const counts = Object.fromEntries(Object.entries(n.rows).map(([t, rows]) => [t, rows.length]));
  const manifest = { format: n.format, orgName: n.orgName, exportedAt: n.exportedAt, counts: { ...counts, users: n.users.length, blobs: n.blobs.length, bibleTexts: n.bibles.length } };
  const entries = [
    { name: LEGACY_ENTRIES.manifest, data: json(manifest) },
    { name: LEGACY_ENTRIES.users, data: json(n.users) },
    ...Object.entries(n.rows).map(([t, rows]) => ({ name: LEGACY_ENTRIES.rows(t), data: json(rows) })),
  ];
  const missing = [];
  for (const [i, hash] of n.blobs.entries()) {
    process.stdout.write(`\rFiles ${i + 1}/${n.blobs.length}`);
    const data = fetchObject(`${at}files/${hash}`);
    if (data) entries.push({ name: LEGACY_ENTRIES.blob(hash), data });
    else missing.push(hash);
  }
  process.stdout.write('\n');
  for (const hash of n.bibles) {
    const data = fetchObject(`${at}bibles/${hash}.json`);
    if (data) entries.push({ name: LEGACY_ENTRIES.bible(hash), data });
    else missing.push(`bible ${hash}`);
  }
  const out = a.out ?? `gospel-presenter-${a.org}-${day}.zip`;
  writeFileSync(out, makeZip(entries));
  console.log(`Wrote ${out}: the night of ${day}, ${n.blobs.length - missing.filter((m) => !m.startsWith('bible')).length} files.`);
  // The import refuses rows that name a file it was not given: a missing one has to be found, or its row removed.
  if (missing.length) console.log(`Not in the backup (not copied yet, or gone from the organisation): ${missing.join(', ')}`);
} catch (e) {
  console.error(String(e instanceof Error ? e.message : e));
  process.exitCode = 1;
} finally {
  rmSync(work, { recursive: true, force: true });
}
