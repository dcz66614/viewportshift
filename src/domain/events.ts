/**
 * P021 ViewportShift — delayed-pan / scroll / keyboard / settled event
 * model (T006, S1).
 *
 * Contract: P021_PROJECT_BOOK.md §4.1–§4.3, §3.4 (SPEC_VERSION 1.0.0)
 * and P021_IMPLEMENTATION_PLAN.md §5 (T006), §6.
 *
 * What this module is: the deterministic event-model layer on top of
 * the T005 formal mode evaluator (`modes.ts`, itself built on the T002
 * PoC state machine `viewport-state.ts` and the frozen T004 Schema).
 * It replays a validated `viewportshift.scenario/v1` scenario event by
 * event and records, for every step, the event-timing facts, the
 * requested-vs-applied pan/scroll pair, and the clamp bounds that
 * governed that step — so any trace can be re-checked without
 * re-running the model.
 *
 * Event semantics (all pure functions, fixed-point integers only):
 * - Events are processed in fixture array order; `atMs` must be
 *   monotonically non-decreasing. Equal timestamps keep array order
 *   (§4.3). A clock regression fails the step closed with UNKNOWN
 *   (`event_clock_regression`) and the replay stops with the state
 *   kept as of before the regressing event.
 * - `DELAYED_VISUAL_PAN` moves only the visual offset, clamped to
 *   `[0, maxLeft] x [0, maxTop]` where `maxLeft =
 *   max(0, layoutWidth - visualWidth)` and `maxTop =
 *   max(0, layoutHeight - visualHeight)` are computed from the state
 *   *before* the pan. Requested and applied deltas, the bounds, the
 *   clamped flag and the clamp reason are recorded on every pan step
 *   and collected into `clampEvidence`. The pan never changes the
 *   `mode` field: it is a pressure event, not a fourth mode (§4.2).
 *   MVP note: `visualWidth` always equals `layoutWidth` (no pinch
 *   zoom, scale fixed at 1), so `maxLeft` is 0 in every mode and any
 *   non-zero horizontal pan is fully clamped; that is a modelled
 *   consequence, not an error, and fixtures pin it.
 * - `SCROLL` updates only the independent scroll offsets, lower-
 *   bounded at 0; it never moves the visual offset (§4.1). The
 *   requested-vs-applied scroll pair is recorded as a `ScrollReport`
 *   (clamped exactly when the lower bound bites), mirroring the pan
 *   report shape so requested/applied pairs are checkable for both
 *   event kinds.
 * - `VIEWPORT_SETTLED` clears `pendingPan` to zero and changes
 *   nothing else. `pendingPan` therefore holds the applied pan delta
 *   of the most recent `DELAYED_VISUAL_PAN` from that pan until the
 *   next `VIEWPORT_SETTLED` (or a mode transition that zeroes the
 *   offsets, e.g. `resizes-content` open).
 * - `KEYBOARD_OPEN` / `KEYBOARD_CLOSE` follow the T005 mode
 *   evaluator exactly; this module adds only event-level checks
 *   (timing, mode stability, offset/scroll/pan lifecycle) on top.
 *
 * Upstream legacy decision (T005 report §1.2/§6; the project book is
 * silent): MAINTAIN the PoC behaviour that `resizes-visual`
 * `KEYBOARD_CLOSE` restores `visualHeight` but does NOT reset
 * `visualOffsetTop`. Reasons: (1) both frozen Oracles mirror that
 * behaviour — `oracle/python/modes_oracle.py` (rv close check
 * `rv_offsets_unchanged`) and `oracle/python/geometry_oracle.py` —
 * and T006 is forbidden from modifying either Oracle file, so
 * changing the TypeScript side alone would break modes parity 41/41
 * and the S0 gate; (2) the S0 gate pins the PoC transition
 * arithmetic; (3) the retained offset is observable, deterministic,
 * and pinned by fixture (`events-rv-open-pan-close-retained.json`:
 * close leaves `visualOffsetTop=100000`, `pendingPan={0,100000}`).
 * Consequence, stated explicitly: after such a close the retained
 * offset can exceed the then-legal pan bound (`layoutHeight -
 * visualHeight = 0` once the height is restored). That is not a clamp
 * violation — clamp bounds govern pan steps only, computed from the
 * pre-pan state — but a later pan from that retained offset is
 * clamped against the restored bounds, which the fixtures also pin
 * (`events-rv-reopen-pan.json`). `VIEWPORT_SETTLED` after the close
 * clears `pendingPan` but leaves the retained offset in place.
 *
 * Pure functions only: no wall clock, no timers, no randomness, no
 * I/O, no date/time access. Hashing lives in the scripts
 * (node:crypto), not here, so this file stays usable in the browser
 * bundle. It does not modify the frozen Schema (`types.ts` /
 * `validate.ts`), the T005 mode semantics (`modes.ts`), or any S0
 * golden / Oracle result.
 */

