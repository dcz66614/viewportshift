#!/usr/bin/env node
/**
 * T006 acceptance runner: `npm run test:event-order`.
 *
 * Order and determinism checks for the event model, over and above
 * the fixture expectations in `npm run test:events`:
 * - equal timestamps keep fixture array order (open -> pan -> scroll
 *   at the same `atMs` yields the pan-before-scroll trace, not a
 *   time-sorted one);
 * - strictly increasing timestamps replay in order and advance the
 *   event clock step by step;
 * - a clock regression fails closed at the regressing event with the
 *   pre-regression state kept;
 * - event order matters: the same multiset of events in a different
 *   array order produces a different trace (pan before open clamps
 *   against the full-height bounds; pan after open clamps against
 *   the shrunken bounds);
 * - replay is byte-identical across two full runs (canonical JSON of
 *   the whole core document hashes identically);
 * - re-running one scenario twice through the public entry point
 *   yields byte-identical traces.
 *
 * Scenarios here are built in-script from the frozen schema shape
 * (synthetic, fixed seed, no fixture files) so the order properties
 * are tested independently of the fixture set. Writes no evidence
 * file. Exits 0 only when every check passes.
 */
import {
  SEED,
  deepEqual,
  evaluateTs,
  loadJson,
  loadT006Domain,
  sha256Hex,
} from "./t006-lib.mjs";
import { listEventsFixtures } from "./t006-lib.mjs";

const failures = [];
const passes = [];

function check(name, ok, detail) {
  if (ok) passes.push(name);
  else failures.push(detail ? `${name} — ${detail}` : name);
  return ok;
}

function baseScenario(scenarioId, events, mode = "resizes-visual") {
  return {
    scenario_id: scenarioId,
    seed: SEED,
    layout: {
      template: "chat-input",
      anchor: "bottom",
      offsetMilli: 0,
      xMilli: 0,
      widthMilli: 390000,
      heightMilli: 56000,
    },
    viewport: { layoutWidth: 390000, layoutHeight: 844000 },
    keyboard: { heightMilli: 300000 },
    mode,
    events,
    failure_predicates: [],
    limits: { maxEvents: 8, maxPanMilli: 500000, scale: 1 },
    profile: { scale: 1 },
  };
}

