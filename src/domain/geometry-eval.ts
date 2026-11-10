/**
 * P021 ViewportShift — formal occlusion / visibility geometry evaluator
 * (T007, S2).
 *
 * Contract: P021_PROJECT_BOOK.md §4.4, §6.1–§6.2 (SPEC_VERSION 1.0.0)
 * and P021_IMPLEMENTATION_PLAN.md §5 (T007), §6.
 *
 * What this module is: the formal T007 evaluator. It layers the T003
 * rectangle geometry (`geometry.ts`: triple intersection, clipping,
 * visible area/ratio, bottomGap, anchorDrift) on top of the T005
 * formal three-mode evaluator (`modes.ts`: schema validation, state
 * replay, per-step mode-contract checks) and adds, per step:
 *
 * 1. The surface rect and the expected-anchor rect for the replayed
 *    state (bottom anchor keys off the layout height; the expected
 *    anchor keys off the visual bottom edge — PROJECT_BOOK §4.4).
 * 2. The full §4.4 metric set via `computeMetrics`, plus the eleven
 *    frozen geometry contract checks (`geometryContractChecksFor`),
 *    re-derived from the rects. A failed check fails the step closed
 *    with UNKNOWN (`geometry_contract_violation:<check-name>`) and
 *    stops the evaluation; the checks are theorems of the
 *    construction, so a failure means the implementation disagrees
 *    with its own definition.
 * 3. Per-step failure-predicate evaluation (`evaluatePredicates`),
 *    in fixture order.
 *
 * Entry points:
 * - `evaluateGeometry(input, scenarioSha256)`: schema-first entry for
 *   an unknown input value. INVALID / UNKNOWN inputs never reach the
 *   state machine; their states are null and their steps are empty.
 *   The first validation issue code is the evaluation `reason`.
 * - `evaluateScenarioGeometry(scenario, scenarioSha256)`: the same
 *   evaluation for an already-validated scenario.
 * - `evaluateDirectGeometry(fixture, scenarioSha256)`: rect-level
 *   evaluation without a replay (unit-level geometry: touching edges,
 *   zero area, overlap without double deduction).
 *
 * Layering notes (frozen upstream decisions, carried unchanged):
 * - In `resizes-visual`, KEYBOARD_CLOSE restores `visualHeight` but
 *   does not reset `visualOffsetTop` (T005). A pan applied while the
 *   keyboard was open therefore leaves a retained visual offset after
 *   the close, which shows up here as non-zero anchorDrift and a
 *   positive bottomGap (fixture T007-scen-06 pins this).
 * - `keyboardObscuredArea` is the triple intersection |S ∩ V ∩ K|
 *   while the keyboard is visible (T003). In `resizes-visual` /
 *   `resizes-content` the keyboard rect is disjoint from V, so
 *   obscuration is 0 there and an element outside V counts as
 *   *clipped*, not obscured. After a DELAYED_VISUAL_PAN in
 *   `resizes-visual`, V can overlap K and the overlap is counted
 *   once (fixture T007-scen-07 pins this).
 * - Scenario steps cover successful transitions only (the S0
 *   convention): a transition that fails closed contributes no
 *   geometry step, and the final state/metrics are those of the last
 *   successful step.
 *
 * Pure functions only: no wall clock, no timers, no randomness, no
 * I/O, no date/time access. Hashing lives in the scripts
 * (node:crypto), not here, so this file stays usable in the browser
 * bundle. The S0 analysis (`analyzeScenario` in geometry.ts) is
 * untouched by this module.
 */

import { evaluateScenarioModes } from "./modes.ts";
import { validateScenario } from "./validate.ts";
import type { Scenario, ValidationIssue } from "./types.ts";
import {
  computeGeometryDirect,
  computeMetrics,
  evaluatePredicates,
  expectedAnchorRect,
  geometryContractChecksFor,
  surfaceRectFor,
} from "./geometry.ts";
import type {
  DirectGeometryInput,
  GeometryContractCheck,
  GeometryMetrics,
} from "./geometry.ts";
import type {
  PanReport,
  RectMilli,
  ViewportState,
} from "./viewport-state.ts";

export const GEOMETRY_VERSION = "geometry/v1";
export const SEED = "P021-VIEWPORTSHIFT-S0-2026-11-10";

export type GeometryEvaluationStatus = "OK" | "UNKNOWN" | "INVALID";
export type GeometryStepStatus = "OK" | "UNKNOWN" | "INVALID";

