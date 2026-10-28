// Pictures of the old Blazor app and of the rewrite, same names, in one go (README "Look").
// Usage: node scripts/compare-old-app.mjs <outDir> [name,name,…]
// Makes the reference worktree ../GospelPresenter-main-ref if it is missing (detached at origin/main, after a
// fetch; an existing one is used as it is), runs the old app in mock mode on a free port, takes its pictures into
// <outDir>/old (capture-old-app.mjs), stops it, then takes the new app's into <outDir>/new (e2e/capture.spec.ts),
// and lists the names found on one side only.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rewrite = fileURLToPath(new URL('..', import.meta.url));
const repo = resolve(rewrite, '..');
const ref = resolve(repo, '..', 'GospelPresenter-main-ref');
const [outArg, only] = process.argv.slice(2).filter((a) => a !== '--');
if (!outArg) {
  console.error('Usage: node scripts/compare-old-app.mjs <outDir> [name,name,…]');
  process.exit(2);
}
const out = resolve(outArg);
const started = Date.now();
const secs = (t) => `${((Date.now() - t) / 1000).toFixed(1)} s`;

function git(...args) {
  const r = spawnSync('git', args, { cwd: repo, stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed`);
}

if (existsSync(ref)) {
  const head = spawnSync('git', ['-C', ref, 'log', '-1', '--format=%h %cs %s'], { encoding: 'utf8' }).stdout.trim();
  console.log(`compare: the old app from ${ref} as it is (${head})`);
} else {
  console.log(`compare: ${ref} is missing; fetching origin and adding it, detached at origin/main`);
  git('fetch', 'origin', 'main');
  git('worktree', 'add', '--detach', ref, 'origin/main');
}

const port = await new Promise((res, rej) => {
  const s = createServer();
  s.on('error', rej);
  s.listen(0, '127.0.0.1', () => {
    const free = s.address().port;
    s.close(() => res(free));
  });
});
const base = `http://127.0.0.1:${port}`;

// `dotnet run` starts the app as its own child: the whole process group is stopped, also on Ctrl-C or a failure.
let server;
let exited = false;
function stopServer() {
  if (!server || exited) return;
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {
    // Already gone.
  }
  exited = true;
}
process.on('exit', stopServer);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => {
    stopServer();
    process.exit(130);
  });
}

console.log(`compare: starting the old app in mock mode on ${base} (a first build takes a while)`);
let t = Date.now();
server = spawn('dotnet', ['run', '--no-launch-profile', `--urls=${base}`], {
  cwd: join(ref, 'GospelPresenter', 'GospelPresenter.Web'),
  env: { ...process.env, ASPNETCORE_ENVIRONMENT: 'Development' },
  detached: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
const keep = (d) => {
  serverLog = (serverLog + d).slice(-4000);
};
server.stdout.on('data', keep);
server.stderr.on('data', keep);
server.on('exit', () => {
  exited = true;
});

const deadline = Date.now() + 300_000;
for (;;) {
  if (exited) {
    console.error(serverLog);
    throw new Error('the old app stopped before it answered');
  }
  if (Date.now() > deadline) {
    stopServer();
    console.error(serverLog);
    throw new Error('the old app did not answer in 300 s');
  }
  try {
    await fetch(base, { signal: AbortSignal.timeout(2000) });
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 1000));
  }
}
console.log(`compare: the old app answers after ${secs(t)}`);

/** Runs a command with its output shown; resolves to its exit code and the lines starting with FAIL. */
function run(cmd, args, opts) {
  return new Promise((res) => {
    const child = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'inherit'] });
    let text = '';
    child.stdout.on('data', (d) => {
      process.stdout.write(d);
      text += d;
    });
    child.on('exit', (code) => res({ code, failed: text.split('\n').filter((l) => l.startsWith('FAIL')) }));
  });
}

t = Date.now();
mkdirSync(join(out, 'old'), { recursive: true });
const old = await run('node', [join(rewrite, 'scripts', 'capture-old-app.mjs'), base, join(out, 'old'), ...(only ? [only] : [])], {
  cwd: rewrite,
});
stopServer();
console.log(`compare: old pictures in ${secs(t)} (exit ${old.code}, ${old.failed.length} failed); the old app stopped`);

t = Date.now();
const fresh = await run('pnpm', ['--filter', '@gp/desktop', 'exec', 'playwright', 'test', 'capture'], {
  cwd: rewrite,
  env: { ...process.env, GP_CAPTURE: join(out, 'new'), ...(only ? { GP_CAPTURE_ONLY: only } : {}) },
});
console.log(`compare: new pictures in ${secs(t)} (exit ${fresh.code})`);

const pngs = (dir) => new Set(existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.png')) : []);
const oldNames = pngs(join(out, 'old'));
const newNames = pngs(join(out, 'new'));
const onlyOld = [...oldNames].filter((n) => !newNames.has(n)).toSorted();
const onlyNew = [...newNames].filter((n) => !oldNames.has(n)).toSorted();
console.log(`\ncompare: ${oldNames.size} old, ${newNames.size} new pictures in ${out}/{old,new}`);
console.log(`only old (${onlyOld.length}): ${onlyOld.join(' ') || '-'}`);
console.log(`only new (${onlyNew.length}): ${onlyNew.join(' ') || '-'}`);
if (old.failed.length) console.log(`old pictures that failed:\n${old.failed.join('\n')}`);
console.log(`compare: done in ${secs(started)}`);
process.exit(old.code === 0 && fresh.code === 0 ? 0 : 1);
