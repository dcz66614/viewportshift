#!/usr/bin/env node
/**
 * T005 acceptance runner: `npm run test:modes`.
 *
 * Runs the TypeScript formal three-mode evaluator over the 41 mode
 * fixtures and asserts:
 * - exactly 41 fixtures are present (13 resizes-visual, 8
 *   resizes-content, 8 overlays-content, 12 fail-closed);
 * - every fixture carries the frozen seed;
 * - every evaluation status / reason / failedEventId / failedStepIndex
 *   equals its hand-authored expected block (29 OK, 8 UNKNOWN,
 *   4 INVALID — no fake PASS anywhere);
 * - every OK fixture's final state equals its hand-authored expected
 *   final state field by field, and differs on every `notFinal`
 *   control (the other modes' distinctive outcomes must not occur);
 * - every step's contract-check name list equals the hand-authored
 *   frozen list for its (mode, event type), in order, and every check
 *   passed;
 * - every step keeps the scenario mode unchanged (a delayed pan is a
 *   pressure event, never a fourth mode);
 * - every pan report equals its hand-authored expected report
 *   (requested / applied / clamped / clamp reason);
 * - the evaluation is deterministic: two full runs hash identically;
 * - the domain sources and the Python Modes Oracle contain no
 *   wall-clock / timer / randomness / float-comparison dependency.
 *
 * Writes evidence/modes/MODES_TS.json (canonical core + hash).
 * Exits 0 only when every check passes.
 */
import fs from "node:fs";
import path from "node:path";
import {
  FORBIDDEN_TOKENS,
  MODES_VERSION,
  ROOT,
  SEED,
  deepEqual,
  evaluateTs,
  listModesFixtures,
  loadJson,
  loadT005Domain,
  writeJson,
} from "./t005-lib.mjs";

const OUT_REL = "evidence/modes/MODES_TS.json";

const failures = [];
const passes = [];

function check(name, ok, detail) {
  if (ok) passes.push(name);
  else failures.push(detail ? `${name} — ${detail}` : name);
  return ok;
}

