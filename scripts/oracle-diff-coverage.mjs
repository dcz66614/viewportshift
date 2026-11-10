#!/usr/bin/env node
/**
 * T011 acceptance runner: `npm run oracle:diff:coverage`.
 *
 * Coverage-set Oracle parity: the aggregated TS/Python per-field
 *对照 over the expanded coverage set.
 *
 * 1. Runs the three existing Oracle diff runners as subprocesses
 *    (`oracle:diff:modes` 41 fixtures, `oracle:diff:events` 27,
 *    `oracle:diff:geometry` 34) and requires each to exit 0; their
 *    parity counts are read back from their evidence DIFF files.
 * 2. BFS coverage diff (new in T011, P2-1): the independent Python
 *    BFS Oracle (`oracle/python/bfs_oracle.py` — its own search
 *    implementation, never importing or calling TS) is run over the
 *    39-fixture BFS coverage set (11 T008 BFS fixtures + 4 T011
 *    initial-state / prefix-branch fixtures + 24 Golden fixtures)
 *    and compared field-by-field with the TypeScript `searchBfs`
 *    results, including witness steps, node counts, limits and the
 *    fail-closed `limitsFallbackReason` (T011 P2-2).
 * 3. Golden geometry diff: the Python Geometry Oracle is run over
 *    the 24 Golden fixtures and compared field-by-field with the
 *    TypeScript geometry evaluation.
 *
 * Writes evidence/coverage/ORACLE_PARITY_REPORT.json — the report
 * the T011 task card requires — with per-set parity, total parity
 * (must be 100%), the analysis hashes, and the layering note
 * (T007 P2-1 / T011 P2-6): the Python Geometry Oracle reuses the
 * same-side Python Modes Oracle as its replay/validation layer,
 * exactly as the TS geometry evaluator reuses the same-side
 * `modes.ts`; there is zero sharing and zero calling between the
 * TS side and the Python side, so the parity remains a genuine
 * cross-check.
 *
 * Exits 0 only when every set is at 100% parity (zero mismatches).
 */
import fs from "node:fs";
import path from "node:path";
import {
  BFS_VERSION,
  ROOT,
  SEED,
  deepEqual,
  diffPaths,
  listAllBfsFixtures,
  listGoldenFixtures,
  loadJson,
  loadT011Domain,
  runNodeScript,
  runPythonBfsOracle,
  runPythonGeometryOracle,
  sha256Hex,
  writeJson,
} from "./t011-lib.mjs";

const OUT_REL = "evidence/coverage/ORACLE_PARITY_REPORT.json";
const PY_BFS_OUT_REL = "evidence/coverage/BFS_PY.json";
const PY_GOLDEN_OUT_REL = "evidence/coverage/GOLDEN_PY.json";

const failures = [];
const passes = [];

function check(name, ok, detail) {
  if (ok) passes.push(name);
  else failures.push(detail ? `${name} — ${detail}` : name);
  return ok;
}

