#!/usr/bin/env node
// Stop hook: when anything under rewrite/ differs from HEAD (untracked files included), run
// `pnpm check:quick` there; on failure exit 2 with the tail of its output on stderr, so Claude keeps working.
// Nothing changed under rewrite/: exit 0 at once.
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

const status = spawnSync('git', ['status', '--porcelain', '--untracked-files=all', '--', 'rewrite'], {
  cwd: repo,
  encoding: 'utf8',
});
if (status.status !== 0 || !status.stdout.trim()) process.exit(0);

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
