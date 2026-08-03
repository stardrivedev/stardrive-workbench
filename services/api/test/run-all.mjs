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
 * Set STARDRIVE_TEST_REPEAT=N to run the whole set N times and report which
 * suites failed in any round — the tool for hunting a rare flake.
 *
 * Run: node services/api/test/run-all.mjs [name ...]
 */
import fs from 'node:fs';
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
  'accounts', 'site-env', 'seeds', 'module-coverage', 'shared-deps', 's3-signing', 'ops', 'jobs-runner',
  'billing-money-path', 'backup-restore', 'batch-integration', 'intake-links', 'e2e',
  'console-a11y', 'console-responsive', 'console-states',
  'intake-ui', 'handoff-ui', 'batch-ui', 'studio-ui',
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

/**
 * Failing output goes to a file as well as the screen.
 *
 * A failure was lost once simply because the run was piped through `tail` and
 * the detail scrolled past, which left a real flake with no evidence at all.
 * Printing it is not enough: it has to survive being read carelessly.
 */
const LOG_DIR = path.resolve(TEST_DIR, '..', 'test-logs');

const runOnce = async (label) => {
  const results = [];
  for (const name of selected) {
    process.stdout.write(`  ${name.padEnd(20)}`);
    const r = await run(name);
    results.push(r);
    const secs = `${(r.ms / 1000).toFixed(1)}s`;
    if (r.code === 0 && /SKIPPED/.test(r.out)) process.stdout.write(`skip  ${secs}\n`);
    else if (r.code === 0) process.stdout.write(`pass  ${secs}\n`);
    else {
      fs.mkdirSync(LOG_DIR, { recursive: true });
      const file = path.join(LOG_DIR, `${name}${label ? `.${label}` : ''}.log`);
      fs.writeFileSync(file, r.out);
      r.logFile = file;
      process.stdout.write(`FAIL  ${secs}\n`);
    }
  }
  return results;
};

const rounds = Number(process.env.STARDRIVE_TEST_REPEAT || 1);
const tally = new Map(); // suite -> how many rounds it failed
let lastResults = [];

for (let round = 1; round <= rounds; round += 1) {
  if (rounds > 1) console.log(`\n── round ${round} of ${rounds}`);
  lastResults = await runOnce(rounds > 1 ? `round${round}` : '');
  for (const r of lastResults.filter((x) => x.code !== 0)) {
    tally.set(r.name, (tally.get(r.name) || 0) + 1);
  }
}

const failed = lastResults.filter((r) => r.code !== 0);
const skipped = lastResults.filter((r) => r.code === 0 && /SKIPPED/.test(r.out));

// A passing suite's log is noise; a failing one is the whole reason you ran
// this, so it gets printed in full.
for (const r of failed) {
  console.error(`\n${'─'.repeat(70)}\n${r.name}\n${'─'.repeat(70)}\n${r.out.trimEnd()}`);
}

const passed = lastResults.length - failed.length - skipped.length;
if (rounds > 1) {
  console.log(`\n${rounds} rounds. ${tally.size ? 'Suites that failed at least once:' : 'Nothing failed in any round.'}`);
  for (const [name, n] of [...tally].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${name.padEnd(20)} failed ${n}/${rounds}`);
  }
}
// The summary line names the failures, so even `| tail -1` says what broke.
console.log(`\n${passed} passed, ${failed.length} failed, ${skipped.length} skipped.`
  + (failed.length ? `  FAILED: ${failed.map((r) => r.name).join(', ')}` : ''));
if (failed.length) console.log(`Full output kept in ${LOG_DIR}`);
if (skipped.length) {
  console.log(`Skipped for want of Playwright: ${skipped.map((r) => r.name).join(', ')}`);
  console.log('Set STARDRIVE_PLAYWRIGHT to an install to run them.');
}
process.exit(failed.length || tally.size ? 1 : 0);
