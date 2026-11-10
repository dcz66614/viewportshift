#!/usr/bin/env node
/**
 * T007 acceptance runner: `npm run test:geometry`.
 *
 * Runs the TypeScript formal occlusion/visibility geometry evaluator
 * over the 34 geometry fixtures (13 rect-level direct cases + 21
 * scenario cases) and asserts:
 * - exactly 34 fixtures are present (13 direct, 21 scenario:
 *   5 resizes-visual, 3 resizes-content, 7 overlays-content OK,
 *   6 fail-closed);
 * - every fixture carries the frozen seed;
 * - every direct case's status / reason / metrics / contract-check
 *   names equal their hand-authored expected block (11 OK, 2 INVALID
 *   — zero-area surfaces fail closed, never silently 0);
 * - every scenario's status / reason / failedEventId /
 *   failedStepIndex / validation-issue codes / panReports equal
 *   their hand-authored expected block (15 OK, 4 UNKNOWN, 2 INVALID);
 * - every scenario step's metrics / surface rect / expected-anchor
 *   rect / contract-check names / failed predicates equal their
 *   hand-authored expected block, and every step's contract check
 *   passed;
 * - every metric is re-derived independently in this runner
 *   (BigInt integer arithmetic: invariant sum, ratio floor, isqrt
 *   drift magnitude) and matches the domain;
 * - the triple-intersection helper returns the exact hand-computed
 *   overlap (including 0 for touching edges) and a non-integer
 *   direct input fails closed as INVALID;
 * - the evaluation is deterministic: two full runs hash identically;
 * - the domain sources and the Python Geometry Oracle contain no
 *   wall-clock / timer / randomness / float-comparison dependency.
 *
 * Writes evidence/geometry/GEOMETRY_TS.json (canonical core + hash).
 * Exits 0 only when every check passes.
 */
import fs from "node:fs";
import path from "node:path";
import {
  FORBIDDEN_TOKENS,
  GEOMETRY_VERSION,
  ROOT,
  SEED,
  deepEqual,
  evaluateTs,
  listGeometryFixtures,
  loadJson,
  loadT007Domain,
  writeJson,
} from "./t007-lib.mjs";

const OUT_REL = "evidence/geometry/GEOMETRY_TS.json";
const CHECK_NAMES = [
  "invariant_sum",
  "obscured_definition",
  "visible_ratio_range",
  "visible_ratio_floor",
  "obscured_within_visible",
  "obscured_within_keyboard",
  "clipped_within_surface",
  "areas_nonnegative",
  "bottom_gap_definition",
  "drift_vector",
  "drift_magnitude",
];

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

/** Independent re-derivation of one metric set from its rects. */
function rederiveMetrics(surface, visual, keyboard, keyboardVisible, expectedAnchor) {
  const area = (r) => r.width * r.height;
  const inter = (a, b) => {
    const left = Math.max(a.x, b.x);
    const top = Math.max(a.y, b.y);
    const right = Math.min(a.x + a.width, b.x + b.width);
    const bottom = Math.min(a.y + a.height, b.y + b.height);
    if (right <= left || bottom <= top) return 0;
    return (right - left) * (bottom - top);
  };
  const surfaceArea = area(surface);
  const visibleIntersection = inter(surface, visual);
  let obscured = 0;
  if (keyboardVisible) {
    const vk = {
      x: Math.max(visual.x, keyboard.x),
      y: Math.max(visual.y, keyboard.y),
      width:
        Math.min(visual.x + visual.width, keyboard.x + keyboard.width) -
        Math.max(visual.x, keyboard.x),
      height:
        Math.min(visual.y + visual.height, keyboard.y + keyboard.height) -
        Math.max(visual.y, keyboard.y),
    };
    obscured = vk.width > 0 && vk.height > 0 ? inter(surface, vk) : 0;
  }
  const visibleArea = visibleIntersection - obscured;
  const dx = surface.x - expectedAnchor.x;
  const dy = surface.y - expectedAnchor.y;
  return {
    surfaceArea,
    keyboardObscuredArea: obscured,
    viewportClippedArea: surfaceArea - visibleIntersection,
    visibleArea,
    visibleRatio: Number(
      (BigInt(visibleArea) * 1000n) / BigInt(surfaceArea),
    ),
    bottomGap:
      visual.y + visual.height - (surface.y + surface.height),
    anchorDrift: {
      dx,
      dy,
      magnitude: Number(bigIsqrt(dx * dx + dy * dy)),
    },
  };
}

