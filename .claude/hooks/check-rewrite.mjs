#!/usr/bin/env node
// Stop hook: when the turn changed anything under rewrite/ (untracked files included), run `pnpm check:quick`
// there; on failure exit 2 with the tail of its output on stderr, so Claude keeps working.
// Nothing under rewrite/ differs from HEAD, or the turn left it as it was: exit 0 at once.
// `check-rewrite.mjs turn-start` (UserPromptSubmit hook) saves a fingerprint of rewrite/ when the turn begins;
// the Stop hook compares with it. No saved fingerprint (the hook came mid-session): run the check.
// Loops: when stop_hook_active is set (Claude is already continuing because of a stop hook) and the failure
// is the same as the one this hook last blocked on, let the stop through instead of blocking again.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let input = {};
try {
  input = JSON.parse(readFileSync(0, 'utf8') || '{}');
} catch {
  // No or bad JSON on stdin: treat as a first stop.
}

const repo =
  process.env.CLAUDE_PROJECT_DIR ||
  spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: input.cwd || process.cwd(), encoding: 'utf8' }).stdout.trim();
if (!repo) process.exit(0);

const git = (args, options = {}) => spawnSync('git', args, { cwd: repo, maxBuffer: 256 * 1024 * 1024, ...options });

// HEAD, the diff against it and the untracked files' contents: equal fingerprints mean an equal rewrite/.
function fingerprint() {
  const hash = createHash('sha1');
  hash.update(git(['rev-parse', 'HEAD']).stdout);
  hash.update(git(['diff', 'HEAD', '--binary', '--', 'rewrite']).stdout);
  const untracked = git(['ls-files', '--others', '--exclude-standard', '--', 'rewrite'], { encoding: 'utf8' }).stdout;
  if (untracked.trim()) {
    hash.update(untracked);
    hash.update(git(['hash-object', '--stdin-paths'], { input: untracked }).stdout);
  }
  return hash.digest('hex');
}

const turnStart = join(tmpdir(), `gp-stop-hook-start-${input.session_id || 'nosession'}`);
if (process.argv[2] === 'turn-start') {
  writeFileSync(turnStart, fingerprint());
  process.exit(0);
}

const status = git(['status', '--porcelain', '--untracked-files=all', '--', 'rewrite'], { encoding: 'utf8' });
if (status.status !== 0 || !status.stdout.trim()) process.exit(0);

let started = '';
try {
  started = readFileSync(turnStart, 'utf8');
} catch {}
if (started && started === fingerprint()) process.exit(0);

const run = spawnSync('pnpm', ['check:quick'], {
  cwd: join(repo, 'rewrite'),
  encoding: 'utf8',
  env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
  maxBuffer: 64 * 1024 * 1024,
});
const marker = join(tmpdir(), `gp-stop-hook-${input.session_id || 'nosession'}`);
if (run.status === 0) {
  rmSync(marker, { force: true });
  process.exit(0);
}

// The useful tail: drop blank lines and turbo's progress noise, keep the last lines.
const lines = `${run.stdout}\n${run.stderr}`
  .replace(/\x1b\[[0-9;]*m/g, '')
  .split('\n')
  .filter((l) => l.trim() && !/^\s*(•|Tasks:|Cached:|Time:|>>> FULL TURBO)/.test(l));
const tail = lines.slice(-60).join('\n');

const digest = createHash('sha1').update(tail.replace(/\d+(\.\d+)? ?m?s\b/g, '')).digest('hex');
let last = '';
try {
  last = readFileSync(marker, 'utf8');
} catch {}
if (input.stop_hook_active && last === digest) {
  // Same failure as last time: Claude did not get further, so do not block forever.
  process.exit(0);
}
writeFileSync(marker, digest);
process.stderr.write(`pnpm check:quick failed in rewrite/ (Stop hook, .claude/hooks/check-rewrite.mjs):\n${tail}\n`);
process.exit(2);
