#!/usr/bin/env node
/**
 * T011 aggregate runner: `npm run test:oracle`.
 *
 * Runs every Oracle diff entry point and fails if any fails:
 * `oracle:diff:modes`, `oracle:diff:events`,
 * `oracle:diff:geometry`, `oracle:diff:coverage`.
 * Exits 0 only when all four exit 0. No hard-coded `exit 0`.
 */
import { runNodeScript } from "./t011-lib.mjs";

const scripts = [
  "oracle-diff-modes.mjs",
  "oracle-diff-events.mjs",
  "oracle-diff-geometry.mjs",
  "oracle-diff-coverage.mjs",
];

let failed = false;
for (const script of scripts) {
  const run = runNodeScript(script);
  if (run.stdout) process.stdout.write(run.stdout);
  if (run.stderr) process.stdout.write(run.stderr);
  if (run.status !== 0) {
    console.log(`test:oracle — ${script} FAILED (exit ${run.status})`);
    failed = true;
  } else {
    console.log(`test:oracle — ${script} PASS`);
  }
}
if (failed) {
  process.exitCode = 1;
} else {
  console.log("test:oracle: PASS — all Oracle diffs at 100% parity");
}