import { evaluateModeTransition } from "./modes.ts";
import type { ModeContractCheck } from "./modes.ts";
import type { Scenario, ValidationIssue } from "./types.ts";
import { validateScenario } from "./validate.ts";
import { initialState } from "./viewport-state.ts";
import type {
  PanReport,
  ViewportEvent,
  ViewportState,
} from "./viewport-state.ts";

export const EVENTS_VERSION = "events/v1";
export const SEED = "P021-VIEWPORTSHIFT-S0-2026-11-10";

export type EventTraceStatus = "OK" | "UNKNOWN" | "INVALID";
export type EventStepStatus = "OK" | "UNKNOWN";

/** One frozen event-model check: name in fixed order, pass/fail. */
export interface EventCheck {
  name: string;
  passed: boolean;
}

/** Legal visual-offset range governing one pan step. */
export interface ClampBounds {
  maxLeft: number;
  maxTop: number;
}

/** Requested-vs-applied scroll pair, mirroring PanReport. */
export interface ScrollReport {
  requestedDx: number;
  requestedDy: number;
  appliedDx: number;
  appliedDy: number;
  clamped: boolean;
  clampReason: string | null;
}

export interface EventStep {
  index: number;
  eventId: string;
  eventType: string;
  atMs: number;
  status: EventStepStatus;
  reason: string | null;
  /** State after the event; state before it when the step is UNKNOWN. */
  state: ViewportState;
  panReport: PanReport | null;
  scrollReport: ScrollReport | null;
  /** Non-null exactly for DELAYED_VISUAL_PAN steps. */
  clampBounds: ClampBounds | null;
  eventChecks: Array<EventCheck>;
  contractChecks: Array<ModeContractCheck>;
}

/** One clamp-evidence row: a pan step's requested/applied对照. */
export interface ClampEvidenceEntry {
  scenarioId: string;
  stepIndex: number;
  eventId: string;
  requestedDx: number;
  requestedDy: number;
  appliedDx: number;
  appliedDy: number;
  maxLeft: number;
  maxTop: number;
  clamped: boolean;
  clampReason: string | null;
}

export interface EventTrace {
  scenarioId: string;
  scenarioSha256: string;
  seed: string;
  mode: string;
  status: EventTraceStatus;
  /** First validation issue code, transition reason, or event check. */
  reason: string | null;
  validationIssues: Array<ValidationIssue>;
  failedEventId: string | null;
  failedStepIndex: number | null;
  /** Null exactly when validation rejected the input (no replay ran). */
  initialState: ViewportState | null;
  finalState: ViewportState | null;
  steps: Array<EventStep>;
  panReports: Array<PanReport | null>;
  scrollReports: Array<ScrollReport | null>;
  clampEvidence: Array<ClampEvidenceEntry>;
}

export interface EventTransitionResult {
  status: EventStepStatus;
  /** Next state on OK; the unchanged input state on UNKNOWN. */
  state: ViewportState;
  reason: string | null;
  panReport: PanReport | null;
  scrollReport: ScrollReport | null;
  clampBounds: ClampBounds | null;
  eventChecks: Array<EventCheck>;
  contractChecks: Array<ModeContractCheck>;
}

/**
 * Deterministic canonical JSON: sorted keys, fixed array order, no
 * spaces — identical to the S0 geometry / T005 modes canonicalisation.
 */
export function canonicalEventJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalEventJson).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonicalEventJson(record[k])}`)
    .join(",")}}`;
}