export interface GeometryStep {
  index: number;
  eventId: string;
  eventType: string;
  atMs: number;
  status: GeometryStepStatus;
  reason: string | null;
  /** State after the event. */
  state: ViewportState;
  surfaceRect: RectMilli;
  expectedAnchorRect: RectMilli;
  metrics: GeometryMetrics | null;
  contractChecks: Array<GeometryContractCheck>;
  failedPredicates: Array<string>;
}

export interface GeometryEvaluation {
  scenarioId: string;
  scenarioSha256: string;
  seed: string;
  mode: string;
  status: GeometryEvaluationStatus;
  /** First validation issue code, transition reason, or contract check. */
  reason: string | null;
  validationIssues: Array<ValidationIssue>;
  failedEventId: string | null;
  failedStepIndex: number | null;
  /** Null exactly when validation rejected the input (no replay ran). */
  initialState: ViewportState | null;
  finalState: ViewportState | null;
  steps: Array<GeometryStep>;
  panReports: Array<PanReport | null>;
  /** Metrics of the last geometry step, or null when there is none. */
  finalMetrics: GeometryMetrics | null;
  /** Fired predicates of the last OK step, or [] when there is none. */
  finalFailedPredicates: Array<string>;
}

/** Rect-level fixture (no replay): the `kind: "direct"` wire shape. */
export interface DirectGeometryFixture {
  case_id: string;
  kind: "direct";
  seed: string;
  surface: RectMilli;
  visual: RectMilli;
  keyboard: RectMilli;
  keyboardVisible: boolean;
  expectedAnchor: RectMilli;
}

export interface DirectGeometryResult {
  caseId: string;
  kind: "direct";
  scenarioSha256: string;
  seed: string;
  status: "OK" | "INVALID";
  reason: string | null;
  surfaceRect: RectMilli;
  visualRect: RectMilli;
  keyboardRect: RectMilli;
  keyboardVisible: boolean;
  expectedAnchorRect: RectMilli;
  metrics: GeometryMetrics | null;
  contractChecks: Array<GeometryContractCheck>;
}

/**
 * Deterministic canonical JSON: sorted keys, fixed array order, no
 * spaces — identical to the S0 geometry module's canonicalisation.
 */
export function canonicalGeometryJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalGeometryJson).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonicalGeometryJson(record[k])}`)
    .join(",")}}`;
}

/**
 * Rect-level evaluation: compute the §4.4 metrics for one
 * (surface, visual, keyboard) triple and run the frozen contract
 * checks over them. No state machine is involved.
 */
export function evaluateDirectGeometry(
  fixture: DirectGeometryFixture,
  scenarioSha256: string,
): DirectGeometryResult {
  const input: DirectGeometryInput = {
    surface: fixture.surface,
    visual: fixture.visual,
    keyboard: fixture.keyboard,
    keyboardVisible: fixture.keyboardVisible,
    expectedAnchor: fixture.expectedAnchor,
  };
  const computed = computeGeometryDirect(input);
  const checks =
    computed.status === "OK" && computed.metrics !== null
      ? geometryContractChecksFor(input, computed.metrics)
      : [];
  return {
    caseId: fixture.case_id,
    kind: "direct",
    scenarioSha256,
    seed: fixture.seed,
    status: computed.status,
    reason: computed.reason,
    surfaceRect: fixture.surface,
    visualRect: fixture.visual,
    keyboardRect: fixture.keyboard,
    keyboardVisible: fixture.keyboardVisible,
    expectedAnchorRect: fixture.expectedAnchor,
    metrics: computed.metrics,
    contractChecks: checks,
  };
}

/**
 * Evaluate a validated scenario: replay it through the formal
 * three-mode evaluator, then compute the §4.4 geometry for every
 * successful step. Steps cover successful transitions only; the
 * evaluation stops at the first step whose geometry is INVALID or
 * whose contract checks fail.
 */
