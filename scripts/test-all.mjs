#!/usr/bin/env node
/**
 * T011 aggregate runner: `npm test`.
 *
 * Runs the full test suite: every existing `test:*` script plus
 * every test script added by T011. Any failure fails the whole run.
 * The list is explicit (no globbing, no hard-coded `exit 0`):
 *
 * Existing: test:schema, test:validation, test:modes, test:events,
 * test:event-order, test:geometry, test:bfs, test:bfs:determinism,
 * test:ui, test:export.
 * T011: test:golden, test:property (fixed seed), test:oracle,
 * test:mutation, test:coverage (which itself re-runs golden /
 * property / oracle / mutation as the coverage aggregate).
 */
import { SEED, runNodeScript } from "./t011-lib.mjs";

const steps = [
  { name: "test:schema", script: "test-schema.mjs", args: [] },
  { name: "test:validation", script: "test-validation.mjs", args: [] },
  { name: "test:modes", script: "test-modes.mjs", args: [] },
  { name: "test:events", script: "test-events.mjs", args: [] },
  { name: "test:event-order", script: "test-event-order.mjs", args: [] },
  { name: "test:geometry", script: "test-geometry.mjs", args: [] },
  { name: "test:bfs", script: "test-bfs.mjs", args: [] },
  { name: "test:bfs:determinism", script: "test-bfs-determinism.mjs", args: [] },
  { name: "test:ui", script: "test-ui.mjs", args: [] },
  { name: "test:export", script: "test-export.mjs", args: [] },
  { name: "test:golden", script: "test-golden.mjs", args: [] },
  { name: "test:property", script: "test-property.mjs", args: ["--seed", SEED] },
  { name: "test:oracle", script: "test-oracle.mjs", args: [] },
  { name: "test:mutation", script: "test-mutation.mjs", args: [] },
  { name: "test:coverage", script: "test-coverage.mjs", args: [] },
];

let failed = false;
for (const step of steps) {
  const run = runNodeScript(step.script, step.args);
  if (run.stdout) process.stdout.write(run.stdout);
  if (run.stderr) process.stdout.write(run.stderr);
  if (run.status !== 0) {
    console.log(`npm test — ${step.name} FAILED (exit ${run.status})`);
    failed = true;
  } else {
    console.log(`npm test — ${step.name} PASS`);
  }
}
if (failed) {
  process.exitCode = 1;
} else {
  console.log("npm test: PASS — full suite green");
}
