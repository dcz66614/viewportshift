/**
 * P021 ViewportShift — formal three-mode viewport evaluator (T005, S1).
 *
 * Contract: P021_PROJECT_BOOK.md §4.1–§4.3, §3.4 (SPEC_VERSION 1.0.0)
 * and P021_IMPLEMENTATION_PLAN.md §5 (T005), §6.
 *
 * What this module is: the formal evaluator for the three standard
 * viewport modes `resizes-visual`, `resizes-content`, `overlays-content`.
 * It takes a `viewportshift.scenario/v1` scenario (T004 Schema) and
 * returns the deterministic state-transition trace. It is built on the
 * T002 PoC state machine (`viewport-state.ts`) and upgrades it in four
 * ways; every upgrade is a hardening against the project book, never a
 * silent change of the PoC's transition arithmetic:
 *
 * 1. Mode whitelist, fail-closed. The T002 PoC `transition()` does not
 *    whitelist mode names: an unknown mode string falls through to its
 *    `overlays-content` branch. T003 worked around that at the analysis
 *    layer; T005 owns it here. `evaluateModeTransition()` returns
 *    UNKNOWN (`unsupported_mode`) for any mode outside the three frozen
 *    names, before any transition runs. An unknown mode is never
 *    evaluated as if it were `overlays-content`.
 * 2. Schema-first entry. `evaluateModes()` validates its input with the
 *    frozen T004 validator (`validateScenario`) before touching the
 *    state machine. Structural problems are INVALID, well-formed but
 *    out-of-model inputs are UNKNOWN (per §3.4), and only VALID
 *    scenarios are replayed. The first validation issue code is the
 *    evaluation `reason`; the full issue list is carried in
 *    `validationIssues` so the Python Oracle can be compared
 *    field-by-field on it.
 * 3. Per-step mode-contract checks. After every successful transition
 *    the result is checked against the §4.2 contract for that mode and
 *    event (layout/visual/keyboard relations, scroll independence, pan
 *    clamping, pendingPan lifecycle, clock advance). A violated check
 *    fails the step closed with UNKNOWN
 *    (`mode_contract_violation:<check-name>`) and the replay stops with
 *    the state kept as of before the violating event. The checks are
 *    pure predicates over (previous state, next state, event, mode);
 *    they never mutate anything.
 * 4. Deterministic canonical output. `canonicalModeJson` is the same
 *    sorted-keys, no-spaces canonicalisation the S0 geometry module
 *    uses, so the scenario hash and the analysis hash are reproducible
 *    and comparable with the Python Oracle byte for byte.
 *
 * DELAYED_VISUAL_PAN is an event, never a fourth mode: it moves only
 * the visual offset (clamped), records `pendingPan`, and never changes
 * the `mode` field. Every step asserts `mode_unchanged`.
 *
 * PoC behaviours retained unchanged (the project book is silent on
 * them, so T005 does not redesign them; they are pinned by fixtures
 * and called out in the T005 report):
 * - In `resizes-visual`, KEYBOARD_CLOSE restores `visualHeight` but
 *   does not reset `visualOffsetTop`: a pan applied while the keyboard
 *   was open leaves the visual rect offset after the close.
 * - In `resizes-content`, KEYBOARD_OPEN zeroes the visual offsets.
 * - KEYBOARD_CLOSE with no open keyboard is idempotent: only the
 *   event clock advances.
 * - SCROLL updates only the independent scroll offsets (lower-bounded
 *   at 0); it never moves the visual offset.
 *
 * Pure functions only: no wall clock, no timers, no randomness, no I/O,
 * no date/time access. Hashing lives in the scripts (node:crypto), not
 * here, so this file stays usable in the browser bundle.
 */

import { VIEWPORT_MODES } from "./types.ts";
import type { Scenario, ValidationIssue } from "./types.ts";
import { validateScenario } from "./validate.ts";
import { initialState, transition } from "./viewport-state.ts";
import type {
  PanReport,
  ViewportEvent,
  ViewportMode as PoCViewportMode,
  ViewportState,
} from "./viewport-state.ts";

