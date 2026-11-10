#!/usr/bin/env node
/**
 * T006 acceptance runner: `npm run oracle:diff:events`.
 *
 * Runs the TypeScript event model and the independent Python Events
 * Oracle over the same 27 event fixtures and asserts 100% per-field
 * parity:
 * - the Python Oracle exits 0 and writes a well-formed result file;
 * - both sides return the same number of results, in the same order,
 *   with the same scenario ids;
 * - every result document is field-by-field identical between TS and
 *   Python (scenarioId, scenarioSha256, seed, mode, status, reason,
 *   validationIssues, failedEventId, failedStepIndex, initialState,
 *   finalState, steps incl. per-step states / panReports /
 *   scrollReports / clampBounds / eventChecks / contractChecks,
 *   panReports, scrollReports, clampEvidence) — any mismatch is a
 *   FAIL, there is no ignore list;
 * - the TS and Python analysis hashes are identical;
 * - parity holds per mode (resizes-visual / resizes-content /
 *   overlays-content OK fixtures) and over the 5 fail-closed
 *   fixtures.
 *
 * The Oracle never sees TypeScript output: it reads only the fixtures
 * and computes every expectation itself. Writes
 * evidence/events/EVENTS_DIFF.json (parity report + hashes).
 * Exits 0 only when every check passes.
 */
import path from "node:path";
import { diffPaths } from "./s0-lib.mjs";
import {
  EVENTS_VERSION,
  ROOT,
  SEED,
  evaluateTs,
  listEventsFixtures,
  loadJson,
  loadT006Domain,
  runPythonEventsOracle,
  writeJson,
} from "./t006-lib.mjs";

const PY_OUT_REL = "evidence/events/EVENTS_PY.json";
const DIFF_OUT_REL = "evidence/events/EVENTS_DIFF.json";

const failures = [];
const passes = [];

function check(name, ok, detail) {
  if (ok) passes.push(name);
  else failures.push(detail ? `${name} — ${detail}` : name);
  return ok;
}

async function main() {
  const { events } = await loadT006Domain();
  const files = listEventsFixtures();
  check("exactly 27 event fixtures present", files.length === 27,
    `found ${files.length}`);
  const fixtures = files.map(loadJson);

  const { core: tsCore, analysisSha256: tsHash } = evaluateTs(events, fixtures);
  const tsResults = tsCore.results;
  check("TS evaluated 27 fixtures", tsResults.length === 27,
    `got ${tsResults.length}`);
  check("TS analysis hash is 64 hex chars",
    /^[0-9a-f]{64}$/.test(tsHash), `hash=${tsHash}`);

  const pyOutPath = path.join(ROOT, PY_OUT_REL);
  const run = runPythonEventsOracle(files, pyOutPath, 1);
  console.log(run.stdout);
  if (run.stderr) console.log(run.stderr);
  check("python events oracle exits 0", run.code === 0,
    `exit=${run.code} stderr=${run.stderr}`);
  check("python events oracle output file exists and parses",
    run.output !== null, "no output JSON");
  if (run.output === null) return finish(null);
  const pyResults = run.output.results ?? [];
  check("python oracle returned 27 results", pyResults.length === 27,
    `got ${pyResults.length}`);
  check("python oracle seed matches frozen seed",
    run.output.seed === SEED, `seed=${run.output.seed}`);
  check("python oracle version is events/v1",
    run.output.version === EVENTS_VERSION, `version=${run.output.version}`);
  check("python oracle determinism: 1 run, 1 hash",
    run.output.determinism?.runs === 1 &&
      run.output.determinism?.uniqueHashes === 1,
    JSON.stringify(run.output.determinism));
  check("python oracle analysis hash is 64 hex chars",
    /^[0-9a-f]{64}$/.test(run.output.analysisSha256 ?? ""),
    `hash=${run.output.analysisSha256}`);

  let mismatches = [];
  let parityPassed = 0;
  const parityByMode = {};
  for (let i = 0; i < fixtures.length; i++) {
    const fixture = fixtures[i];
    const ts = tsResults[i];
    const py = pyResults[i];
    const label = fixture.scenario_id;
    const modeKey = fixture.mode ?? "<missing>";
    check(`${label}: python result present`, py !== undefined,
      "missing from oracle output");
    if (!py) continue;
    check(`${label}: scenario ids agree`,
      ts.scenarioId === py.scenarioId,
      `ts=${ts.scenarioId} py=${py.scenarioId}`);
    const diffs = diffPaths(ts, py, label);
    if (diffs.length === 0) {
      parityPassed += 1;
      parityByMode[modeKey] = (parityByMode[modeKey] ?? 0) + 1;
    } else {
      mismatches.push(...diffs);
      console.log(`${label}: MISMATCH (${diffs.length} fields)`);
      for (const d of diffs.slice(0, 10)) console.log(`  - ${d}`);
    }
    console.log(
      `${label}: ts=${ts.status} py=${py.status} ` +
        `reason=${ts.reason ?? "-"} parity=${diffs.length === 0}`,
    );
  }
  check("parity: 27/27 fixtures field-identical", parityPassed === 27,
    `parityPassed=${parityPassed}`);
  const okParityByMode = {};
  for (const f of fixtures) {
    if (f.expected.status !== "OK") continue;
    const key = f.mode ?? "<missing>";
    okParityByMode[key] = (okParityByMode[key] ?? 0) + 1;
  }
  check("parity: resizes-visual OK fixtures",
    okParityByMode["resizes-visual"] === 19 &&
      parityByMode["resizes-visual"] === 24,
    `ok=${okParityByMode["resizes-visual"] ?? 0} all-with-mode=${parityByMode["resizes-visual"] ?? 0}`);
  check("parity: resizes-content OK fixtures",
    okParityByMode["resizes-content"] === 1,
    `found ${okParityByMode["resizes-content"] ?? 0}`);
  check("parity: overlays-content OK fixtures",
    okParityByMode["overlays-content"] === 2,
    `found ${okParityByMode["overlays-content"] ?? 0}`);
  check("parity: 5 fail-closed fixtures",
    fixtures.filter((f) => f.expected.status !== "OK").length === 5 &&
      mismatches.filter((m) =>
        /clock-regression|pan-limit|event-limit|unknown-event-type|invalid-duplicate-event-id/.test(m),
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
    parityByMode,
    mismatches,
    seed: SEED,
    version: EVENTS_VERSION,
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
    console.log("\nEvents oracle diff: FAIL");
    process.exitCode = 1;
  } else {
    console.log("\nEvents oracle diff: PASS");
    process.exitCode = 0;
  }
}

main().catch((err) => {
  console.error(`runner error: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