async function main() {
  const { modes, sources } = await loadT005Domain();
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
    path.join(ROOT, "oracle/python/modes_oracle.py"),
    "utf8",
  );
  for (const token of ["time.time", "random.", "datetime.now", "uuid"]) {
    check(
      `no forbidden token in oracle/python/modes_oracle.py (${token})`,
      !oracleSource.includes(token),
      `modes_oracle.py contains forbidden token ${token}`,
    );
  }
  check(
    "modes module exports evaluate entry points",
    typeof modes.evaluateModes === "function" &&
      typeof modes.evaluateScenarioModes === "function" &&
      typeof modes.evaluateModeTransition === "function" &&
      typeof modes.canonicalModeJson === "function" &&
      typeof modes.isStandardMode === "function",
    "missing export",
  );
  check(
    "modes version is modes/v1",
    modes.MODES_VERSION === MODES_VERSION,
    `MODES_VERSION=${modes.MODES_VERSION}`,
  );

  const files = listModesFixtures();
  check("exactly 41 mode fixtures present", files.length === 41,
    `found ${files.length}`);
  const fixtures = files.map(loadJson);
  const byMode = {};
  const okByMode = {};
  for (const f of fixtures) {
    const key = f.mode ?? "<missing>";
    byMode[key] = (byMode[key] ?? 0) + 1;
    if (f.expected.status === "OK") {
      okByMode[key] = (okByMode[key] ?? 0) + 1;
    }
    check(
      `${f.scenario_id}: frozen seed`,
      f.seed === SEED,
      `seed=${f.seed}`,
    );
  }
  check("13 resizes-visual OK fixtures", okByMode["resizes-visual"] === 13,
    `found ${okByMode["resizes-visual"] ?? 0}`);
  check("8 resizes-content OK fixtures", okByMode["resizes-content"] === 8,
    `found ${okByMode["resizes-content"] ?? 0}`);
  check("8 overlays-content OK fixtures", okByMode["overlays-content"] === 8,
    `found ${okByMode["overlays-content"] ?? 0}`);
  check("12 fail-closed fixtures", byMode["resizes-unknown"] === 1 &&
    byMode["<missing>"] === 1 &&
    fixtures.filter((f) => f.expected.status !== "OK").length === 12,
    `unknown-mode=${byMode["resizes-unknown"] ?? 0} missing-mode=${byMode["<missing>"] ?? 0}`);

  const { core, analysisSha256 } = evaluateTs(modes, fixtures);
  const results = core.results;
  const { analysisSha256: hash2 } = evaluateTs(modes, fixtures);
  check(
    "determinism: two full TS runs hash identically",
    hash2 === analysisSha256,
    `run1=${analysisSha256} run2=${hash2}`,
  );
  check(
    "canonical output contains no absolute workspace path",
    !modes.canonicalModeJson(core).includes(ROOT),
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
    const label = result.scenarioId;
    if (result.status === "OK") okCount += 1;
    else if (result.status === "UNKNOWN") unknownCount += 1;
    else if (result.status === "INVALID") invalidCount += 1;

    check(`${label}: status matches hand-authored expected`,
      result.status === exp.status,
      `status=${result.status} expected=${exp.status} reason=${result.reason}`);
    check(`${label}: reason matches hand-authored expected`,
      result.reason === exp.reason,
      `reason=${result.reason} expected=${exp.reason}`);
    check(`${label}: failedEventId matches expected`,
      result.failedEventId === exp.failedEventId,
      `failedEventId=${result.failedEventId} expected=${exp.failedEventId}`);
    check(`${label}: failedStepIndex matches expected`,
      result.failedStepIndex === exp.failedStepIndex,
      `failedStepIndex=${result.failedStepIndex} expected=${exp.failedStepIndex}`);
    check(`${label}: seed echoed`,
      result.seed === fixture.seed, `seed=${result.seed}`);
    check(`${label}: mode echoed`,
      result.mode === (fixture.mode ?? ""),
      `mode=${result.mode} fixture=${fixture.mode ?? ""}`);

    if (exp.status === "OK") {
      check(`${label}: initialState present`, result.initialState !== null,
        "initialState is null");
      check(`${label}: finalState present`, result.finalState !== null,
        "finalState is null");
      check(`${label}: steps cover every event`,
        result.steps.length === fixture.events.length,
        `steps=${result.steps.length} events=${fixture.events.length}`);
      check(`${label}: panReports cover every event`,
        result.panReports.length === fixture.events.length,
        `panReports=${result.panReports.length}`);
      for (const [key, value] of Object.entries(exp.final)) {
        check(`${label}: final ${key} matches expected`,
          deepEqual(result.finalState[key], value),
          `final.${key}=${JSON.stringify(result.finalState[key])} expected=${JSON.stringify(value)}`);
      }
      for (const [key, value] of Object.entries(exp.notFinal ?? {})) {
        check(`${label}: final ${key} is NOT the other mode's outcome`,
          !deepEqual(result.finalState[key], value),
          `final.${key}=${JSON.stringify(result.finalState[key])} must not equal ${JSON.stringify(value)}`);
      }
      for (let s = 0; s < result.steps.length; s++) {
        const step = result.steps[s];
        stepCount += 1;
        check(`${label} step ${s}: status OK`,
          step.status === "OK", `status=${step.status} reason=${step.reason}`);
        check(`${label} step ${s}: mode unchanged (pan is not a 4th mode)`,
          step.state.mode === fixture.mode,
          `mode=${step.state.mode}`);
        const names = step.contractChecks.map((c) => c.name);
        check(`${label} step ${s}: contract-check names match frozen list`,
          deepEqual(names, exp.stepChecks[s]),
          `checks=${JSON.stringify(names)} expected=${JSON.stringify(exp.stepChecks[s])}`);
        const failed = step.contractChecks.filter((c) => !c.passed);
        check(`${label} step ${s}: every contract check passed`,
          failed.length === 0,
          `failed=${JSON.stringify(failed)}`);
        checkCount += step.contractChecks.length;
        check(`${label} step ${s}: panReport matches transition record`,
          deepEqual(step.panReport, result.panReports[s]),
          "step panReport diverges from panReports array");
      }
      if (exp.panReports !== undefined) {
        check(`${label}: panReports match hand-authored expected`,
          deepEqual(result.panReports, exp.panReports),
          `panReports=${JSON.stringify(result.panReports)} expected=${JSON.stringify(exp.panReports)}`);
      }
    } else {
      // Fail-closed: no replay ran, no states, no steps.
      check(`${label}: initialState null on ${exp.status}`,
        result.initialState === null, "initialState must be null");
      check(`${label}: finalState null on ${exp.status}`,
        result.finalState === null, "finalState must be null");
      check(`${label}: no steps on ${exp.status}`,
        result.steps.length === 0, `steps=${result.steps.length}`);
      check(`${label}: no panReports on ${exp.status}`,
        result.panReports.length === 0, `panReports=${result.panReports.length}`);
      check(`${label}: validationIssues non-empty`,
        result.validationIssues.length > 0, "no validation issues recorded");
      check(`${label}: first validation issue code is the reason`,
        result.validationIssues[0].code === result.reason,
        `first=${result.validationIssues[0]?.code} reason=${result.reason}`);
    }
    const fs_ = result.finalState;
    console.log(
      `${label}: status=${result.status} expected=${exp.status} ` +
        `reason=${result.reason ?? "-"} steps=${result.steps.length} ` +
        (fs_
          ? `layoutH=${fs_.layoutHeight} visualH=${fs_.visualHeight} ` +
            `kb=${JSON.stringify(fs_.keyboardRect)} visible=${fs_.keyboardVisible} ` +
            `scrollY=${fs_.scrollY} offsetTop=${fs_.visualOffsetTop}`
          : "states=null"),
    );
  }
  check("29 OK evaluations", okCount === 29, `ok=${okCount}`);
  check("8 UNKNOWN evaluations", unknownCount === 8, `unknown=${unknownCount}`);
  check("4 INVALID evaluations", invalidCount === 4, `invalid=${invalidCount}`);

  const out = {
    analysisSha256,
    determinism: { runs: 2, uniqueHashes: 1, hashes: [analysisSha256] },
    results,
    seed: SEED,
    version: MODES_VERSION,
  };
  writeJson(path.join(ROOT, OUT_REL), out);
  console.log(
    `\nfixtures: ${fixtures.length}, steps checked: ${stepCount}, ` +
      `contract checks: ${checkCount}, OK=${okCount} UNKNOWN=${unknownCount} ` +
      `INVALID=${invalidCount}`,
  );
  console.log(`analysisSha256: ${analysisSha256}`);
  console.log(`wrote ${OUT_REL}`);
  console.log(
    `\nchecks passed: ${passes.length}, checks failed: ${failures.length}`,
  );
  if (failures.length > 0) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(`- ${f}`);
    console.log("\nModes (TS): FAIL");
    process.exitCode = 1;
  } else {
    console.log("\nModes (TS): PASS");
    process.exitCode = 0;
  }
}

main().catch((err) => {
  console.error(`runner error: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
