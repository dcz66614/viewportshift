#!/usr/bin/env node
/**
 * T012 acceptance runner: `npm run test:perf`.
 *
 * Performance-suite aggregate entry point: runs the full
 * `test:performance` suite as a child process (real measurements,
 * real exit code — never a stub), then re-reads its evidence file
 * and asserts every frozen threshold passes. Exits 0 only when the
 * child suite passed AND the evidence file agrees.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./e2e-lib.mjs";

const EVIDENCE_PATH = path.join(ROOT, "evidence", "performance", "PERFORMANCE_TEST.json");

function main() {
  const run = spawnSync("node", ["scripts/test-performance.mjs"], { cwd: ROOT, stdio: "inherit" });
  if (run.status !== 0) {
    console.error(`test:perf: FAIL — test:performance exited ${run.status}`);
    process.exitCode = 1;
    return;
  }
  if (!fs.existsSync(EVIDENCE_PATH)) {
    console.error("test:perf: FAIL — PERFORMANCE_TEST.json was not written");
    process.exitCode = 1;
    return;
  }
  const evidence = JSON.parse(fs.readFileSync(EVIDENCE_PATH, "utf8"));
  const over = Object.keys(evidence.thresholds).filter(
    (k) => evidence.measured[k] > evidence.thresholds[k],
  );
  console.log("test:perf: measured vs frozen thresholds (ms)");
  for (const k of Object.keys(evidence.thresholds)) {
    const ok = evidence.measured[k] <= evidence.thresholds[k];
    console.log(`test:perf:   ${k}: measured ${evidence.measured[k]} / threshold ${evidence.thresholds[k]} — ${ok ? "PASS" : "FAIL"}`);
  }
  if (over.length > 0 || evidence.failed > 0) {
    console.error(`test:perf: FAIL — over threshold: ${over.join(", ") || "none"}; suite failures: ${evidence.failed}`);
    process.exitCode = 1;
    return;
  }
  console.log(`test:perf: PASS — performance aggregate green (${evidence.passed} checks, 0 failed)`);
}

main();