async function main() {
  const { events } = await loadT006Domain();
  const trace = (scenario) =>
    events.evaluateEvents(
      scenario,
      sha256Hex(events.canonicalEventJson(scenario)),
    );

  // 1. Equal timestamps keep array order.
  const equalTs = trace(
    baseScenario("order-equal-timestamps", [
      { type: "KEYBOARD_OPEN", id: "e1", atMs: 100, keyboardHeight: 300000 },
      { type: "DELAYED_VISUAL_PAN", id: "e2", atMs: 100, dx: 0, dy: 50000 },
      { type: "SCROLL", id: "e3", atMs: 100, dx: 0, dy: 10000 },
    ]),
  );
  check("equal timestamps: status OK", equalTs.status === "OK",
    `status=${equalTs.status} reason=${equalTs.reason}`);
  check("equal timestamps: steps in array order",
    deepEqual(equalTs.steps.map((s) => s.eventId), ["e1", "e2", "e3"]),
    `order=${JSON.stringify(equalTs.steps.map((s) => s.eventId))}`);
  check("equal timestamps: clock stays 100 on every step",
    equalTs.steps.every((s) => s.state.eventClock === 100),
    `clocks=${JSON.stringify(equalTs.steps.map((s) => s.state.eventClock))}`);
  check("equal timestamps: pan applied before scroll",
    equalTs.finalState.visualOffsetTop === 50000 &&
      equalTs.finalState.scrollY === 10000,
    `offsetTop=${equalTs.finalState?.visualOffsetTop} scrollY=${equalTs.finalState?.scrollY}`);

  // 2. Strictly increasing timestamps advance the clock step by step.
  const increasing = trace(
    baseScenario("order-increasing", [
      { type: "KEYBOARD_OPEN", id: "e1", atMs: 0, keyboardHeight: 300000 },
      { type: "SCROLL", id: "e2", atMs: 50, dx: 0, dy: 30000 },
      { type: "DELAYED_VISUAL_PAN", id: "e3", atMs: 100, dx: 0, dy: 50000 },
      { type: "VIEWPORT_SETTLED", id: "e4", atMs: 150 },
      { type: "KEYBOARD_CLOSE", id: "e5", atMs: 200 },
    ]),
  );
  check("increasing timestamps: status OK", increasing.status === "OK",
    `status=${increasing.status} reason=${increasing.reason}`);
  check("increasing timestamps: clock advances 0/50/100/150/200",
    deepEqual(increasing.steps.map((s) => s.state.eventClock), [0, 50, 100, 150, 200]),
    `clocks=${JSON.stringify(increasing.steps.map((s) => s.state.eventClock))}`);
  check("increasing timestamps: ev_clock_monotonic passes on every step",
    increasing.steps.every((s) =>
      s.eventChecks.some((c) => c.name === "ev_clock_monotonic" && c.passed)),
    "a step lacks a passing ev_clock_monotonic check");
  check("increasing timestamps: settled clears pendingPan, close keeps offset",
    increasing.finalState.pendingPan.dx === 0 &&
      increasing.finalState.pendingPan.dy === 0 &&
      increasing.finalState.visualOffsetTop === 50000,
    `pendingPan=${JSON.stringify(increasing.finalState?.pendingPan)} offsetTop=${increasing.finalState?.visualOffsetTop}`);

  // 3. Clock regression fails closed. The frozen T004 validator
  // catches it first (validation UNKNOWN, no replay runs); the
  // replay layer itself also stops at the regressing event when
  // called directly with a pre-built scenario.
  const regressionScenario = baseScenario("order-regression", [
    { type: "KEYBOARD_OPEN", id: "e1", atMs: 200, keyboardHeight: 300000 },
    { type: "DELAYED_VISUAL_PAN", id: "e2", atMs: 100, dx: 0, dy: 50000 },
    { type: "SCROLL", id: "e3", atMs: 300, dx: 0, dy: 1000 },
  ]);
  const regression = trace(regressionScenario);
  check("regression: status UNKNOWN", regression.status === "UNKNOWN",
    `status=${regression.status}`);
  check("regression: reason event_clock_regression",
    regression.reason === "event_clock_regression",
    `reason=${regression.reason}`);
  check("regression: validator catches it before any replay",
    regression.steps.length === 0 &&
      regression.initialState === null &&
      regression.finalState === null &&
      regression.validationIssues.length > 0 &&
      regression.validationIssues[0].code === "event_clock_regression",
    `steps=${regression.steps.length} issues=${JSON.stringify(regression.validationIssues)}`);
  const replayRegression = events.evaluateScenarioEvents(
    regressionScenario,
    sha256Hex(events.canonicalEventJson(regressionScenario)),
  );
  check("regression (direct replay): status UNKNOWN",
    replayRegression.status === "UNKNOWN",
    `status=${replayRegression.status}`);
  check("regression (direct replay): failed at step 1 (e2)",
    replayRegression.failedStepIndex === 1 && replayRegression.failedEventId === "e2",
    `failedStepIndex=${replayRegression.failedStepIndex} failedEventId=${replayRegression.failedEventId}`);
  check("regression (direct replay): replay stops, later event never runs",
    replayRegression.steps.length === 2 &&
      replayRegression.steps[1].status === "UNKNOWN" &&
      replayRegression.finalState.eventClock === 200,
    `steps=${replayRegression.steps.length} finalClock=${replayRegression.finalState?.eventClock}`);
  check("regression (direct replay): final state is the pre-regression state",
    replayRegression.finalState.visualHeight === 544000 &&
      replayRegression.finalState.visualOffsetTop === 0,
    `visualHeight=${replayRegression.finalState?.visualHeight} offsetTop=${replayRegression.finalState?.visualOffsetTop}`);

  // 4. Event order matters: same events, different array order.
  const panAfterOpen = trace(
    baseScenario("order-pan-after-open", [
      { type: "KEYBOARD_OPEN", id: "e1", atMs: 100, keyboardHeight: 300000 },
      { type: "DELAYED_VISUAL_PAN", id: "e2", atMs: 200, dx: 0, dy: 400000 },
    ]),
  );
  const panBeforeOpen = trace(
    baseScenario("order-pan-before-open", [
      { type: "DELAYED_VISUAL_PAN", id: "e1", atMs: 100, dx: 0, dy: 400000 },
      { type: "KEYBOARD_OPEN", id: "e2", atMs: 200, keyboardHeight: 300000 },
    ]),
  );
  check("order matters: both traces OK",
    panAfterOpen.status === "OK" && panBeforeOpen.status === "OK",
    `after=${panAfterOpen.status} before=${panBeforeOpen.status}`);
  check("order matters: pan after open clamps to the shrunken bound (300000)",
    panAfterOpen.finalState.visualOffsetTop === 300000 &&
      panAfterOpen.panReports[1].clamped === true,
    `offsetTop=${panAfterOpen.finalState?.visualOffsetTop} clamped=${panAfterOpen.panReports[1]?.clamped}`);
  check("order matters: pan before open clamps to the full-height bound (0)",
    panBeforeOpen.finalState.visualOffsetTop === 0 &&
      panBeforeOpen.panReports[0].clamped === true &&
      panBeforeOpen.panReports[0].clampReason === "dy clamped to [0, 0]",
    `offsetTop=${panBeforeOpen.finalState?.visualOffsetTop} reason=${panBeforeOpen.panReports[0]?.clampReason}`);
  check("order matters: the two traces differ",
    !deepEqual(
      events.canonicalEventJson(panAfterOpen),
      events.canonicalEventJson(panBeforeOpen),
    ),
    "traces are identical despite different event order");

  // 5. Byte-identical replay: whole fixture set twice, same hash.
  const files = listEventsFixtures();
  const fixtures = files.map(loadJson);
  const run1 = evaluateTs(events, fixtures);
  const run2 = evaluateTs(events, fixtures);
  check("determinism: two full runs over all fixtures hash identically",
    run1.analysisSha256 === run2.analysisSha256,
    `run1=${run1.analysisSha256} run2=${run2.analysisSha256}`);
  check("determinism: canonical core JSON is byte-identical across runs",
    events.canonicalEventJson(run1.core) === events.canonicalEventJson(run2.core),
    "canonical JSON differs between runs");

  // 6. One scenario twice through the public entry point.
  const once = trace(baseScenario("order-repeat", [
    { type: "KEYBOARD_OPEN", id: "e1", atMs: 100, keyboardHeight: 300000 },
    { type: "DELAYED_VISUAL_PAN", id: "e2", atMs: 200, dx: 0, dy: 100000 },
    { type: "VIEWPORT_SETTLED", id: "e3", atMs: 300 },
  ]));
  const twice = trace(baseScenario("order-repeat", [
    { type: "KEYBOARD_OPEN", id: "e1", atMs: 100, keyboardHeight: 300000 },
    { type: "DELAYED_VISUAL_PAN", id: "e2", atMs: 200, dx: 0, dy: 100000 },
    { type: "VIEWPORT_SETTLED", id: "e3", atMs: 300 },
  ]));
  check("repeat: same scenario replays byte-identically",
    events.canonicalEventJson(once) === events.canonicalEventJson(twice),
    "traces differ between identical replays");

  console.log(
    `\nchecks passed: ${passes.length}, checks failed: ${failures.length}`,
  );
  if (failures.length > 0) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(`- ${f}`);
    console.log("\nEvent order: FAIL");
    process.exitCode = 1;
  } else {
    console.log("\nEvent order: PASS");
    process.exitCode = 0;
  }
}

main().catch((err) => {
  console.error(`runner error: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
