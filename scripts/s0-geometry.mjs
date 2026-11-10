#!/usr/bin/env node
/**
 * T003 acceptance runner: `npm run s0:geometry`.
 *
 * Runs the TypeScript rectangle-geometry analysis over the 48 S0
 * scenarios plus 5 fail-closed edge cases, and asserts:
 * - exactly 48 main fixtures + 5 edge fixtures are present;
 * - every scenario status equals its hand-authored expected_status
 *   (12 planted FAIL detected, 36 normal PASS, 0 false positives);
 * - every edge case fails closed with its expected INVALID/UNKNOWN;
 * - the per-step geometry invariant holds
 *   (visible + clipped + obscured == surfaceArea);
 * - visibleRatio and anchorDrift.magnitude recomputed independently
 *   (BigInt integer arithmetic in this runner) match the domain;
 * - the domain sources contain no wall-clock / timer / randomness /
 *   float-comparison dependency.
 *
 * Writes evidence/s0/S0_GEOMETRY_TS.json (canonical core + hash).
 * Exits 0 only when every check passes.
 */
import fs from "node:fs";
import path from "node:path";
import {
  ANALYSIS_VERSION,
  FORBIDDEN_TOKENS,
  ROOT,
  SEED,
  analyzeTs,
  listFixtures,
  loadDomain,
  loadFixture,
  writeJson,
} from "./s0-lib.mjs";

const OUT_REL = "evidence/s0/S0_GEOMETRY_TS.json";

const failures = [];
const passes = [];

function check(name, ok, detail) {
  if (ok) passes.push(name);
  else failures.push(detail ? `${name} — ${detail}` : name);
  return ok;
}

function bigIsqrt(n) {
  let x = BigInt(n);
  if (x < 2n) return x;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + BigInt(n) / x) / 2n;
  }
  return x;
}

