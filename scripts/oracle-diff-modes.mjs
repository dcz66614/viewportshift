#!/usr/bin/env node
/**
 * T005 acceptance runner: `npm run oracle:diff:modes`.
 *
 * Runs the TypeScript formal three-mode evaluator and the independent
 * Python Modes Oracle over the same 41 mode fixtures and asserts
 * 100% per-field parity:
 * - the Python Oracle exits 0 and writes a well-formed result file;
 * - both sides return the same number of results, in the same order,
 *   with the same scenario ids;
 * - every result document is field-by-field identical between TS and
 *   Python (scenarioId, scenarioSha256, seed, mode, status, reason,
 *   validationIssues, failedEventId, failedStepIndex, initialState,
 *   finalState, steps incl. per-step states / panReports /
 *   contractChecks, panReports) — any mismatch is a FAIL, there is no
 *   ignore list;
 * - the TS and Python analysis hashes are identical;
 * - parity holds per mode (13 resizes-visual, 8 resizes-content,
 *   8 overlays-content) and over the 12 fail-closed fixtures.
 *
 * The Oracle never sees TypeScript output: it reads only the fixtures
 * and computes every expectation itself. Writes
 * evidence/modes/MODES_DIFF.json (parity report + hashes).
 * Exits 0 only when every check passes.
 */
import path from "node:path";
import { diffPaths } from "./s0-lib.mjs";
import {
  MODES_VERSION,
  ROOT,
  SEED,
  evaluateTs,
  listModesFixtures,
  loadJson,
  loadT005Domain,
  runPythonModesOracle,
  writeJson,
} from "./t005-lib.mjs";

const PY_OUT_REL = "evidence/modes/MODES_PY.json";
const DIFF_OUT_REL = "evidence/modes/MODES_DIFF.json";

const failures = [];
const passes = [];

function check(name, ok, detail) {
  if (ok) passes.push(name);
  else failures.push(detail ? `${name} — ${detail}` : name);
  return ok;
}

async function main() {
  const { modes } = await loadT005Domain();
  const files = listModesFixtures();
  check("exactly 41 mode fixtures present", files.length === 41,
    `found ${files.length}`);
  const fixtures = files.map(loadJson);

  const { core: tsCore, analysisSha256: tsHash } = evaluateTs(modes, fixtures);
  const tsResults = tsCore.results;
  check("TS evaluated 41 fixtures", tsResults.length === 41,
    `got ${tsResults.length}`);
  check("TS analysis hash is 64 hex chars",
    /^[0-9a-f]{64}$/.test(tsHash), `hash=${tsHash}`);

  const pyOutPath = path.join(ROOT, PY_OUT_REL);
  const run = runPythonModesOracle(files, pyOutPath, 1);
  console.log(run.stdout);
  if (run.stderr) console.log(run.stderr);
  check("python modes oracle exits 0", run.code === 0,
    `exit=${run.code} stderr=${run.stderr}`);
  check("python modes oracle output file exists and parses",
    run.output !== null, "no output JSON");
  if (run.output === null) return finish(null);
  const pyResults = run.output.results ?? [];
  check("python oracle returned 41 results", pyResults.length === 41,
    `got ${pyResults.length}`);
  check("python oracle seed matches frozen seed",
    run.output.seed === SEED, `seed=${run.output.seed}`);
  check("python oracle version is modes/v1",
    run.output.version === MODES_VERSION, `version=${run.output.version}`);
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
  check("parity: 41/41 fixtures field-identical", parityPassed === 41,
    `parityPassed=${parityPassed}`);
  const okParityByMode = {};
  for (const f of fixtures) {
    if (f.expected.status !== "OK") continue;
    const key = f.mode ?? "<missing>";
    okParityByMode[key] = (okParityByMode[key] ?? 0) + 1;
  }
  check("parity: 13 resizes-visual OK fixtures",
    okParityByMode["resizes-visual"] === 13 &&
      parityByMode["resizes-visual"] === 23,
    `ok=${okParityByMode["resizes-visual"] ?? 0} all-with-mode=${parityByMode["resizes-visual"] ?? 0}`);
  check("parity: 8 resizes-content OK fixtures",
    okParityByMode["resizes-content"] === 8,
    `found ${okParityByMode["resizes-content"] ?? 0}`);
  check("parity: 8 overlays-content OK fixtures",
    okParityByMode["overlays-content"] === 8,
    `found ${okParityByMode["overlays-content"] ?? 0}`);
  check("parity: 12 fail-closed fixtures",
    fixtures.filter((f) => f.expected.status !== "OK").length === 12 &&
      mismatches.filter((m) =>
        /unknown-mode|unknown-event-type|scale-2|clock-regression|keyboard-too-tall|event-limit|pan-limit|invalid-missing-mode|invalid-zero-area|invalid-non-integer|invalid-duplicate-event-id|unknown-template/.test(m),
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
    version: MODES_VERSION,
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
    console.log("\nModes oracle diff: FAIL");
    process.exitCode = 1;
  } else {
    console.log("\nModes oracle diff: PASS");
    process.exitCode = 0;
  }
}

main().catch((err) => {
  console.error(`runner error: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