export const MODES_VERSION = "modes/v1";
export const SEED = "P021-VIEWPORTSHIFT-S0-2026-11-10";

export type ModeEvaluationStatus = "OK" | "UNKNOWN" | "INVALID";
export type ModeStepStatus = "OK" | "UNKNOWN";

/** One frozen mode-contract check: name in fixed order, pass/fail. */
export interface ModeContractCheck {
  name: string;
  passed: boolean;
}

export interface ModeStep {
  index: number;
  eventId: string;
  eventType: string;
  atMs: number;
  status: ModeStepStatus;
  reason: string | null;
  /** State after the event; state before it when the step is UNKNOWN. */
  state: ViewportState;
  panReport: PanReport | null;
  contractChecks: Array<ModeContractCheck>;
}

export interface ModeEvaluation {
  scenarioId: string;
  scenarioSha256: string;
  seed: string;
  mode: string;
  status: ModeEvaluationStatus;
  /** First validation issue code, transition reason, or contract check. */
  reason: string | null;
  validationIssues: Array<ValidationIssue>;
  failedEventId: string | null;
  failedStepIndex: number | null;
  /** Null exactly when validation rejected the input (no replay ran). */
  initialState: ViewportState | null;
  finalState: ViewportState | null;
  steps: Array<ModeStep>;
  panReports: Array<PanReport | null>;
}

export interface ModeTransitionResult {
  status: ModeStepStatus;
  /** Next state on OK; the unchanged input state on UNKNOWN. */
  state: ViewportState;
  reason: string | null;
  panReport: PanReport | null;
  contractChecks: Array<ModeContractCheck>;
}

/** True exactly for the three frozen standard mode names (§4.2). */
export function isStandardMode(value: string): boolean {
  return (VIEWPORT_MODES as ReadonlyArray<string>).includes(value);
}

/**
 * Deterministic canonical JSON: sorted keys, fixed array order, no
 * spaces — identical to the S0 geometry module's canonicalisation.
 */
export function canonicalModeJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalModeJson).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonicalModeJson(record[k])}`)
    .join(",")}}`;
}

