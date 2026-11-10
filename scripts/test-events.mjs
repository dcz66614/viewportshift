#!/usr/bin/env node
/**
 * T006 acceptance runner: `npm run test:events`.
 *
 * Runs the TypeScript delayed-pan / scroll / keyboard / settled event
 * model over the 27 event fixtures and asserts:
 * - exactly 27 fixtures are present (22 OK, 4 UNKNOWN, 1 INVALID);
 * - every fixture carries the frozen seed;
 * - every evaluation status / reason / failedEventId / failedStepIndex
 *   equals its hand-authored expected block — no fake PASS anywhere;
 * - every OK fixture's final state equals its hand-authored expected
 *   final state field by field;
 * - every step's event-check and mode-contract-check name lists equal
 *   the hand-authored frozen lists for their (mode, event type), in
 *   order, and every check passed;
 * - every step keeps the scenario mode unchanged (a delayed pan is a
 *   pressure event, never a fourth mode);
 * - every pan report and scroll report equals its hand-authored
 *   expected requested/applied pair (requested / applied / clamped /
 *   clamp reason);
 * - every pan step's clamp bounds equal the hand-authored expected
 *   bounds, and the trace-level clampEvidence equals the expected
 *   clamp-evidence rows (requested/applied对照 per pan step);
 * - every pan step's applied offsets stay within its bounds, and
 *   every clamped step's reason names the bound that bit;
 * - the evaluation is deterministic: two full runs hash identically;
 * - the domain sources and the Python Events Oracle contain no
 *   wall-clock / timer / randomness / float-comparison dependency.
 *
 * Writes evidence/events/EVENTS_TS.json (canonical core + hash) and
 * evidence/events/CLAMP_EVIDENCE.json (all clamp rows, requested /
 * applied / bounds, in fixture order). Exits 0 only when every check
 * passes.
 */
import fs from "node:fs";
import path from "node:path";
import {
  EVENTS_VERSION,
  FORBIDDEN_TOKENS,
  ROOT,
  SEED,
  deepEqual,
  evaluateTs,
  listEventsFixtures,
  loadJson,
  loadT006Domain,
  writeJson,
} from "./t006-lib.mjs";

const OUT_REL = "evidence/events/EVENTS_TS.json";
const CLAMP_OUT_REL = "evidence/events/CLAMP_EVIDENCE.json";

const failures = [];
const passes = [];

function check(name, ok, detail) {
  if (ok) passes.push(name);
  else failures.push(detail ? `${name} — ${detail}` : name);
  return ok;
}