export function evaluateScenarioGeometry(
  scenario: Scenario,
  scenarioSha256: string,
): GeometryEvaluation {
  const modesEval = evaluateScenarioModes(scenario, scenarioSha256);
  const steps: Array<GeometryStep> = [];
  let status: GeometryEvaluationStatus = modesEval.status;
  let reason: string | null = modesEval.reason;
  let failedEventId: string | null = modesEval.failedEventId;
  let failedStepIndex: number | null = modesEval.failedStepIndex;
  for (let i = 0; i < modesEval.steps.length; i++) {
    const modeStep = modesEval.steps[i];
    if (modeStep.status !== "OK") break;
    const state = modeStep.state;
    const surface = surfaceRectFor(scenario.layout, state);
    const expected = expectedAnchorRect(scenario.layout, state);
    const computed = computeMetrics(scenario.layout, state);
    if (computed.status !== "OK" || computed.metrics === null) {
      steps.push({
        index: i,
        eventId: modeStep.eventId,
        eventType: modeStep.eventType,
        atMs: modeStep.atMs,
        status: "INVALID",
        reason: computed.reason,
        state,
        surfaceRect: surface,
        expectedAnchorRect: expected,
        metrics: null,
        contractChecks: [],
        failedPredicates: [],
      });
      status = "INVALID";
      reason = computed.reason;
      failedEventId = modeStep.eventId;
      failedStepIndex = i;
      break;
    }
    const visualRect: RectMilli = {
      x: state.visualOffsetLeft,
      y: state.visualOffsetTop,
      width: state.visualWidth,
      height: state.visualHeight,
    };
    const checks = geometryContractChecksFor(
      {
        surface,
        visual: visualRect,
        keyboard: state.keyboardRect,
        keyboardVisible: state.keyboardVisible,
        expectedAnchor: expected,
      },
      computed.metrics,
    );
    const firstFailed = checks.find((c) => !c.passed);
    if (firstFailed !== undefined) {
      steps.push({
        index: i,
        eventId: modeStep.eventId,
        eventType: modeStep.eventType,
        atMs: modeStep.atMs,
        status: "UNKNOWN",
        reason: `geometry_contract_violation:${firstFailed.name}`,
        state,
        surfaceRect: surface,
        expectedAnchorRect: expected,
        metrics: computed.metrics,
        contractChecks: checks,
        failedPredicates: [],
      });
      status = "UNKNOWN";
      reason = `geometry_contract_violation:${firstFailed.name}`;
      failedEventId = modeStep.eventId;
      failedStepIndex = i;
      break;
    }
    const fired = evaluatePredicates(
      computed.metrics,
      scenario.failure_predicates,
    );
    steps.push({
      index: i,
      eventId: modeStep.eventId,
      eventType: modeStep.eventType,
      atMs: modeStep.atMs,
      status: "OK",
      reason: null,
      state,
      surfaceRect: surface,
      expectedAnchorRect: expected,
      metrics: computed.metrics,
      contractChecks: checks,
      failedPredicates: fired,
    });
  }
  const lastStep = steps.length > 0 ? steps[steps.length - 1] : null;
  return {
    scenarioId: scenario.scenario_id,
    scenarioSha256,
    seed: scenario.seed,
    mode: scenario.mode,
    status,
    reason,
    validationIssues: [],
    failedEventId,
    failedStepIndex,
    initialState: modesEval.initialState,
    finalState: modesEval.finalState,
    steps,
    panReports: modesEval.panReports,
    finalMetrics: lastStep !== null ? lastStep.metrics : null,
    finalFailedPredicates:
      lastStep !== null && lastStep.status === "OK"
        ? lastStep.failedPredicates
        : [],
  };
}

/**
 * Full geometry entry point for an unknown input value: validate first
 * (T004 frozen rules), then evaluate only when VALID. INVALID and
 * UNKNOWN inputs never reach the state machine; their states are null
 * and their steps are empty. `scenarioSha256` is supplied by the
 * caller (hashing lives in the scripts, not in this module).
 */
export function evaluateGeometry(
  input: unknown,
  scenarioSha256: string,
): GeometryEvaluation {
  const record =
    typeof input === "object" && input !== null && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : null;
  const scenarioId =
    record !== null && typeof record.scenario_id === "string"
      ? record.scenario_id
      : "";
  const seed =
    record !== null && typeof record.seed === "string" ? record.seed : "";
  const mode =
    record !== null && typeof record.mode === "string" ? record.mode : "";
  const validated = validateScenario(input);
  if (validated.outcome !== "VALID" || validated.scenario === null) {
    return {
      scenarioId,
      scenarioSha256,
      seed,
      mode,
      // VALID is unreachable here (the validator only returns a null
      // scenario with a non-VALID outcome); fail closed to UNKNOWN.
      status: validated.outcome === "VALID" ? "UNKNOWN" : validated.outcome,
      reason:
        validated.issues.length > 0
          ? validated.issues[0].code
          : "invalid_input",
      validationIssues: validated.issues,
      failedEventId: null,
      failedStepIndex: null,
      initialState: null,
      finalState: null,
      steps: [],
      panReports: [],
      finalMetrics: null,
      finalFailedPredicates: [],
    };
  }
  return evaluateScenarioGeometry(validated.scenario, scenarioSha256);
}
