#!/usr/bin/env node
/**
 * Every suite, one command, one summary at the end.
 *
 * Running them by hand one at a time is how a suite quietly stops being run:
 * you remember the four you were working on and forget the tenth. This runs
 * the lot and prints a table, so "all green" is a thing you can actually see.
 *
 * Sequential on purpose. Ports are safe to run in parallel now (each server
 * takes an OS-assigned one), but the browser suites each drive a Chromium and
 * several at once simply starve a laptop until Playwright times out.
 *
 * The browser suites SKIP without Playwright rather than failing, so this is
 * useful with or without it. Point STARDRIVE_PLAYWRIGHT at an install to
 * include them:
 *
 *   STARDRIVE_PLAYWRIGHT=/path/to/node_modules/playwright/index.mjs \
 *     node services/api/test/run-all.mjs
 *
 * Run: node services/api/test/run-all.mjs [name ...]
 */
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));

/**
 * Cheap and fast first, so a broken unit shows up in seconds rather than after
 * ten minutes of browser work. `proof-run` is excluded by default: it does a
 * real npm install and next build, which takes minutes and needs the network.
 */
const SUITES = [
  'template-kit',
  'accounts', 'site-env', 'seeds', 'ops', 'jobs-runner',
  'billing-money-path', 'backup-restore', 'batch-integration', 'e2e',
  'console-a11y', 'console-responsive', 'console-states', 'handoff-ui', 'batch-ui', 'studio-ui',
];

/** Suites that live outside this package. */
const ELSEWHERE = {
  'template-kit': path.resolve(TEST_DIR, '..', '..', '..', 'packages', 'template-kit', 'test', 'run.mjs'),
};

const only = process.argv.slice(2);
const selected = only.length ? SUITES.filter((s) => only.includes(s)) : SUITES;
const unknown = only.filter((s) => !SUITES.includes(s));
if (unknown.length) {
  console.error(`Unknown suite(s): ${unknown.join(', ')}\nKnown: ${SUITES.join(', ')}`);
  process.exit(2);
}

const run = (name) => new Promise((resolve) => {
  const started = Date.now();
  const child = spawn(process.execPath, [ELSEWHERE[name] || path.join(TEST_DIR, `${name}.mjs`)], {
    cwd: path.resolve(TEST_DIR, '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  child.on('exit', (code) => resolve({ name, code, out, ms: Date.now() - started }));
});

const results = [];
for (const name of selected) {
  process.stdout.write(`  ${name.padEnd(20)}`);
  const r = await run(name);
  results.push(r);
  const secs = `${(r.ms / 1000).toFixed(1)}s`;
  if (r.code === 0 && /SKIPPED/.test(r.out)) process.stdout.write(`skip  ${secs}\n`);
  else if (r.code === 0) process.stdout.write(`pass  ${secs}\n`);
  else process.stdout.write(`FAIL  ${secs}\n`);
}

const failed = results.filter((r) => r.code !== 0);
const skipped = results.filter((r) => r.code === 0 && /SKIPPED/.test(r.out));

// Only failures get their output printed. A passing suite's log is noise; a
// failing one is the whole reason you ran this.
for (const r of failed) {
  console.error(`\n${'─'.repeat(70)}\n${r.name}\n${'─'.repeat(70)}\n${r.out.trimEnd()}`);
}

const passed = results.length - failed.length - skipped.length;
console.log(`\n${passed} passed, ${failed.length} failed, ${skipped.length} skipped.`);
if (skipped.length) {
  console.log(`Skipped for want of Playwright: ${skipped.map((r) => r.name).join(', ')}`);
  console.log('Set STARDRIVE_PLAYWRIGHT to an install to run them.');
}
process.exit(failed.length ? 1 : 0);