async function main() {
  const { events, sources } = await loadT006Domain();
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
    path.join(ROOT, "oracle/python/events_oracle.py"),
    "utf8",
  );
  for (const token of ["time.time", "random.", "datetime.now", "uuid"]) {
    check(
      `no forbidden token in oracle/python/events_oracle.py (${token})`,
      !oracleSource.includes(token),
      `events_oracle.py contains forbidden token ${token}`,
    );
  }
  check(
    "events module exports evaluate entry points",
    typeof events.evaluateEvents === "function" &&
      typeof events.evaluateScenarioEvents === "function" &&
      typeof events.evaluateEventTransition === "function" &&
      typeof events.canonicalEventJson === "function" &&
      typeof events.clampBoundsFor === "function" &&
      typeof events.panClamp === "function" &&
      typeof events.scrollClamp === "function",
    "missing export",
  );
  check(
    "events version is events/v1",
    events.EVENTS_VERSION === EVENTS_VERSION,
    `EVENTS_VERSION=${events.EVENTS_VERSION}`,
  );

  const files = listEventsFixtures();
  check("exactly 27 event fixtures present", files.length === 27,
    `found ${files.length}`);
  const fixtures = files.map(loadJson);
  for (const f of fixtures) {
    check(
      `${f.scenario_id}: frozen seed`,
      f.seed === SEED,
      `seed=${f.seed}`,
    );
  }

  const { core, analysisSha256 } = evaluateTs(events, fixtures);
  const results = core.results;
  const { analysisSha256: hash2 } = evaluateTs(events, fixtures);
  check(
    "determinism: two full TS runs hash identically",
    hash2 === analysisSha256,
    `run1=${analysisSha256} run2=${hash2}`,
  );
  check(
    "canonical output contains no absolute workspace path",
    !events.canonicalEventJson(core).includes(ROOT),
    "absolute path leaked into canonical result",
  );

  let okCount = 0;
  let unknownCount = 0;
  let invalidCount = 0;
  let stepCount = 0;
  let eventCheckCount = 0;
  let contractCheckCount = 0;
  let panStepCount = 0;
  let clampedCount = 0;
  const clampRows = [];
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
      check(`${label}: scrollReports cover every event`,
        result.scrollReports.length === fixture.events.length,
        `scrollReports=${result.scrollReports.length}`);
      for (const [key, value] of Object.entries(exp.final)) {
        check(`${label}: final ${key} matches expected`,
          deepEqual(result.finalState[key], value),
          `final.${key}=${JSON.stringify(result.finalState[key])} expected=${JSON.stringify(value)}`);
      }
      for (let s = 0; s < result.steps.length; s++) {
        const step = result.steps[s];
        stepCount += 1;
        check(`${label} step ${s}: status OK`,
          step.status === "OK", `status=${step.status} reason=${step.reason}`);
        check(`${label} step ${s}: mode unchanged (pan is not a 4th mode)`,
          step.state.mode === fixture.mode,
          `mode=${step.state.mode}`);
        const evNames = step.eventChecks.map((c) => c.name);
        check(`${label} step ${s}: event-check names match frozen list`,
          deepEqual(evNames, exp.stepEventChecks[s]),
          `checks=${JSON.stringify(evNames)} expected=${JSON.stringify(exp.stepEventChecks[s])}`);
        const evFailed = step.eventChecks.filter((c) => !c.passed);
        check(`${label} step ${s}: every event check passed`,
          evFailed.length === 0,
          `failed=${JSON.stringify(evFailed)}`);
        const ctNames = step.contractChecks.map((c) => c.name);
        check(`${label} step ${s}: contract-check names match frozen list`,
          deepEqual(ctNames, exp.stepContractChecks[s]),
          `checks=${JSON.stringify(ctNames)} expected=${JSON.stringify(exp.stepContractChecks[s])}`);
        const ctFailed = step.contractChecks.filter((c) => !c.passed);
        check(`${label} step ${s}: every contract check passed`,
          ctFailed.length === 0,
          `failed=${JSON.stringify(ctFailed)}`);
        eventCheckCount += step.eventChecks.length;
        contractCheckCount += step.contractChecks.length;
        check(`${label} step ${s}: panReport matches transition record`,
          deepEqual(step.panReport, result.panReports[s]),
          "step panReport diverges from panReports array");
        check(`${label} step ${s}: scrollReport matches transition record`,
          deepEqual(step.scrollReport, result.scrollReports[s]),
          "step scrollReport diverges from scrollReports array");
        check(`${label} step ${s}: clampBounds match expected`,
          deepEqual(step.clampBounds, exp.clampBounds[s]),
          `clampBounds=${JSON.stringify(step.clampBounds)} expected=${JSON.stringify(exp.clampBounds[s])}`);
        if (step.eventType === "DELAYED_VISUAL_PAN") {
          panStepCount += 1;
          const b = step.clampBounds;
          check(`${label} step ${s}: applied pan within bounds`,
            b !== null &&
              step.state.visualOffsetLeft >= 0 &&
              step.state.visualOffsetLeft <= b.maxLeft &&
              step.state.visualOffsetTop >= 0 &&
              step.state.visualOffsetTop <= b.maxTop,
            `offset=(${step.state.visualOffsetLeft},${step.state.visualOffsetTop}) bounds=${JSON.stringify(b)}`);
          if (step.panReport !== null && step.panReport.clamped) {
            clampedCount += 1;
            check(`${label} step ${s}: clamped reason names a bound`,
              step.panReport.clampReason !== null &&
                step.panReport.clampReason.includes("clamped to [0,"),
              `clampReason=${step.panReport.clampReason}`);
          }
        }
      }
      check(`${label}: panReports match hand-authored expected`,
        deepEqual(result.panReports, exp.panReports),
        `panReports=${JSON.stringify(result.panReports)} expected=${JSON.stringify(exp.panReports)}`);
      check(`${label}: scrollReports match hand-authored expected`,
        deepEqual(result.scrollReports, exp.scrollReports),
        `scrollReports=${JSON.stringify(result.scrollReports)} expected=${JSON.stringify(exp.scrollReports)}`);
      check(`${label}: clampEvidence matches hand-authored expected`,
        deepEqual(result.clampEvidence, exp.clampEvidence),
        `clampEvidence=${JSON.stringify(result.clampEvidence)} expected=${JSON.stringify(exp.clampEvidence)}`);
      clampRows.push(...result.clampEvidence);
    } else if (exp.status === "UNKNOWN" && exp.failedStepIndex !== null) {
      // Mid-replay UNKNOWN (clock regression): the trace stops at the
      // failing event with the state kept as of before it.
      check(`${label}: steps cover events up to the failure`,
        result.steps.length === exp.failedStepIndex + 1,
        `steps=${result.steps.length} failedStepIndex=${exp.failedStepIndex}`);
      check(`${label}: finalState is the pre-failure state`,
        deepEqual(result.finalState, exp.final),
        `finalState=${JSON.stringify(result.finalState)} expected=${JSON.stringify(exp.final)}`);
      const failedStep = result.steps[exp.failedStepIndex];
      check(`${label}: failing step is UNKNOWN`,
        failedStep !== undefined && failedStep.status === "UNKNOWN",
        `failing step status=${failedStep?.status}`);
      check(`${label}: failing step carries no checks`,
        failedStep !== undefined &&
          failedStep.eventChecks.length === 0 &&
          failedStep.contractChecks.length === 0,
        "failing step must carry empty check lists");
      check(`${label}: panReports cover attempted events`,
        result.panReports.length === exp.failedStepIndex + 1,
        `panReports=${result.panReports.length}`);
      check(`${label}: panReports match hand-authored expected`,
        deepEqual(result.panReports, exp.panReports),
        `panReports=${JSON.stringify(result.panReports)} expected=${JSON.stringify(exp.panReports)}`);
      check(`${label}: scrollReports match hand-authored expected`,
        deepEqual(result.scrollReports, exp.scrollReports),
        `scrollReports=${JSON.stringify(result.scrollReports)} expected=${JSON.stringify(exp.scrollReports)}`);
      check(`${label}: no clamp evidence on the failing trace`,
        result.clampEvidence.length === 0,
        `clampEvidence=${JSON.stringify(result.clampEvidence)}`);
    } else {
      // Fail-closed at validation: no replay ran, no states, no steps.
      check(`${label}: initialState null on ${exp.status}`,
        result.initialState === null, "initialState must be null");
      check(`${label}: finalState null on ${exp.status}`,
        result.finalState === null, "finalState must be null");
      check(`${label}: no steps on ${exp.status}`,
        result.steps.length === 0, `steps=${result.steps.length}`);
      check(`${label}: no panReports on ${exp.status}`,
        result.panReports.length === 0, `panReports=${result.panReports.length}`);
      check(`${label}: no scrollReports on ${exp.status}`,
        result.scrollReports.length === 0, `scrollReports=${result.scrollReports.length}`);
      check(`${label}: no clampEvidence on ${exp.status}`,
        result.clampEvidence.length === 0, `clampEvidence=${result.clampEvidence.length}`);
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
            `scrollY=${fs_.scrollY} offsetTop=${fs_.visualOffsetTop} ` +
            `pendingPan=${JSON.stringify(fs_.pendingPan)}`
          : "states=null"),
    );
  }
  check("22 OK evaluations", okCount === 22, `ok=${okCount}`);
  check("4 UNKNOWN evaluations", unknownCount === 4, `unknown=${unknownCount}`);
  check("1 INVALID evaluation", invalidCount === 1, `invalid=${invalidCount}`);
  check("pan steps present", panStepCount === 20, `panSteps=${panStepCount}`);
  check("clamped pan steps present", clampedCount === 8, `clamped=${clampedCount}`);

  const out = {
    analysisSha256,
    determinism: { runs: 2, uniqueHashes: 1, hashes: [analysisSha256] },
    results,
    seed: SEED,
    version: EVENTS_VERSION,
  };
  writeJson(path.join(ROOT, OUT_REL), out);
  writeJson(path.join(ROOT, CLAMP_OUT_REL), {
    rows: clampRows,
    seed: SEED,
    version: EVENTS_VERSION,
  });
  console.log(
    `\nfixtures: ${fixtures.length}, steps checked: ${stepCount}, ` +
      `event checks: ${eventCheckCount}, contract checks: ${contractCheckCount}, ` +
      `pan steps: ${panStepCount}, clamped: ${clampedCount}, ` +
      `OK=${okCount} UNKNOWN=${unknownCount} INVALID=${invalidCount}`,
  );
  console.log(`analysisSha256: ${analysisSha256}`);
  console.log(`wrote ${OUT_REL}`);
  console.log(`wrote ${CLAMP_OUT_REL} (${clampRows.length} clamp rows)`);
  console.log(
    `\nchecks passed: ${passes.length}, checks failed: ${failures.length}`,
  );
  if (failures.length > 0) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(`- ${f}`);
    console.log("\nEvents (TS): FAIL");
    process.exitCode = 1;
  } else {
    console.log("\nEvents (TS): PASS");
    process.exitCode = 0;
  }
}

main().catch((err) => {
  console.error(`runner error: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