async function main() {
  const { geometryEval, geometry, sources } = await loadT007Domain();
  for (const [relPath, source] of Object.entries(sources)) {
    for (const token of FORBIDDEN_TOKENS) {
      check(
        `no forbidden token in ${relPath} (${token})`,
        !source.includes(token),
        `${relPath} contains forbidden token ${token}`,
      );
    }
  }
  const oracleSource = fs.readFileSync(
    path.join(ROOT, "oracle/python/geometry_full_oracle.py"),
    "utf8",
  );
  for (const token of ["time.time", "random.", "datetime.now", "uuid"]) {
    check(
      `no forbidden token in oracle/python/geometry_full_oracle.py (${token})`,
      !oracleSource.includes(token),
      `geometry_full_oracle.py contains forbidden token ${token}`,
    );
  }
  check(
    "geometry-eval module exports evaluate entry points",
    typeof geometryEval.evaluateGeometry === "function" &&
      typeof geometryEval.evaluateScenarioGeometry === "function" &&
      typeof geometryEval.evaluateDirectGeometry === "function" &&
      typeof geometryEval.canonicalGeometryJson === "function",
    "missing export",
  );
  check(
    "geometry module exports direct geometry entry points",
    typeof geometry.computeGeometryDirect === "function" &&
      typeof geometry.geometryContractChecksFor === "function" &&
      typeof geometry.tripleIntersectionArea === "function" &&
      typeof geometry.isqrt === "function",
    "missing export",
  );
  check(
    "geometry version is geometry/v1",
    geometryEval.GEOMETRY_VERSION === GEOMETRY_VERSION,
    `GEOMETRY_VERSION=${geometryEval.GEOMETRY_VERSION}`,
  );
  check(
    "geometry contract check names are the frozen 11, in order",
    deepEqual(geometry.GEOMETRY_CONTRACT_CHECK_NAMES, CHECK_NAMES),
    JSON.stringify(geometry.GEOMETRY_CONTRACT_CHECK_NAMES),
  );

  // Inline unit assertions on the pure helpers (no fixture involved).
  check(
    "tripleIntersectionArea: partial overlap is exact",
    geometry.tripleIntersectionArea(
      { x: 0, y: 500000, width: 390000, height: 344000 },
      { x: 0, y: 100000, width: 390000, height: 600000 },
      { x: 0, y: 544000, width: 390000, height: 300000 },
    ) === 60840000000,
    "triple overlap mismatch",
  );
  check(
    "tripleIntersectionArea: touching edges are 0",
    geometry.tripleIntersectionArea(
      { x: 0, y: 488000, width: 390000, height: 56000 },
      { x: 0, y: 0, width: 390000, height: 844000 },
      { x: 0, y: 544000, width: 390000, height: 300000 },
    ) === 0,
    "touching edges must be 0",
  );
  check(
    "tripleIntersectionArea: disjoint rects are 0",
    geometry.tripleIntersectionArea(
      { x: 0, y: 0, width: 1000, height: 1000 },
      { x: 5000, y: 5000, width: 1000, height: 1000 },
      { x: 0, y: 0, width: 10000, height: 10000 },
    ) === 0,
    "disjoint must be 0",
  );
  const nonInteger = geometry.computeGeometryDirect({
    surface: { x: 0, y: 0, width: 1500.5, height: 1000 },
    visual: { x: 0, y: 0, width: 390000, height: 844000 },
    keyboard: { x: 0, y: 844000, width: 390000, height: 0 },
    keyboardVisible: false,
    expectedAnchor: { x: 0, y: 0, width: 1500.5, height: 1000 },
  });
  check(
    "computeGeometryDirect: non-integer input is INVALID",
    nonInteger.status === "INVALID" &&
      nonInteger.reason === "non_integer_geometry" &&
      nonInteger.metrics === null,
    JSON.stringify(nonInteger),
  );

  const files = listGeometryFixtures();
  check("exactly 34 geometry fixtures present", files.length === 34,
    `found ${files.length}`);
  const fixtures = files.map(loadJson);
  const direct = fixtures.filter((f) => f.kind === "direct");
  const scenarios = fixtures.filter((f) => f.kind !== "direct");
  check("exactly 13 direct fixtures present", direct.length === 13,
    `found ${direct.length}`);
  check("exactly 21 scenario fixtures present", scenarios.length === 21,
    `found ${scenarios.length}`);
  const byMode = {};
  const okByMode = {};
  for (const f of fixtures) {
    const key = f.kind === "direct" ? "direct" : (f.mode ?? "<missing>");
    byMode[key] = (byMode[key] ?? 0) + 1;
    if (f.expected.status === "OK") {
      okByMode[key] = (okByMode[key] ?? 0) + 1;
    }
    check(
      `${f.case_id ?? f.scenario_id}: frozen seed`,
      f.seed === SEED,
      `seed=${f.seed}`,
    );
  }
  check("5 resizes-visual OK scenarios", okByMode["resizes-visual"] === 5,
    `found ${okByMode["resizes-visual"] ?? 0}`);
  check("3 resizes-content OK scenarios", okByMode["resizes-content"] === 3,
    `found ${okByMode["resizes-content"] ?? 0}`);
  check("7 overlays-content OK scenarios", okByMode["overlays-content"] === 7,
    `found ${okByMode["overlays-content"] ?? 0}`);
  check("6 fail-closed scenarios",
    scenarios.filter((f) => f.expected.status !== "OK").length === 6,
    `found ${scenarios.filter((f) => f.expected.status !== "OK").length}`);

  const { core, analysisSha256 } = evaluateTs(geometryEval, fixtures);
  const results = core.results;
  const { analysisSha256: hash2 } = evaluateTs(geometryEval, fixtures);
  check(
    "determinism: two full TS runs hash identically",
    hash2 === analysisSha256,
    `run1=${analysisSha256} run2=${hash2}`,
  );
  check(
    "canonical output contains no absolute workspace path",
    !geometryEval.canonicalGeometryJson(core).includes(ROOT),
    "absolute path leaked into canonical result",
  );

  let okCount = 0;
  let unknownCount = 0;
  let invalidCount = 0;
  let stepCount = 0;
  let checkCount = 0;
  for (let i = 0; i < fixtures.length; i++) {
    const fixture = fixtures[i];
    const result = results[i];
    const exp = fixture.expected;
    const label = result.caseId ?? result.scenarioId;
    if (result.status === "OK") okCount += 1;
    else if (result.status === "UNKNOWN") unknownCount += 1;
    else if (result.status === "INVALID") invalidCount += 1;

    check(`${label}: status matches hand-authored expected`,
      result.status === exp.status,
      `status=${result.status} expected=${exp.status} reason=${result.reason}`);
    check(`${label}: reason matches hand-authored expected`,
      result.reason === exp.reason,
      `reason=${result.reason} expected=${exp.reason}`);

    if (fixture.kind === "direct") {
      check(`${label}: seed echoed`,
        result.seed === fixture.seed, `seed=${result.seed}`);
      check(`${label}: metrics match hand-authored expected`,
        deepEqual(result.metrics, exp.metrics),
        `metrics=${JSON.stringify(result.metrics)} expected=${JSON.stringify(exp.metrics)}`);
      const names = result.contractChecks.map((c) => c.name);
      check(`${label}: contract-check names match frozen list`,
        deepEqual(names, exp.contractChecks),
        `checks=${JSON.stringify(names)} expected=${JSON.stringify(exp.contractChecks)}`);
      const failed = result.contractChecks.filter((c) => !c.passed);
      check(`${label}: every contract check passed`,
        failed.length === 0,
        `failed=${JSON.stringify(failed)}`);
      checkCount += result.contractChecks.length;
      if (result.metrics !== null) {
        const rederived = rederiveMetrics(
          fixture.surface,
          fixture.visual,
          fixture.keyboard,
          fixture.keyboardVisible,
          fixture.expectedAnchor,
        );
        check(`${label}: metrics re-derived independently match`,
          deepEqual(result.metrics, rederived),
          `metrics=${JSON.stringify(result.metrics)} rederived=${JSON.stringify(rederived)}`);
      }
      console.log(
        `${label}: status=${result.status} ` +
          (result.metrics
            ? `visible=${result.metrics.visibleArea} obscured=${result.metrics.keyboardObscuredArea} ` +
              `clipped=${result.metrics.viewportClippedArea} ratio=${result.metrics.visibleRatio} ` +
              `bottomGap=${result.metrics.bottomGap} drift=${result.metrics.anchorDrift.magnitude}`
            : `reason=${result.reason}`),
      );
      continue;
    }

    // Scenario fixture.
    check(`${label}: seed echoed`,
      result.seed === fixture.seed, `seed=${result.seed}`);
    check(`${label}: mode echoed`,
      result.mode === fixture.mode,
      `mode=${result.mode} fixture=${fixture.mode}`);
    check(`${label}: failedEventId matches expected`,
      result.failedEventId === exp.failedEventId,
      `failedEventId=${result.failedEventId} expected=${exp.failedEventId}`);
    check(`${label}: failedStepIndex matches expected`,
      result.failedStepIndex === exp.failedStepIndex,
      `failedStepIndex=${result.failedStepIndex} expected=${exp.failedStepIndex}`);
    check(`${label}: validation issue codes match expected`,
      deepEqual(
        result.validationIssues.map((v) => v.code),
        exp.validationIssueCodes,
      ),
      `codes=${JSON.stringify(result.validationIssues.map((v) => v.code))} expected=${JSON.stringify(exp.validationIssueCodes)}`);
    check(`${label}: finalMetrics match hand-authored expected`,
      deepEqual(result.finalMetrics, exp.finalMetrics),
      `finalMetrics=${JSON.stringify(result.finalMetrics)} expected=${JSON.stringify(exp.finalMetrics)}`);
    check(`${label}: panReports match hand-authored expected`,
      deepEqual(result.panReports, exp.panReports),
      `panReports=${JSON.stringify(result.panReports)} expected=${JSON.stringify(exp.panReports)}`);
    check(`${label}: steps cover the expected steps`,
      result.steps.length === exp.steps.length,
      `steps=${result.steps.length} expected=${exp.steps.length}`);
    for (let s = 0; s < Math.min(result.steps.length, exp.steps.length); s++) {
      const step = result.steps[s];
      const expStep = exp.steps[s];
      stepCount += 1;
      check(`${label} step ${s}: status OK`,
        step.status === "OK", `status=${step.status} reason=${step.reason}`);
      check(`${label} step ${s}: metrics match expected`,
        deepEqual(step.metrics, expStep.metrics),
        `metrics=${JSON.stringify(step.metrics)} expected=${JSON.stringify(expStep.metrics)}`);
      check(`${label} step ${s}: surfaceRect matches expected`,
        deepEqual(step.surfaceRect, expStep.surfaceRect),
        `surfaceRect=${JSON.stringify(step.surfaceRect)} expected=${JSON.stringify(expStep.surfaceRect)}`);
      check(`${label} step ${s}: expectedAnchorRect matches expected`,
        deepEqual(step.expectedAnchorRect, expStep.expectedAnchorRect),
        `expectedAnchorRect=${JSON.stringify(step.expectedAnchorRect)} expected=${JSON.stringify(expStep.expectedAnchorRect)}`);
      const names = step.contractChecks.map((c) => c.name);
      check(`${label} step ${s}: contract-check names match frozen list`,
        deepEqual(names, expStep.contractChecks),
        `checks=${JSON.stringify(names)} expected=${JSON.stringify(expStep.contractChecks)}`);
      const failed = step.contractChecks.filter((c) => !c.passed);
      check(`${label} step ${s}: every contract check passed`,
        failed.length === 0,
        `failed=${JSON.stringify(failed)}`);
      checkCount += step.contractChecks.length;
      check(`${label} step ${s}: failedPredicates match expected`,
        deepEqual(step.failedPredicates, expStep.failedPredicates),
        `failedPredicates=${JSON.stringify(step.failedPredicates)} expected=${JSON.stringify(expStep.failedPredicates)}`);
      if (step.metrics !== null) {
        const rederived = rederiveMetrics(
          step.surfaceRect,
          {
            x: step.state.visualOffsetLeft,
            y: step.state.visualOffsetTop,
            width: step.state.visualWidth,
            height: step.state.visualHeight,
          },
          step.state.keyboardRect,
          step.state.keyboardVisible,
          step.expectedAnchorRect,
        );
        check(`${label} step ${s}: metrics re-derived independently match`,
          deepEqual(step.metrics, rederived),
          `metrics=${JSON.stringify(step.metrics)} rederived=${JSON.stringify(rederived)}`);
      }
    }
    if (exp.status !== "OK") {
      check(`${label}: initialState null on ${exp.status}`,
        result.initialState === null, "initialState must be null");
      check(`${label}: finalState null on ${exp.status}`,
        result.finalState === null, "finalState must be null");
      check(`${label}: no steps on ${exp.status}`,
        result.steps.length === 0, `steps=${result.steps.length}`);
      check(`${label}: validationIssues non-empty`,
        result.validationIssues.length > 0, "no validation issues recorded");
      check(`${label}: first validation issue code is the reason`,
        result.validationIssues[0].code === result.reason,
        `first=${result.validationIssues[0]?.code} reason=${result.reason}`);
    }
    console.log(
      `${label}: status=${result.status} expected=${exp.status} ` +
        `reason=${result.reason ?? "-"} steps=${result.steps.length} ` +
        (result.finalMetrics
          ? `visible=${result.finalMetrics.visibleArea} obscured=${result.finalMetrics.keyboardObscuredArea} ` +
            `clipped=${result.finalMetrics.viewportClippedArea} ratio=${result.finalMetrics.visibleRatio} ` +
            `bottomGap=${result.finalMetrics.bottomGap} drift=${result.finalMetrics.anchorDrift.magnitude}`
          : "finalMetrics=null"),
    );
  }
  check("26 OK evaluations (11 direct + 15 scenario)", okCount === 26,
    `ok=${okCount}`);
  check("4 UNKNOWN evaluations", unknownCount === 4, `unknown=${unknownCount}`);
  check("4 INVALID evaluations (2 direct + 2 scenario)", invalidCount === 4,
    `invalid=${invalidCount}`);

  const out = {
    analysisSha256,
    determinism: { runs: 2, uniqueHashes: 1, hashes: [analysisSha256] },
    results,
    seed: SEED,
    version: GEOMETRY_VERSION,
  };
  writeJson(path.join(ROOT, OUT_REL), out);
  console.log(
    `\nfixtures: ${fixtures.length} (direct=${direct.length}, scenario=${scenarios.length}), ` +
      `steps checked: ${stepCount}, contract checks: ${checkCount}, ` +
      `OK=${okCount} UNKNOWN=${unknownCount} INVALID=${invalidCount}`,
  );
  console.log(`analysisSha256: ${analysisSha256}`);
  console.log(`wrote ${OUT_REL}`);
  console.log(
    `\nchecks passed: ${passes.length}, checks failed: ${failures.length}`,
  );
  if (failures.length > 0) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(`- ${f}`);
    console.log("\nGeometry (TS): FAIL");
    process.exitCode = 1;
  } else {
    console.log("\nGeometry (TS): PASS");
    process.exitCode = 0;
  }
}

main().catch((err) => {
  console.error(`runner error: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
