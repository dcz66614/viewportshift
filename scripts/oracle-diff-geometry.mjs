#!/usr/bin/env node
/**
 * T007 acceptance runner: `npm run oracle:diff:geometry`.
 *
 * Runs the TypeScript formal occlusion/visibility geometry evaluator
 * and the independent Python Geometry Oracle over the same 34 geometry
 * fixtures and asserts 100% per-field parity:
 * - the Python Oracle exits 0 and writes a well-formed result file;
 * - both sides return the same number of results, in the same order,
 *   with the same case / scenario ids;
 * - every result document is field-by-field identical between TS and
 *   Python (direct: caseId, kind, scenarioSha256, seed, status,
 *   reason, rects, keyboardVisible, metrics, contractChecks;
 *   scenario: scenarioId, scenarioSha256, seed, mode, status, reason,
 *   validationIssues, failedEventId, failedStepIndex, initialState,
 *   finalState, steps incl. per-step states / rects / metrics /
 *   contractChecks / failedPredicates, panReports, finalMetrics,
 *   finalFailedPredicates) — any mismatch is a FAIL, there is no
 *   ignore list and no tolerance;
 * - the TS and Python analysis hashes are identical;
 * - parity holds per kind (13 direct, 21 scenario), per mode
 *   (5 resizes-visual, 3 resizes-content, 7 overlays-content OK)
 *   and over the 6 fail-closed scenarios.
 *
 * The Oracle never sees TypeScript output: it reads only the fixtures
 * and computes every expectation itself. Writes
 * evidence/geometry/GEOMETRY_DIFF.json (parity report + hashes).
 * Exits 0 only when every check passes.
 */
import path from "node:path";
import { diffPaths } from "./s0-lib.mjs";
import {
  GEOMETRY_VERSION,
  ROOT,
  SEED,
  evaluateTs,
  listGeometryFixtures,
  loadJson,
  loadT007Domain,
  runPythonGeometryOracle,
  writeJson,
} from "./t007-lib.mjs";

const PY_OUT_REL = "evidence/geometry/GEOMETRY_PY.json";
const DIFF_OUT_REL = "evidence/geometry/GEOMETRY_DIFF.json";

const failures = [];
const passes = [];

function check(name, ok, detail) {
  if (ok) passes.push(name);
  else failures.push(detail ? `${name} — ${detail}` : name);
  return ok;
}