async function main() {
  const { geometry, sources } = await loadDomain();
  for (const [relPath, source] of Object.entries(sources)) {
    for (const token of FORBIDDEN_TOKENS) {
      check(
        `no forbidden token in ${relPath} (${token})`,
        !source.includes(token),
        `${relPath} contains forbidden token ${token}`,
      );
    }
  }
  check(
    "geometry module exports analyse entry points",
    typeof geometry.analyzeScenario === "function" &&
      typeof geometry.canonicalJson === "function" &&
      typeof geometry.isqrt === "function",
    "missing export",
  );

  const { main, edge } = listFixtures();
  check("exactly 48 main S0 fixtures present", main.length === 48,
    `found ${main.length}`);
  check("exactly 5 edge fixtures present", edge.length === 5,
    `found ${edge.length}: ${edge.map((f) => path.basename(f)).join(", ")}`);
  const poc = fs
    .readdirSync(path.join(ROOT, "tests/fixtures/s0"))
    .filter((f) => f.startsWith("state-machine-poc-"));
  check("T002 PoC fixtures untouched (still 8)", poc.length === 8,
    `found ${poc.length}`);

  const mainFixtures = main.map(loadFixture);
  const edgeFixtures = edge.map(loadFixture);
  const allFixtures = [...mainFixtures, ...edgeFixtures];
  const { core, analysisSha256 } = analyzeTs(geometry, allFixtures);
  const results = core.results;

  // Independent recomputation of ratio / drift / invariant per step.
  let stepCount = 0;
  for (const result of results) {
    for (const step of result.steps) {
      stepCount += 1;
      if (step.metrics === null) continue;
      const m = step.metrics;
      check(
        `${result.scenarioId} step ${step.eventId}: invariant visible+clipped+obscured=surface`,
        m.visibleArea + m.viewportClippedArea + m.keyboardObscuredArea === m.surfaceArea,
        `visible=${m.visibleArea} clipped=${m.viewportClippedArea} obscured=${m.keyboardObscuredArea} surface=${m.surfaceArea}`,
      );
      const ratio = Number((BigInt(m.visibleArea) * 1000n) / BigInt(m.surfaceArea));
      check(
        `${result.scenarioId} step ${step.eventId}: visibleRatio exact`,
        m.visibleRatio === ratio,
        `visibleRatio=${m.visibleRatio} recomputed=${ratio}`,
      );
      const mag = Number(
        bigIsqrt(
          BigInt(m.anchorDrift.dx) * BigInt(m.anchorDrift.dx) +
            BigInt(m.anchorDrift.dy) * BigInt(m.anchorDrift.dy),
        ),
      );
      check(
        `${result.scenarioId} step ${step.eventId}: anchorDrift.magnitude exact isqrt`,
        m.anchorDrift.magnitude === mag,
        `magnitude=${m.anchorDrift.magnitude} recomputed=${mag}`,
      );
      const visualBottom = step.state.visualOffsetTop + step.state.visualHeight;
      const surfaceBottom = step.surfaceRect.y + step.surfaceRect.height;
      check(
        `${result.scenarioId} step ${step.eventId}: bottomGap exact`,
        m.bottomGap === visualBottom - surfaceBottom,
        `bottomGap=${m.bottomGap} recomputed=${visualBottom - surfaceBottom}`,
      );
    }
  }

  let plantedTotal = 0;
  let plantedDetected = 0;
  let falsePositives = 0;
  for (let i = 0; i < mainFixtures.length; i++) {
    const fixture = mainFixtures[i];
    const result = results[i];
    const label = result.scenarioId;
    check(
      `${label}: status matches hand-authored expected_status`,
      result.status === fixture.expected_status,
      `status=${result.status} expected=${fixture.expected_status} ` +
        `finalMetrics=${JSON.stringify(result.finalMetrics)}`,
    );
    if (fixture.planted_error !== null) {
      plantedTotal += 1;
      const detected =
        result.status === "FAIL" && result.failedPredicates.length > 0;
      if (detected) plantedDetected += 1;
      check(
        `${label}: planted error detected (${fixture.planted_error.kind})`,
        detected,
        `status=${result.status} failedPredicates=${JSON.stringify(result.failedPredicates)}`,
      );
    } else if (result.status !== "PASS") {
      falsePositives += 1;
      check(`${label}: normal scenario must PASS (no false positive)`, false,
        `status=${result.status}`);
    }
    const fm = result.finalMetrics;
    console.log(
      `${label}: status=${result.status} expected=${fixture.expected_status} ` +
        `planted=${fixture.planted_error ? fixture.planted_error.kind : "-"} ` +
        `failedPredicates=${JSON.stringify(result.failedPredicates)} ` +
        (fm
          ? `visibleRatio=${fm.visibleRatio} obscured=${fm.keyboardObscuredArea} ` +
            `clipped=${fm.viewportClippedArea} bottomGap=${fm.bottomGap} ` +
            `drift=${fm.anchorDrift.magnitude}`
          : "metrics=null"),
    );
  }
  for (let i = 0; i < edgeFixtures.length; i++) {
    const fixture = edgeFixtures[i];
    const result = results[mainFixtures.length + i];
    check(
      `${result.scenarioId}: edge case fails closed as expected`,
      result.status === fixture.expected_status,
      `status=${result.status} expected=${fixture.expected_status} reason=${result.reason}`,
    );
    console.log(
      `${result.scenarioId}: status=${result.status} expected=${fixture.expected_status} ` +
        `reason=${result.reason} failedEventId=${result.failedEventId}`,
    );
  }
  check("planted errors: 12 total", plantedTotal === 12, `total=${plantedTotal}`);
  check("planted errors: 12/12 detected", plantedDetected === 12, `detected=${plantedDetected}`);
  check("normal scenarios: 0 false positives", falsePositives === 0, `falsePositives=${falsePositives}`);
  check(
    "canonical output contains no absolute workspace path",
    !geometry.canonicalJson(core).includes(ROOT),
    "absolute path leaked into canonical result",
  );

  const out = {
    analysisSha256,
    determinism: { runs: 1, uniqueHashes: 1, hashes: [analysisSha256] },
    results,
    seed: SEED,
    version: ANALYSIS_VERSION,
  };
  writeJson(path.join(ROOT, OUT_REL), out);
  console.log(
    `\nscenarios: ${mainFixtures.length}, edge cases: ${edgeFixtures.length}, ` +
      `steps checked: ${stepCount}, planted: ${plantedDetected}/${plantedTotal}, ` +
      `false positives: ${falsePositives}`,
  );
  console.log(`analysisSha256: ${analysisSha256}`);
  console.log(`wrote ${OUT_REL}`);
  console.log(
    `\nchecks passed: ${passes.length}, checks failed: ${failures.length}`,
  );
  if (failures.length > 0) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(`- ${f}`);
    console.log("\nS0 geometry (TS): FAIL");
    process.exitCode = 1;
  } else {
    console.log("\nS0 geometry (TS): PASS");
    process.exitCode = 0;
  }
}

main().catch((err) => {
  console.error(`runner error: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