function clampInt(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function check(name: string, passed: boolean): EventCheck {
  return { name, passed };
}

/**
 * Legal visual-offset bounds from the state before a pan:
 * maxLeft = max(0, layoutWidth - visualWidth),
 * maxTop = max(0, layoutHeight - visualHeight).
 */
export function clampBoundsFor(state: ViewportState): ClampBounds {
  return {
    maxLeft:
      state.layoutWidth - state.visualWidth < 0
        ? 0
        : state.layoutWidth - state.visualWidth,
    maxTop:
      state.layoutHeight - state.visualHeight < 0
        ? 0
        : state.layoutHeight - state.visualHeight,
  };
}

/**
 * Pure pan clamp: apply (dx, dy) to the pre-pan offsets under the
 * pre-pan bounds and report requested vs applied plus the reason.
 * The reason strings match the T002 PoC / T005 contract wording
 * exactly (`dx clamped to [0, N]` / `dy clamped to [0, N]`).
 */
export function panClamp(
  prev: ViewportState,
  dx: number,
  dy: number,
): {
  bounds: ClampBounds;
  appliedDx: number;
  appliedDy: number;
  clamped: boolean;
  clampReason: string | null;
} {
  const bounds = clampBoundsFor(prev);
  const newLeft = clampInt(prev.visualOffsetLeft + dx, 0, bounds.maxLeft);
  const newTop = clampInt(prev.visualOffsetTop + dy, 0, bounds.maxTop);
  const appliedDx = newLeft - prev.visualOffsetLeft;
  const appliedDy = newTop - prev.visualOffsetTop;
  const reasons: Array<string> = [];
  if (appliedDx !== dx) {
    reasons.push(`dx clamped to [0, ${bounds.maxLeft}]`);
  }
  if (appliedDy !== dy) {
    reasons.push(`dy clamped to [0, ${bounds.maxTop}]`);
  }
  return {
    bounds,
    appliedDx,
    appliedDy,
    clamped: reasons.length > 0,
    clampReason: reasons.length > 0 ? reasons.join("; ") : null,
  };
}

/**
 * Pure scroll clamp: scroll offsets are lower-bounded at 0 only; the
 * report records requested vs applied and the reason when the bound
 * bites, mirroring the pan report shape.
 */
export function scrollClamp(
  prev: ViewportState,
  dx: number,
  dy: number,
): ScrollReport {
  const newX = prev.scrollX + dx < 0 ? 0 : prev.scrollX + dx;
  const newY = prev.scrollY + dy < 0 ? 0 : prev.scrollY + dy;
  const appliedDx = newX - prev.scrollX;
  const appliedDy = newY - prev.scrollY;
  const reasons: Array<string> = [];
  if (appliedDx !== dx) {
    reasons.push("dx clamped to [0, +inf)");
  }
  if (appliedDy !== dy) {
    reasons.push("dy clamped to [0, +inf)");
  }
  return {
    requestedDx: dx,
    requestedDy: dy,
    appliedDx,
    appliedDy,
    clamped: reasons.length > 0,
    clampReason: reasons.length > 0 ? reasons.join("; ") : null,
  };
}

/**
 * The frozen event-model checks for one successful transition, in
 * fixed order: three generic checks first (clock advanced, clock
 * monotonic, mode unchanged), then the event-type specific checks.
 * Every check is an integer equality over (prev, next, event) plus
 * the reports this layer computed; the mode-contract checks from
 * T005 run separately and are carried alongside.
 */
export function eventChecksFor(
  prev: ViewportState,
  next: ViewportState,
  event: ViewportEvent,
  panReport: PanReport | null,
  scrollReport: ScrollReport | null,
  clampBounds: ClampBounds | null,
): Array<EventCheck> {
  const checks: Array<EventCheck> = [
    check("ev_clock_advanced", next.eventClock === event.atMs),
    check("ev_clock_monotonic", event.atMs >= prev.eventClock),
    check("ev_mode_unchanged", next.mode === prev.mode),
  ];
  const visualUnchanged =
    next.visualWidth === prev.visualWidth &&
    next.visualHeight === prev.visualHeight &&
    next.visualOffsetLeft === prev.visualOffsetLeft &&
    next.visualOffsetTop === prev.visualOffsetTop;
  const scrollUnchanged =
    next.scrollX === prev.scrollX && next.scrollY === prev.scrollY;

  switch (event.type) {
    case "KEYBOARD_OPEN": {
      checks.push(
        check("ev_open_visible", next.keyboardVisible === true),
        check(
          "ev_open_pending_unchanged",
          next.pendingPan.dx === prev.pendingPan.dx &&
            next.pendingPan.dy === prev.pendingPan.dy,
        ),
        check("ev_open_scroll_unchanged", scrollUnchanged),
      );
      break;
    }

    case "KEYBOARD_CLOSE": {
      checks.push(
        check("ev_close_hidden", next.keyboardVisible === false),
        // Legacy decision (see header): resizes-visual close restores
        // the height but retains the visual offset and pendingPan.
        check(
          "ev_close_offsets_retained",
          next.visualOffsetLeft === prev.visualOffsetLeft &&
            next.visualOffsetTop === prev.visualOffsetTop,
        ),
        check(
          "ev_close_pending_retained",
          next.pendingPan.dx === prev.pendingPan.dx &&
            next.pendingPan.dy === prev.pendingPan.dy,
        ),
        check("ev_close_scroll_unchanged", scrollUnchanged),
      );
      break;
    }

    case "SCROLL": {
      const expected =
        scrollReport === null ? null : scrollClamp(prev, event.dx, event.dy);
      checks.push(
        check(
          "ev_scroll_applied_matches_report",
          scrollReport !== null &&
            expected !== null &&
            next.scrollX === prev.scrollX + scrollReport.appliedDx &&
            next.scrollY === prev.scrollY + scrollReport.appliedDy &&
            scrollReport.appliedDx === expected.appliedDx &&
            scrollReport.appliedDy === expected.appliedDy,
        ),
        check(
          "ev_scroll_nonnegative",
          next.scrollX >= 0 && next.scrollY >= 0,
        ),
        check("ev_scroll_visual_untouched", visualUnchanged),
        check(
          "ev_scroll_pending_unchanged",
          next.pendingPan.dx === prev.pendingPan.dx &&
            next.pendingPan.dy === prev.pendingPan.dy,
        ),
      );
      break;
    }

    case "DELAYED_VISUAL_PAN": {
      const expected = panClamp(prev, event.dx, event.dy);
      checks.push(
        check(
          "ev_pan_within_bounds",
          clampBounds !== null &&
            next.visualOffsetLeft >= 0 &&
            next.visualOffsetLeft <= clampBounds.maxLeft &&
            next.visualOffsetTop >= 0 &&
            next.visualOffsetTop <= clampBounds.maxTop,
        ),
        check(
          "ev_pan_applied_matches_report",
          panReport !== null &&
            next.visualOffsetLeft ===
              prev.visualOffsetLeft + panReport.appliedDx &&
            next.visualOffsetTop ===
              prev.visualOffsetTop + panReport.appliedDy &&
            panReport.appliedDx === expected.appliedDx &&
            panReport.appliedDy === expected.appliedDy &&
            panReport.requestedDx === event.dx &&
            panReport.requestedDy === event.dy &&
            panReport.clamped === expected.clamped &&
            panReport.clampReason === expected.clampReason,
        ),
        check(
          "ev_pan_pending_is_applied",
          next.pendingPan.dx === next.visualOffsetLeft - prev.visualOffsetLeft &&
            next.pendingPan.dy === next.visualOffsetTop - prev.visualOffsetTop,
        ),
        check(
          "ev_pan_visual_size_unchanged",
          next.visualWidth === prev.visualWidth &&
            next.visualHeight === prev.visualHeight,
        ),
        check("ev_pan_scroll_unchanged", scrollUnchanged),
      );
      break;
    }

    case "VIEWPORT_SETTLED": {
      const restUnchanged =
        next.layoutWidth === prev.layoutWidth &&
        next.layoutHeight === prev.layoutHeight &&
        next.visualOffsetLeft === prev.visualOffsetLeft &&
        next.visualOffsetTop === prev.visualOffsetTop &&
        next.visualWidth === prev.visualWidth &&
        next.visualHeight === prev.visualHeight &&
        next.keyboardRect.x === prev.keyboardRect.x &&
        next.keyboardRect.y === prev.keyboardRect.y &&
        next.keyboardRect.width === prev.keyboardRect.width &&
        next.keyboardRect.height === prev.keyboardRect.height &&
        next.keyboardVisible === prev.keyboardVisible &&
        next.scrollX === prev.scrollX &&
        next.scrollY === prev.scrollY;
      checks.push(
        check(
          "ev_settled_pending_cleared",
          next.pendingPan.dx === 0 && next.pendingPan.dy === 0,
        ),
        check("ev_settled_rest_unchanged", restUnchanged),
      );
      break;
    }

    default: {
      break;
    }
  }
  return checks;
}

/**
 * Pure single-step event transition: the T005 formal mode transition
 * (which itself runs the PoC transition plus the §4.2 contract
 * checks), then this layer's event checks and the requested/applied
 * reports. Never mutates `prev`; returns it unchanged on UNKNOWN.
 */
export function evaluateEventTransition(
  prev: ViewportState,
  event: ViewportEvent,
  mode: string,
  profile: { scale: number },
): EventTransitionResult {
  const empty: EventTransitionResult = {
    status: "UNKNOWN",
    state: prev,
    reason: null,
    panReport: null,
    scrollReport: null,
    clampBounds: null,
    eventChecks: [],
    contractChecks: [],
  };
  const result = evaluateModeTransition(prev, event, mode, profile);
  if (result.status === "UNKNOWN") {
    return { ...empty, reason: result.reason, contractChecks: result.contractChecks };
  }
  const clampBounds =
    event.type === "DELAYED_VISUAL_PAN" ? clampBoundsFor(prev) : null;
  const scrollReport =
    event.type === "SCROLL"
      ? scrollClamp(prev, event.dx, event.dy)
      : null;
  const checks = eventChecksFor(
    prev,
    result.state,
    event,
    result.panReport,
    scrollReport,
    clampBounds,
  );
  const firstFailed = checks.find((c) => !c.passed);
  if (firstFailed !== undefined) {
    return {
      ...empty,
      reason: `event_model_violation:${firstFailed.name}`,
      eventChecks: checks,
      contractChecks: result.contractChecks,
    };
  }
  return {
    status: "OK",
    state: result.state,
    reason: null,
    panReport: result.panReport,
    scrollReport,
    clampBounds,
    eventChecks: checks,
    contractChecks: result.contractChecks,
  };
}

/**
 * Evaluate a validated scenario: replay its events in array order,
 * one formal event transition per event, stopping at the first
 * UNKNOWN step. Pan steps contribute one clamp-evidence row each.
 */
export function evaluateScenarioEvents(
  scenario: Scenario,
  scenarioSha256: string,
): EventTrace {
  const initial = initialState(
    scenario.viewport.layoutWidth,
    scenario.viewport.layoutHeight,
    scenario.mode,
  );
  const base = {
    scenarioId: scenario.scenario_id,
    scenarioSha256,
    seed: scenario.seed,
    mode: scenario.mode,
    validationIssues: [] as Array<ValidationIssue>,
    panReports: [] as Array<PanReport | null>,
    scrollReports: [] as Array<ScrollReport | null>,
    clampEvidence: [] as Array<ClampEvidenceEntry>,
  };
  const steps: Array<EventStep> = [];
  const panReports: Array<PanReport | null> = [];
  const scrollReports: Array<ScrollReport | null> = [];
  const clampEvidence: Array<ClampEvidenceEntry> = [];
  let state = initial;
  let failedEventId: string | null = null;
  let failedStepIndex: number | null = null;
  let reason: string | null = null;
  for (let i = 0; i < scenario.events.length; i++) {
    const event = scenario.events[i];
    const result = evaluateEventTransition(
      state,
      event,
      scenario.mode,
      scenario.profile,
    );
    panReports.push(result.panReport);
    scrollReports.push(result.scrollReport);
    if (result.status === "UNKNOWN") {
      steps.push({
        index: i,
        eventId: event.id,
        eventType: event.type,
        atMs: event.atMs,
        status: "UNKNOWN",
        reason: result.reason,
        state,
        panReport: null,
        scrollReport: null,
        clampBounds: null,
        eventChecks: result.eventChecks,
        contractChecks: result.contractChecks,
      });
      failedEventId = event.id;
      failedStepIndex = i;
      reason = result.reason;
      break;
    }
    if (
      event.type === "DELAYED_VISUAL_PAN" &&
      result.panReport !== null &&
      result.clampBounds !== null
    ) {
      clampEvidence.push({
        scenarioId: scenario.scenario_id,
        stepIndex: i,
        eventId: event.id,
        requestedDx: result.panReport.requestedDx,
        requestedDy: result.panReport.requestedDy,
        appliedDx: result.panReport.appliedDx,
        appliedDy: result.panReport.appliedDy,
        maxLeft: result.clampBounds.maxLeft,
        maxTop: result.clampBounds.maxTop,
        clamped: result.panReport.clamped,
        clampReason: result.panReport.clampReason,
      });
    }
    state = result.state;
    steps.push({
      index: i,
      eventId: event.id,
      eventType: event.type,
      atMs: event.atMs,
      status: "OK",
      reason: null,
      state,
      panReport: result.panReport,
      scrollReport: result.scrollReport,
      clampBounds: result.clampBounds,
      eventChecks: result.eventChecks,
      contractChecks: result.contractChecks,
    });
  }
  return {
    ...base,
    status: reason === null ? "OK" : "UNKNOWN",
    reason,
    failedEventId,
    failedStepIndex,
    initialState: initial,
    finalState: state,
    steps,
    panReports,
    scrollReports,
    clampEvidence,
  };
}

/**
 * Full events entry point for an unknown input value: validate first
 * (T004 frozen rules), then evaluate only when VALID. INVALID and
 * UNKNOWN inputs never reach the state machine; their states are null
 * and their steps are empty. `scenarioSha256` is supplied by the
 * caller (hashing lives in the scripts, not in this module).
 */
export function evaluateEvents(
  input: unknown,
  scenarioSha256: string,
): EventTrace {
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
      scrollReports: [],
      clampEvidence: [],
    };
  }
  return evaluateScenarioEvents(validated.scenario, scenarioSha256);
}