function clampInt(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function rectEquals(
  a: ViewportState["keyboardRect"],
  b: ViewportState["keyboardRect"],
): boolean {
  return (
    a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
  );
}

function check(name: string, passed: boolean): ModeContractCheck {
  return { name, passed };
}

/**
 * The frozen §4.2 contract checks for one successful transition, in
 * fixed order: two generic checks first, then the event/mode specific
 * checks. `next` is the state the PoC transition produced; every check
 * is an integer equality over (prev, next, event, mode).
 */
export function contractChecksFor(
  prev: ViewportState,
  next: ViewportState,
  event: ViewportEvent,
  mode: string,
): Array<ModeContractCheck> {
  const checks: Array<ModeContractCheck> = [
    check("clock_advanced", next.eventClock === event.atMs),
    check("mode_unchanged", next.mode === prev.mode),
  ];
  const layoutUnchanged =
    next.layoutWidth === prev.layoutWidth &&
    next.layoutHeight === prev.layoutHeight;
  const visualUnchanged =
    next.visualWidth === prev.visualWidth &&
    next.visualHeight === prev.visualHeight &&
    next.visualOffsetLeft === prev.visualOffsetLeft &&
    next.visualOffsetTop === prev.visualOffsetTop;
  const scrollUnchanged =
    next.scrollX === prev.scrollX && next.scrollY === prev.scrollY;
  const panUnchanged =
    next.pendingPan.dx === prev.pendingPan.dx &&
    next.pendingPan.dy === prev.pendingPan.dy;
  const keyboardUnchanged =
    rectEquals(next.keyboardRect, prev.keyboardRect) &&
    next.keyboardVisible === prev.keyboardVisible;

  switch (event.type) {
    case "KEYBOARD_OPEN": {
      const h = event.keyboardHeight;
      if (mode === "resizes-visual") {
        checks.push(
          check("rv_layout_unchanged", layoutUnchanged),
          check("rv_visual_width_unchanged", next.visualWidth === prev.visualWidth),
          check(
            "rv_visual_height_shrunk",
            next.visualHeight === next.layoutHeight - h,
          ),
          check(
            "rv_keyboard_rect",
            rectEquals(next.keyboardRect, {
              x: 0,
              y: next.layoutHeight - h,
              width: next.layoutWidth,
              height: h,
            }),
          ),
          check("rv_keyboard_visible", next.keyboardVisible === true),
          check(
            "rv_offsets_unchanged",
            next.visualOffsetLeft === prev.visualOffsetLeft &&
              next.visualOffsetTop === prev.visualOffsetTop,
          ),
          check("rv_scroll_unchanged", scrollUnchanged),
          check("rv_pending_pan_unchanged", panUnchanged),
        );
      } else if (mode === "resizes-content") {
        const fullHeight = prev.keyboardVisible
          ? prev.layoutHeight + prev.keyboardRect.height
          : prev.layoutHeight;
        checks.push(
          check("rc_layout_width_unchanged", next.layoutWidth === prev.layoutWidth),
          check("rc_layout_height_shrunk", next.layoutHeight === fullHeight - h),
          check(
            "rc_visual_follows_layout",
            next.visualWidth === next.layoutWidth &&
              next.visualHeight === next.layoutHeight,
          ),
          check(
            "rc_offsets_zeroed",
            next.visualOffsetLeft === 0 && next.visualOffsetTop === 0,
          ),
          check(
            "rc_keyboard_rect",
            rectEquals(next.keyboardRect, {
              x: 0,
              y: next.layoutHeight,
              width: next.layoutWidth,
              height: h,
            }),
          ),
          check("rc_keyboard_visible", next.keyboardVisible === true),
          check("rc_scroll_unchanged", scrollUnchanged),
          check("rc_pending_pan_unchanged", panUnchanged),
        );
      } else {
        // overlays-content: sizes do not move; the keyboard rect overlaps.
        checks.push(
          check("oc_layout_unchanged", layoutUnchanged),
          check("oc_visual_unchanged", visualUnchanged),
          check(
            "oc_keyboard_rect",
            rectEquals(next.keyboardRect, {
              x: 0,
              y: next.layoutHeight - h,
              width: next.layoutWidth,
              height: h,
            }),
          ),
          check("oc_keyboard_visible", next.keyboardVisible === true),
          check("oc_scroll_unchanged", scrollUnchanged),
          check("oc_pending_pan_unchanged", panUnchanged),
        );
      }
      break;
    }

    case "KEYBOARD_CLOSE": {
      if (mode === "resizes-visual") {
        const restored = prev.keyboardVisible
          ? next.visualHeight === prev.visualHeight + prev.keyboardRect.height
          : next.visualHeight === prev.visualHeight;
        checks.push(
          check("rv_layout_unchanged", layoutUnchanged),
          check("rv_visual_width_unchanged", next.visualWidth === prev.visualWidth),
          check("rv_visual_restored", restored),
          check(
            "rv_keyboard_rect_cleared",
            rectEquals(next.keyboardRect, {
              x: 0,
              y: next.layoutHeight,
              width: next.layoutWidth,
              height: 0,
            }),
          ),
          check("rv_keyboard_hidden", next.keyboardVisible === false),
          check(
            "rv_offsets_unchanged",
            next.visualOffsetLeft === prev.visualOffsetLeft &&
              next.visualOffsetTop === prev.visualOffsetTop,
          ),
          check("rv_scroll_unchanged", scrollUnchanged),
          check("rv_pending_pan_unchanged", panUnchanged),
        );
      } else if (mode === "resizes-content") {
        const restored = prev.keyboardVisible
          ? next.layoutHeight === prev.layoutHeight + prev.keyboardRect.height
          : next.layoutHeight === prev.layoutHeight;
        checks.push(
          check("rc_layout_width_unchanged", next.layoutWidth === prev.layoutWidth),
          check("rc_layout_height_restored", restored),
          check(
            "rc_visual_follows_layout",
            next.visualWidth === next.layoutWidth &&
              next.visualHeight === next.layoutHeight,
          ),
          check(
            "rc_offsets_zeroed",
            next.visualOffsetLeft === 0 && next.visualOffsetTop === 0,
          ),
          check(
            "rc_keyboard_rect_cleared",
            rectEquals(next.keyboardRect, {
              x: 0,
              y: next.layoutHeight,
              width: next.layoutWidth,
              height: 0,
            }),
          ),
          check("rc_keyboard_hidden", next.keyboardVisible === false),
          check("rc_scroll_unchanged", scrollUnchanged),
          check("rc_pending_pan_unchanged", panUnchanged),
        );
      } else {
        checks.push(
          check("oc_layout_unchanged", layoutUnchanged),
          check("oc_visual_unchanged", visualUnchanged),
          check(
            "oc_keyboard_rect_cleared",
            rectEquals(next.keyboardRect, {
              x: 0,
              y: next.layoutHeight,
              width: next.layoutWidth,
              height: 0,
            }),
          ),
          check("oc_keyboard_hidden", next.keyboardVisible === false),
          check("oc_scroll_unchanged", scrollUnchanged),
          check("oc_pending_pan_unchanged", panUnchanged),
        );
      }
      break;
    }

    case "SCROLL": {
      checks.push(
        check(
          "scroll_offsets",
          next.scrollX === (prev.scrollX + event.dx < 0 ? 0 : prev.scrollX + event.dx) &&
            next.scrollY === (prev.scrollY + event.dy < 0 ? 0 : prev.scrollY + event.dy),
        ),
        check("scroll_visual_untouched", visualUnchanged),
        check("scroll_layout_unchanged", layoutUnchanged),
        check("scroll_keyboard_unchanged", keyboardUnchanged),
        check("scroll_pending_pan_unchanged", panUnchanged),
      );
      break;
    }

    case "DELAYED_VISUAL_PAN": {
      const maxLeft =
        prev.layoutWidth - prev.visualWidth < 0
          ? 0
          : prev.layoutWidth - prev.visualWidth;
      const maxTop =
        prev.layoutHeight - prev.visualHeight < 0
          ? 0
          : prev.layoutHeight - prev.visualHeight;
      const expectedLeft = clampInt(prev.visualOffsetLeft + event.dx, 0, maxLeft);
      const expectedTop = clampInt(prev.visualOffsetTop + event.dy, 0, maxTop);
      checks.push(
        check(
          "pan_offsets_clamped",
          next.visualOffsetLeft === expectedLeft &&
            next.visualOffsetTop === expectedTop,
        ),
        check(
          "pan_pending_recorded",
          next.pendingPan.dx === next.visualOffsetLeft - prev.visualOffsetLeft &&
            next.pendingPan.dy === next.visualOffsetTop - prev.visualOffsetTop,
        ),
        check("pan_layout_unchanged", layoutUnchanged),
        check(
          "pan_visual_size_unchanged",
          next.visualWidth === prev.visualWidth &&
            next.visualHeight === prev.visualHeight,
        ),
        check("pan_keyboard_unchanged", keyboardUnchanged),
        check("pan_scroll_unchanged", scrollUnchanged),
      );
      break;
    }

    case "VIEWPORT_SETTLED": {
      const settledUnchanged =
        next.layoutWidth === prev.layoutWidth &&
        next.layoutHeight === prev.layoutHeight &&
        next.visualOffsetLeft === prev.visualOffsetLeft &&
        next.visualOffsetTop === prev.visualOffsetTop &&
        next.visualWidth === prev.visualWidth &&
        next.visualHeight === prev.visualHeight &&
        rectEquals(next.keyboardRect, prev.keyboardRect) &&
        next.keyboardVisible === prev.keyboardVisible &&
        next.scrollX === prev.scrollX &&
        next.scrollY === prev.scrollY;
      checks.push(
        check(
          "settled_pending_cleared",
          next.pendingPan.dx === 0 && next.pendingPan.dy === 0,
        ),
        check("settled_state_unchanged", settledUnchanged),
      );
      break;
    }

    default: {
      // Unreachable for validated events; the transition already
      // returns UNKNOWN for an unknown event type, so no check applies.
      break;
    }
  }
  return checks;
}

/**
 * Pure single-step formal transition: mode whitelist, then the T002
 * PoC transition, then the §4.2 contract checks. Never mutates `prev`;
 * returns it unchanged on UNKNOWN.
 */
export function evaluateModeTransition(
  prev: ViewportState,
  event: ViewportEvent,
  mode: string,
  profile: { scale: number },
): ModeTransitionResult {
  if (!isStandardMode(mode)) {
    return {
      status: "UNKNOWN",
      state: prev,
      reason: "unsupported_mode",
      panReport: null,
      contractChecks: [],
    };
  }
  const result = transition(prev, event, mode as PoCViewportMode, profile);
  if (result.status === "UNKNOWN") {
    return {
      status: "UNKNOWN",
      state: prev,
      reason: result.reason,
      panReport: null,
      contractChecks: [],
    };
  }
  const checks = contractChecksFor(prev, result.state, event, mode);
  const firstFailed = checks.find((c) => !c.passed);
  if (firstFailed !== undefined) {
    return {
      status: "UNKNOWN",
      state: prev,
      reason: `mode_contract_violation:${firstFailed.name}`,
      panReport: null,
      contractChecks: checks,
    };
  }
  return {
    status: "OK",
    state: result.state,
    reason: null,
    panReport: result.panReport,
    contractChecks: checks,
  };
}

/**
 * Evaluate a validated scenario: build the initial state and replay
 * its events in array order, one formal transition per event, stopping
 * at the first UNKNOWN step. The mode field is checked first so an
 * out-of-enum mode can never reach the state machine.
 */
export function evaluateScenarioModes(
  scenario: Scenario,
  scenarioSha256: string,
): ModeEvaluation {
  const mode = scenario.mode;
  const initial = initialState(
    scenario.viewport.layoutWidth,
    scenario.viewport.layoutHeight,
    mode,
  );
  const base = {
    scenarioId: scenario.scenario_id,
    scenarioSha256,
    seed: scenario.seed,
    mode,
    validationIssues: [] as Array<ValidationIssue>,
    panReports: [] as Array<PanReport | null>,
  };
  if (!isStandardMode(mode)) {
    return {
      ...base,
      status: "UNKNOWN",
      reason: "unsupported_mode",
      failedEventId: null,
      failedStepIndex: null,
      initialState: initial,
      finalState: initial,
      steps: [],
    };
  }
  const steps: Array<ModeStep> = [];
  const panReports: Array<PanReport | null> = [];
  let state = initial;
  let failedEventId: string | null = null;
  let failedStepIndex: number | null = null;
  let reason: string | null = null;
  for (let i = 0; i < scenario.events.length; i++) {
    const event = scenario.events[i];
    const result = evaluateModeTransition(state, event, mode, scenario.profile);
    panReports.push(result.panReport);
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
        contractChecks: result.contractChecks,
      });
      failedEventId = event.id;
      failedStepIndex = i;
      reason = result.reason;
      break;
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
  };
}

/**
 * Full modes entry point for an unknown input value: validate first
 * (T004 frozen rules), then evaluate only when VALID. INVALID and
 * UNKNOWN inputs never reach the state machine; their states are null
 * and their steps are empty. `scenarioSha256` is supplied by the
 * caller (hashing lives in the scripts, not in this module).
 */
export function evaluateModes(
  input: unknown,
  scenarioSha256: string,
): ModeEvaluation {
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
    };
  }
  return evaluateScenarioModes(validated.scenario, scenarioSha256);
}
