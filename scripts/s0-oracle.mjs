#!/usr/bin/env node
/**
 * T003 acceptance runner: `npm run s0:oracle`.
 *
 * Runs the independent Python Geometry Oracle over the 48 S0 scenarios
 * plus 5 fail-closed edge cases (python3 only — bare `python` does not
 * exist on this VM) and asserts:
 * - the Oracle exits 0 and writes a well-formed result file;
 * - every scenario status equals its hand-authored expected_status
 *   (12 planted FAIL detected, 36 normal PASS, 0 false positives);
 * - every edge case fails closed with its expected INVALID/UNKNOWN.
 *
 * The Oracle never sees TypeScript output: it reads only the fixtures
 * and computes every expectation itself. Writes
 * evidence/s0/S0_GEOMETRY_PY.json. Exits 0 only when every check passes.
 */
import path from "node:path";
import {
  ROOT,
  listFixtures,
  loadFixture,
  runPythonOracle,
} from "./s0-lib.mjs";

const OUT_REL = "evidence/s0/S0_GEOMETRY_PY.json";

const failures = [];
const passes = [];

function check(name, ok, detail) {
  if (ok) passes.push(name);
  else failures.push(detail ? `${name} — ${detail}` : name);
  return ok;
}

function main() {
  const { main, edge } = listFixtures();
  check("exactly 48 main S0 fixtures present", main.length === 48,
    `found ${main.length}`);
  check("exactly 5 edge fixtures present", edge.length === 5,
    `found ${edge.length}`);
  const allFiles = [...main, ...edge];
  const outPath = path.join(ROOT, OUT_REL);
  const run = runPythonOracle(allFiles, outPath, 1);
  console.log(run.stdout);
  if (run.stderr) console.log(run.stderr);
  check("python oracle exits 0", run.code === 0,
    `exit=${run.code} stderr=${run.stderr}`);
  check("python oracle output file exists and parses", run.output !== null,
    "no output JSON");
  if (run.output === null) return finish();
  const results = run.output.results ?? [];
  check("oracle returned 53 scenario results", results.length === 53,
    `got ${results.length}`);
  check("oracle seed matches frozen seed",
    run.output.seed === "P021-VIEWPORTSHIFT-S0-2026-11-10",
    `seed=${run.output.seed}`);
  check("oracle analysis hash present",
    typeof run.output.analysisSha256 === "string" &&
      run.output.analysisSha256.length === 64,
    `analysisSha256=${run.output.analysisSha256}`);
  check("oracle determinism: 1 run, 1 hash",
    run.output.determinism?.runs === 1 &&
      run.output.determinism?.uniqueHashes === 1,
    JSON.stringify(run.output.determinism));

  const fixtures = allFiles.map(loadFixture);
  const byId = new Map(results.map((r) => [r.scenarioId, r]));
  let plantedTotal = 0;
  let plantedDetected = 0;
  let falsePositives = 0;
  for (let i = 0; i < fixtures.length; i++) {
    const fixture = fixtures[i];
    const isMain = i < main.length;
    const result = byId.get(fixture.scenario_id);
    check(`${fixture.scenario_id}: oracle result present`, result !== undefined,
      "missing from oracle output");
    if (!result) continue;
    check(
      `${fixture.scenario_id}: oracle status matches hand-authored expected_status`,
      result.status === fixture.expected_status,
      `status=${result.status} expected=${fixture.expected_status}`,
    );
    if (fixture.planted_error !== null) {
      plantedTotal += 1;
      if (result.status === "FAIL" && result.failedPredicates.length > 0) {
        plantedDetected += 1;
      }
    } else if (isMain && result.status !== "PASS") {
      // False positives are counted over the 48 main scenarios only:
      // edge fixtures are *expected* to be UNKNOWN/INVALID.
      falsePositives += 1;
    }
    const fm = result.finalMetrics;
    console.log(
      `${result.scenarioId}: status=${result.status} expected=${fixture.expected_status} ` +
        (fm
          ? `visibleRatio=${fm.visibleRatio} obscured=${fm.keyboardObscuredArea} ` +
            `clipped=${fm.viewportClippedArea} bottomGap=${fm.bottomGap} ` +
            `drift=${fm.anchorDrift.magnitude}`
          : `reason=${result.reason}`),
    );
  }
  check("planted errors: 12 total", plantedTotal === 12, `total=${plantedTotal}`);
  check("planted errors: 12/12 detected by oracle", plantedDetected === 12,
    `detected=${plantedDetected}`);
  check("normal scenarios: 0 false positives (oracle)", falsePositives === 0,
    `falsePositives=${falsePositives}`);
  console.log(`\nwrote ${OUT_REL}`);
  finish();
}

function finish() {
  console.log(
    `\nchecks passed: ${passes.length}, checks failed: ${failures.length}`,
  );
  if (failures.length > 0) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(`- ${f}`);
    console.log("\nS0 oracle (Python): FAIL");
    process.exitCode = 1;
  } else {
    console.log("\nS0 oracle (Python): PASS");
    process.exitCode = 0;
  }
}

main();
