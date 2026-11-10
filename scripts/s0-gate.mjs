#!/usr/bin/env node
/**
 * T003 acceptance runner: `npm run s0:gate`.
 *
 * The S0 gate (IMPLEMENTATION_PLAN §0.1): fresh TypeScript analysis and a
 * fresh independent Python Oracle run over the same 48 scenarios + 5
 * edge cases, compared field by field (canonical JSON equality per
 * scenario, which covers status, layout/visual viewport, keyboard rect,
 * surface rect, obscured / clipped / visible area + ratio, bottomGap,
 * anchorDrift, pan reports, per-step states and the failure predicates).
 * Any single field mismatch is FAIL — there is no ignore list.
 *
 * Also re-establishes determinism independently: 100 TypeScript runs and
 * 100 Python Oracle runs must yield exactly 1 SHA-256, and the two
 * hashes must agree.
 *
 * Writes evidence/s0/S0_GATE.json (canonical JSON + gateSha256) and
 * refreshes evidence/s0/S0_GEOMETRY_TS.json and
 * evidence/s0/S0_GEOMETRY_PY.json from the fresh runs.
 * Exits 0 only when the gate PASSES.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ANALYSIS_VERSION,
  ROOT,
  SEED,
  analyzeTs,
  diffPaths,
  listFixtures,
  loadDomain,
  loadFixture,
  runPythonOracle,
  sha256Hex,
  writeJson,
} from "./s0-lib.mjs";

const RUNS = 100;
const GATE_REL = "evidence/s0/S0_GATE.json";
const TS_OUT_REL = "evidence/s0/S0_GEOMETRY_TS.json";
const PY_OUT_REL = "evidence/s0/S0_GEOMETRY_PY.json";

const failures = [];
const passes = [];

function check(name, ok, detail) {
  if (ok) passes.push(name);
  else failures.push(detail ? `${name} — ${detail}` : name);
  return ok;
}

function scenarioRow(ts, py, parity, fixture) {
  return {
    scenarioId: ts.scenarioId,
    layoutTemplate: ts.layoutTemplate,
    mode: ts.mode,
    expectedStatus: fixture.expected_status,
    tsStatus: ts.status,
    pyStatus: py ? py.status : null,
    parity,
    plantedErrorKind: fixture.planted_error ? fixture.planted_error.kind : null,
    detected: fixture.planted_error !== null && ts.status === "FAIL",
    firstFailedStepIndex: ts.firstFailedStepIndex,
    failedPredicates: ts.failedPredicates,
    finalMetrics: ts.finalMetrics,
  };
}

async function main() {
  const { geometry } = await loadDomain();
  const { main, edge } = listFixtures();
  check("exactly 48 main S0 fixtures present", main.length === 48,
    `found ${main.length}`);
  check("exactly 5 edge fixtures present", edge.length === 5,
    `found ${edge.length}`);
  const allFiles = [...main, ...edge];
  const fixtures = allFiles.map(loadFixture);

  // ---- Fresh TypeScript analysis (48 + 5) -------------------------------
  const { core: tsCore, analysisSha256: tsHash } = analyzeTs(geometry, fixtures);
  writeJson(path.join(ROOT, TS_OUT_REL), {
    analysisSha256: tsHash,
    determinism: { runs: 1, uniqueHashes: 1, hashes: [tsHash] },
    results: tsCore.results,
    seed: SEED,
    version: ANALYSIS_VERSION,
  });

  // ---- Fresh Python Oracle run (48 + 5) ---------------------------------
  const pyOutPath = path.join(ROOT, PY_OUT_REL);
  const pyRun = runPythonOracle(allFiles, pyOutPath, 1);
  console.log(pyRun.stdout);
  if (pyRun.stderr) console.log(pyRun.stderr);
  check("python oracle exits 0", pyRun.code === 0,
    `exit=${pyRun.code} stderr=${pyRun.stderr}`);
  check("python oracle output parses", pyRun.output !== null, "no output JSON");
  if (pyRun.output === null) return finish(null);
  const pyHash = pyRun.output.analysisSha256;
  check("TypeScript and Python analysis hashes agree", tsHash === pyHash,
    `ts=${tsHash} py=${pyHash}`);

  // ---- Per-scenario, per-field parity ------------------------------------
  const pyById = new Map(pyRun.output.results.map((r) => [r.scenarioId, r]));
  const mismatches = [];
  const rows = [];
  const edgeRows = [];
  let parityPassed = 0;
  let parityFailed = 0;
  for (let i = 0; i < fixtures.length; i++) {
    const fixture = fixtures[i];
    const ts = tsCore.results[i];
    const py = pyById.get(ts.scenarioId);
    const isEdge = i >= main.length;
    if (!py) {
      parityFailed += 1;
      mismatches.push(`${ts.scenarioId}: missing from Python output`);
      (isEdge ? edgeRows : rows).push(scenarioRow(ts, null, false, fixture));
      continue;
    }
    const tsCanon = geometry.canonicalJson(ts);
    const pyCanon = geometry.canonicalJson(py);
    const parity = tsCanon === pyCanon;
    if (parity) parityPassed += 1;
    else {
      parityFailed += 1;
      const diffs = diffPaths(ts, py);
      mismatches.push(
        `${ts.scenarioId}: ${diffs.slice(0, 5).join(" | ")}` +
          (diffs.length > 5 ? ` (+${diffs.length - 5} more)` : ""),
      );
    }
    check(`${ts.scenarioId}: TS/Python parity (all fields)`, parity,
      diffPaths(ts, py).slice(0, 3).join(" | "));
    check(
      `${ts.scenarioId}: status matches hand-authored expected_status`,
      ts.status === fixture.expected_status && py.status === fixture.expected_status,
      `ts=${ts.status} py=${py.status} expected=${fixture.expected_status}`,
    );
    (isEdge ? edgeRows : rows).push(scenarioRow(ts, py, parity, fixture));
    console.log(
      `${ts.scenarioId}: parity=${parity ? "MATCH" : "MISMATCH"} ` +
        `status=${ts.status}/${py.status} expected=${fixture.expected_status}`,
    );
  }

  // ---- Planted errors / false positives (48 main scenarios) --------------
  let plantedTotal = 0;
  let plantedDetected = 0;
  let falsePositives = 0;
  for (let i = 0; i < main.length; i++) {
    const fixture = fixtures[i];
    const ts = tsCore.results[i];
    const py = pyById.get(ts.scenarioId);
    if (fixture.planted_error !== null) {
      plantedTotal += 1;
      if (ts.status === "FAIL" && py && py.status === "FAIL") plantedDetected += 1;
    } else if (ts.status !== "PASS" || (py && py.status !== "PASS")) {
      falsePositives += 1;
    }
  }
  check("planted errors: 12 total", plantedTotal === 12, `total=${plantedTotal}`);
  check("planted errors: 12/12 detected (both sides)", plantedDetected === 12,
    `detected=${plantedDetected}`);
  check("normal scenarios: 0 false positives", falsePositives === 0,
    `falsePositives=${falsePositives}`);
  check("parity: 53/53 scenarios match", parityPassed === 53 && parityFailed === 0,
    `passed=${parityPassed} failed=${parityFailed}`);

  // ---- Determinism: 100 runs each side, 1 hash ---------------------------
  const tsHashes = new Set();
  for (let i = 0; i < RUNS; i++) {
    const mainFixtures = main.map(loadFixture);
    const { analysisSha256 } = analyzeTs(geometry, mainFixtures);
    tsHashes.add(analysisSha256);
  }
  check(`TypeScript determinism: ${RUNS} runs, 1 hash`, tsHashes.size === 1,
    `unique=${tsHashes.size}`);
  const tsDetHash = [...tsHashes][0];
  const detTmp = path.join(os.tmpdir(), "viewportshift-s0-determinism-py.json");
  const detRun = runPythonOracle(main, detTmp, RUNS);
  if (detRun.stdout) console.log(detRun.stdout);
  if (detRun.stderr) console.log(detRun.stderr);
  check("python oracle --repeat 100 exits 0", detRun.code === 0,
    `exit=${detRun.code} stderr=${detRun.stderr}`);
  const pyDetHashes = detRun.output?.determinism?.hashes ?? [];
  check(`Python determinism: ${RUNS} runs, 1 hash`, pyDetHashes.length === 1,
    `unique=${pyDetHashes.length}`);
  const pyDetHash = pyDetHashes[0];
  check("determinism hashes agree (TS == Python)", tsDetHash === pyDetHash,
    `ts=${tsDetHash} py=${pyDetHash}`);
  // The 100-run hash is over the 48 main scenarios only; it must equal
  // the hash of the 48-scenario subset of the fresh full analysis.
  const main48 = analyzeTs(geometry, main.map(loadFixture));
  check("determinism hash equals the 48-scenario analysis hash",
    tsDetHash === main48.analysisSha256,
    `det=${tsDetHash} analysis48=${main48.analysisSha256}`);
  try {
    fs.rmSync(detTmp, { force: true });
  } catch {
    // Temp-file cleanup failure is not a gate failure.
  }

  const gateCore = {
    analysisSha256: tsHash,
    determinism: {
      runs: RUNS,
      tsUniqueHashes: tsHashes.size,
      pyUniqueHashes: pyDetHashes.length,
      analysisSha256: tsDetHash,
    },
    edgeCases: edgeRows,
    edgeCasesPassed: edgeRows.filter((r) => r.parity && r.tsStatus === r.expectedStatus).length,
    edgeCasesTotal: edge.length,
    falsePositives,
    gate: "S0",
    mismatches,
    parityFailed,
    parityPassed,
    plantedErrorsDetected: plantedDetected,
    plantedErrorsTotal: plantedTotal,
    project: "P021",
    scenarios: rows,
    scenariosTotal: main.length,
    seed: SEED,
    specVersion: "1.0.0",
    status: "PASS",
  };
  // The gate only PASSES when every check above passed.
  gateCore.status = failures.length === 0 ? "PASS" : "FAIL";
  gateCore.gateSha256 = sha256Hex(geometry.canonicalJson(gateCore));
  writeJson(path.join(ROOT, GATE_REL), gateCore);

  console.log(
    `\nS0 gate: scenarios=${main.length} parity=${parityPassed}/${parityPassed + parityFailed} ` +
      `planted=${plantedDetected}/${plantedTotal} falsePositives=${falsePositives} ` +
      `edge=${gateCore.edgeCasesPassed}/${gateCore.edgeCasesTotal} ` +
      `determinism=${RUNS} runs, tsUnique=${tsHashes.size}, pyUnique=${pyDetHashes.length}`,
  );
  console.log(`analysisSha256: ${tsHash}`);
  console.log(`gateSha256: ${gateCore.gateSha256}`);
  console.log(`wrote ${GATE_REL}`);
  finish(gateCore);
}

function finish(gateCore) {
  console.log(
    `\nchecks passed: ${passes.length}, checks failed: ${failures.length}`,
  );
  if (failures.length > 0) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(`- ${f}`);
    console.log("\nS0 gate: FAIL");
    process.exitCode = 1;
  } else {
    console.log(
      `\nS0 gate: ${gateCore ? gateCore.status : "PASS"} (53/53 parity: 48 main + 5 edge, 12/12 planted, 0 false positives, 100 runs / 1 hash)`,
    );
    process.exitCode = gateCore && gateCore.status === "PASS" ? 0 : 1;
  }
}

main().catch((err) => {
  console.error(`runner error: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