async function main() {
  const { geometryEval } = await loadT007Domain();
  const files = listGeometryFixtures();
  check("exactly 34 geometry fixtures present", files.length === 34,
    `found ${files.length}`);
  const fixtures = files.map(loadJson);

  const { core: tsCore, analysisSha256: tsHash } = evaluateTs(geometryEval, fixtures);
  const tsResults = tsCore.results;
  check("TS evaluated 34 fixtures", tsResults.length === 34,
    `got ${tsResults.length}`);
  check("TS analysis hash is 64 hex chars",
    /^[0-9a-f]{64}$/.test(tsHash), `hash=${tsHash}`);

  const pyOutPath = path.join(ROOT, PY_OUT_REL);
  const run = runPythonGeometryOracle(files, pyOutPath, 1);
  console.log(run.stdout);
  if (run.stderr) console.log(run.stderr);
  check("python geometry oracle exits 0", run.code === 0,
    `exit=${run.code} stderr=${run.stderr}`);
  check("python geometry oracle output file exists and parses",
    run.output !== null, "no output JSON");
  if (run.output === null) return finish(null);
  const pyResults = run.output.results ?? [];
  check("python oracle returned 34 results", pyResults.length === 34,
    `got ${pyResults.length}`);
  check("python oracle seed matches frozen seed",
    run.output.seed === SEED, `seed=${run.output.seed}`);
  check("python oracle version is geometry/v1",
    run.output.version === GEOMETRY_VERSION, `version=${run.output.version}`);
  check("python oracle determinism: 1 run, 1 hash",
    run.output.determinism?.runs === 1 &&
      run.output.determinism?.uniqueHashes === 1,
    JSON.stringify(run.output.determinism));
  check("python oracle analysis hash is 64 hex chars",
    /^[0-9a-f]{64}$/.test(run.output.analysisSha256 ?? ""),
    `hash=${run.output.analysisSha256}`);

  let mismatches = [];
  let parityPassed = 0;
  const parityByKind = {};
  const parityByMode = {};
  const parityByModeOk = {};
  for (let i = 0; i < fixtures.length; i++) {
    const fixture = fixtures[i];
    const ts = tsResults[i];
    const py = pyResults[i];
    const label = fixture.case_id ?? fixture.scenario_id;
    const kindKey = fixture.kind === "direct" ? "direct" : "scenario";
    const modeKey = fixture.mode ?? "direct";
    check(`${label}: python result present`, py !== undefined,
      "missing from oracle output");
    if (!py) continue;
    const tsId = ts.caseId ?? ts.scenarioId;
    const pyId = py.caseId ?? py.scenarioId;
    check(`${label}: ids agree`,
      tsId === pyId,
      `ts=${tsId} py=${pyId}`);
    const diffs = diffPaths(ts, py, label);
    if (diffs.length === 0) {
      parityPassed += 1;
      parityByKind[kindKey] = (parityByKind[kindKey] ?? 0) + 1;
      parityByMode[modeKey] = (parityByMode[modeKey] ?? 0) + 1;
      // Per-mode OK counts: fail-closed fixtures also carry a mode
      // (e.g. overlays-content), so count OK fixtures separately.
      if (fixture.expected.status === "OK") {
        parityByModeOk[modeKey] = (parityByModeOk[modeKey] ?? 0) + 1;
      }
    } else {
      mismatches.push(...diffs);
      console.log(`${label}: MISMATCH (${diffs.length} fields)`);
      for (const d of diffs.slice(0, 10)) console.log(`  - ${d}`);
    }
    const m = ts.metrics ?? ts.finalMetrics;
    console.log(
      `${label}: ts=${ts.status} py=${py.status} ` +
        `reason=${ts.reason ?? "-"} parity=${diffs.length === 0}` +
        (m
          ? ` visible=${m.visibleArea} obscured=${m.keyboardObscuredArea} ` +
            `ratio=${m.visibleRatio} bottomGap=${m.bottomGap}`
          : ""),
    );
  }
  check("parity: 34/34 fixtures field-identical", parityPassed === 34,
    `parityPassed=${parityPassed}`);
  check("parity: 13 direct fixtures",
    parityByKind.direct === 13, `direct=${parityByKind.direct ?? 0}`);
  check("parity: 21 scenario fixtures",
    parityByKind.scenario === 21, `scenario=${parityByKind.scenario ?? 0}`);
  check("parity: 5 resizes-visual OK scenarios",
    parityByModeOk["resizes-visual"] === 5,
    `rv=${parityByModeOk["resizes-visual"] ?? 0}`);
  check("parity: 3 resizes-content OK scenarios",
    parityByModeOk["resizes-content"] === 3,
    `rc=${parityByModeOk["resizes-content"] ?? 0}`);
  check("parity: 7 overlays-content OK scenarios",
    parityByModeOk["overlays-content"] === 7,
    `oc=${parityByModeOk["overlays-content"] ?? 0}`);
  check("parity: 6 fail-closed scenarios",
    fixtures.filter((f) => f.kind !== "direct" && f.expected.status !== "OK").length === 6 &&
      mismatches.filter((m) =>
        /scen-1[0-5]/.test(m),
      ).length === 0,
    "fail-closed parity broken");
  check("TS and Python analysis hashes identical",
    tsHash === run.output.analysisSha256,
    `ts=${tsHash} py=${run.output.analysisSha256}`);

  const report = {
    analysisSha256: tsHash,
    pythonAnalysisSha256: run.output.analysisSha256,
    fixturesTotal: fixtures.length,
    parityPassed,
    parityFailed: fixtures.length - parityPassed,
    parityByKind,
    parityByMode,
    mismatches,
    seed: SEED,
    version: GEOMETRY_VERSION,
  };
  writeJson(path.join(ROOT, DIFF_OUT_REL), report);
  console.log(`\nwrote ${DIFF_OUT_REL}`);
  console.log(
    `parity: ${parityPassed}/${fixtures.length}, ` +
      `mismatches: ${mismatches.length}`,
  );
  console.log(`ts analysisSha256: ${tsHash}`);
  console.log(`py analysisSha256: ${run.output.analysisSha256}`);
  finish(report);
}

function finish(report) {
  console.log(
    `\nchecks passed: ${passes.length}, checks failed: ${failures.length}`,
  );
  if (failures.length > 0) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(`- ${f}`);
    console.log("\nGeometry oracle diff: FAIL");
    process.exitCode = 1;
  } else {
    console.log("\nGeometry oracle diff: PASS");
    process.exitCode = 0;
  }
}

main().catch((err) => {
  console.error(`runner error: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