async function main() {
  const { geometryEval, bfs } = await loadT011Domain();
  const sets = {};

  // ---- 1. Existing diffs (subprocess, exit 0 required). ----
  const existing = [
    { name: "modes", script: "oracle-diff-modes.mjs", diffRel: "evidence/modes/MODES_DIFF.json" },
    { name: "events", script: "oracle-diff-events.mjs", diffRel: "evidence/events/EVENTS_DIFF.json" },
    { name: "geometry", script: "oracle-diff-geometry.mjs", diffRel: "evidence/geometry/GEOMETRY_DIFF.json" },
  ];
  for (const item of existing) {
    const run = runNodeScript(item.script);
    if (run.stdout) process.stdout.write(run.stdout);
    if (run.stderr) process.stdout.write(run.stderr);
    check(
      `oracle:diff:${item.name} exits 0`,
      run.status === 0,
      `exit=${run.status}`,
    );
    if (run.status !== 0) continue;
    const diff = loadJson(path.join(ROOT, item.diffRel));
    const total = diff.fixturesTotal;
    const passed = diff.parityPassed;
    const failed = diff.parityFailed ?? 0;
    check(
      `oracle:diff:${item.name} parity ${passed}/${total}`,
      failed === 0 && passed === total && (diff.mismatches ?? []).length === 0,
      `mismatches=${JSON.stringify(diff.mismatches ?? []).slice(0, 500)}`,
    );
    check(
      `oracle:diff:${item.name} TS/Python analysis hashes agree`,
      diff.analysisSha256 === diff.pythonAnalysisSha256,
      `ts=${diff.analysisSha256} py=${diff.pythonAnalysisSha256}`,
    );
    sets[item.name] = {
      fixtures: total,
      parityPassed: passed,
      parityFailed: failed,
      parityPercent: total > 0 ? (passed / total) * 100 : 0,
      analysisSha256: diff.analysisSha256,
      version: diff.version,
    };
  }

  // ---- 2. BFS coverage diff (TS vs the new Python BFS Oracle). ----
  const bfsFiles = [...listAllBfsFixtures(), ...listGoldenFixtures()];
  check("BFS coverage set is 39 fixtures (15 BFS + 24 Golden)",
    bfsFiles.length === 39, `found ${bfsFiles.length}`);
  const bfsFixtures = bfsFiles.map(loadJson);
  const tsBfsResults = bfsFixtures.map((fixture) =>
    bfs.searchBfs(fixture, sha256Hex(bfs.canonicalBfsJson(fixture))),
  );
  const tsBfsCore = { results: tsBfsResults, seed: SEED, version: BFS_VERSION };
  const tsBfsHash = sha256Hex(bfs.canonicalBfsJson(tsBfsCore));
  const pyBfsRun = runPythonBfsOracle(
    bfsFiles,
    path.join(ROOT, PY_BFS_OUT_REL),
    1,
  );
  if (pyBfsRun.stdout) process.stdout.write(pyBfsRun.stdout);
  if (pyBfsRun.stderr) process.stdout.write(pyBfsRun.stderr);
  check("python BFS oracle exits 0", pyBfsRun.code === 0,
    `exit=${pyBfsRun.code} stderr=${pyBfsRun.stderr}`);
  check("python BFS oracle output parses", pyBfsRun.output !== null,
    "no output JSON");
  let bfsPassed = 0;
  const bfsMismatches = [];
  if (pyBfsRun.output !== null) {
    const pyResults = pyBfsRun.output.results ?? [];
    check("python BFS oracle returned 39 results",
      pyResults.length === 39, `got ${pyResults.length}`);
    check("python BFS oracle seed matches frozen seed",
      pyBfsRun.output.seed === SEED, `seed=${pyBfsRun.output.seed}`);
    check("python BFS oracle version is bfs/v1",
      pyBfsRun.output.version === BFS_VERSION,
      `version=${pyBfsRun.output.version}`);
    check("python BFS oracle determinism: 1 run, 1 hash",
      pyBfsRun.output.determinism?.runs === 1 &&
        pyBfsRun.output.determinism?.uniqueHashes === 1,
      JSON.stringify(pyBfsRun.output.determinism));
    for (let i = 0; i < bfsFixtures.length; i++) {
      const label = bfsFixtures[i].scenario_id;
      const diffs = diffPaths(tsBfsResults[i], pyResults[i], label);
      if (diffs.length === 0) {
        bfsPassed += 1;
      } else {
        bfsMismatches.push({ scenarioId: label, diffs: diffs.slice(0, 10) });
      }
    }
    check("BFS coverage parity 39/39", bfsPassed === 39,
      `passed=${bfsPassed} mismatches=${JSON.stringify(bfsMismatches).slice(0, 1000)}`);
    check("BFS coverage TS/Python analysis hashes agree",
      pyBfsRun.output.analysisSha256 === tsBfsHash,
      `ts=${tsBfsHash} py=${pyBfsRun.output.analysisSha256}`);
  }
  sets.bfsCoverage = {
    fixtures: 39,
    parityPassed: bfsPassed,
    parityFailed: 39 - bfsPassed,
    parityPercent: (bfsPassed / 39) * 100,
    analysisSha256: tsBfsHash,
    pythonAnalysisSha256: pyBfsRun.output?.analysisSha256 ?? null,
    version: BFS_VERSION,
    mismatches: bfsMismatches,
  };

  // ---- 3. Golden geometry diff (TS vs Python Geometry Oracle). ----
  const goldenFiles = listGoldenFixtures();
  const goldenFixtures = goldenFiles.map(loadJson);
  const tsGeoResults = goldenFixtures.map((fixture) =>
    geometryEval.evaluateGeometry(
      fixture,
      sha256Hex(bfs.canonicalBfsJson(fixture)),
    ),
  );
  const pyGeoRun = runPythonGeometryOracle(
    goldenFiles,
    path.join(ROOT, PY_GOLDEN_OUT_REL),
    1,
  );
  if (pyGeoRun.stdout) process.stdout.write(pyGeoRun.stdout);
  if (pyGeoRun.stderr) process.stdout.write(pyGeoRun.stderr);
  check("python geometry oracle (golden) exits 0", pyGeoRun.code === 0,
    `exit=${pyGeoRun.code} stderr=${pyGeoRun.stderr}`);
  check("python geometry oracle (golden) output parses",
    pyGeoRun.output !== null, "no output JSON");
  let geoPassed = 0;
  const geoMismatches = [];
  let tsGeoHash = null;
  if (pyGeoRun.output !== null) {
    const pyResults = pyGeoRun.output.results ?? [];
    check("python geometry oracle (golden) returned 24 results",
      pyResults.length === 24, `got ${pyResults.length}`);
    const tsGeoCore = { results: tsGeoResults, seed: SEED, version: "geometry/v1" };
    tsGeoHash = sha256Hex(geometryEval.canonicalGeometryJson(tsGeoCore));
    for (let i = 0; i < goldenFixtures.length; i++) {
      const label = goldenFixtures[i].scenario_id;
      const diffs = diffPaths(tsGeoResults[i], pyResults[i], label);
      if (diffs.length === 0) {
        geoPassed += 1;
      } else {
        geoMismatches.push({ scenarioId: label, diffs: diffs.slice(0, 10) });
      }
    }
    check("Golden geometry parity 24/24", geoPassed === 24,
      `passed=${geoPassed} mismatches=${JSON.stringify(geoMismatches).slice(0, 1000)}`);
    check("Golden geometry TS/Python analysis hashes agree",
      pyGeoRun.output.analysisSha256 === tsGeoHash,
      `ts=${tsGeoHash} py=${pyGeoRun.output.analysisSha256}`);
  }
  sets.geometryGolden = {
    fixtures: 24,
    parityPassed: geoPassed,
    parityFailed: 24 - geoPassed,
    parityPercent: (geoPassed / 24) * 100,
    analysisSha256: tsGeoHash,
    pythonAnalysisSha256: pyGeoRun.output?.analysisSha256 ?? null,
    version: "geometry/v1",
    mismatches: geoMismatches,
  };

  const totalFixtures = Object.values(sets).reduce((n, s) => n + s.fixtures, 0);
  const totalPassed = Object.values(sets).reduce((n, s) => n + s.parityPassed, 0);
  const totalPercent = totalFixtures > 0 ? (totalPassed / totalFixtures) * 100 : 0;
  check("total coverage parity is 100%", totalPassed === totalFixtures,
    `passed=${totalPassed}/${totalFixtures}`);

  const report = {
    seed: SEED,
    generatedBy: "oracle:diff:coverage (T011)",
    sets,
    total: {
      fixtures: totalFixtures,
      parityPassed: totalPassed,
      parityFailed: totalFixtures - totalPassed,
      parityPercent: totalPercent,
    },
    layeringNote:
      "Python Oracle layering (T007 P2-1 / T011 P2-6, accepted as-is): the " +
      "Python Geometry Oracle reuses the same-side Python Modes Oracle " +
      "(modes_oracle.py) as its replay/validation layer, and the Python " +
      "BFS Oracle reuses the same-side Python Modes/Events/Geometry " +
      "Oracles for single-step transitions and rectangle geometry, " +
      "exactly as the TypeScript geometry evaluator reuses the " +
      "same-side modes.ts and the TypeScript BFS reuses the same-side " +
      "geometry-eval.ts / events.ts. The BFS search itself (alphabet, " +
      "queue order, dedup key, bounds, fail-closed limits) is " +
      "implemented independently on each side. There is zero shared " +
      "code and zero calling between the TypeScript side and the " +
      "Python side — the two sides share only read-only fixtures, " +
      "field names and the canonical-JSON definition — so the parity " +
      "remains a genuine cross-check. No ignore list exists.",
    analysisSha256: sha256Hex(bfs.canonicalBfsJson(sets)),
    checksPassed: passes.length,
    checksFailed: failures.length,
  };
  writeJson(path.join(ROOT, OUT_REL), report);
  console.log(`coverage parity: ${totalPassed}/${totalFixtures} (${totalPercent}%)`);
  console.log(`checks passed: ${passes.length}, checks failed: ${failures.length}`);
  if (failures.length > 0) {
    for (const failure of failures) console.log(`FAIL: ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log("Oracle coverage diff: PASS — parity 100%");
}

await main();
