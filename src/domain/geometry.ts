/**
 * P021 ViewportShift — rectangle geometry + S0 scenario analysis (T003).
 *
 * Contract: P021_PROJECT_BOOK.md §4.4–§4.6, §6.1 (SPEC_VERSION 1.0.0)
 * and P021_IMPLEMENTATION_PLAN.md §5 (T003), §6.
 *
 * Frozen semantics (T003; the Python Oracle implements the same rules
 * independently — the two sides share only the read-only fixtures and
 * field names, never an algorithm module):
 *
 * - Fixed-point integers only: 1 unit = 1/1000 CSS px. All decision
 *   comparisons are integer comparisons. `visibleRatio` is an integer
 *   milli-ratio, floor(visibleArea * 1000 / surfaceArea), computed with
 *   BigInt so no binary floating point is involved at all.
 *   `anchorDrift.magnitude` is the exact integer floor square root
 *   (BigInt Newton iteration), never `Math.sqrt`.
 * - Surface rect S is derived from the fixture's declarative layout spec
 *   and the replayed state: bottom-anchored layouts sit at
 *   y = layoutHeight - offset - height; top-anchored layouts sit at
 *   y = offset. The expected anchor rect is the same anchor expressed
 *   relative to the visual viewport (bottom anchor: y = visualBottom -
 *   offset - height; top anchor: y = visualOffsetTop + offset).
 *   anchorDrift = actual rect origin - expected rect origin.
 * - Let V be the visual-viewport rect and K the keyboard rect.
 *   keyboardObscuredArea = |S ∩ V ∩ K| while the keyboard is visible,
 *   else 0. This single uniform definition encodes the mode semantics:
 *   in `resizes-visual` / `resizes-content` the keyboard rect is disjoint
 *   from V (it sits below the shrunken visual viewport), so nothing is
 *   keyboard-obscured there — an element outside V is *clipped*, not
 *   obscured. In `overlays-content` V covers the full layout, so the
 *   triple intersection equals |S ∩ K|. After a DELAYED_VISUAL_PAN in
 *   `resizes-visual`, V can overlap K, and the part of S inside both is
 *   correctly counted as obscured rather than visible.
 * - viewportClippedArea = |S| - |S ∩ V|.
 *   visibleArea = |S ∩ V| - keyboardObscuredArea (the overlap S ∩ V ∩ K
 *   is deducted exactly once). Invariant, checked by the tests:
 *   visibleArea + viewportClippedArea + keyboardObscuredArea
 *   = surfaceArea.
 * - bottomGap = (visualOffsetTop + visualHeight) - surfaceBottom
 *   (signed; positive = gap remains, negative = surface crosses the
 *   visual bottom edge).
 * - Zero-area surface (width <= 0 or height <= 0) is INVALID
 *   (PROJECT_BOOK §4.4: "零面积输入 INVALID"), never silently 0.
 * - Scenario status is decided by the FINAL step's failure predicates.
 *   A scenario whose keyboard closes again (open-close sequences) ends
 *   with the UI restored, so it PASSES even though an intermediate step
 *   failed; every step's fired predicates are still recorded and
 *   parity-checked, so transient failures are visible in the evidence,
 *   not hidden. (T008 BFS will use any-step semantics for witnesses.)
 * - Unsupported mode strings are rejected at this analysis layer with
 *   status UNKNOWN (`unsupported_mode`): the T002 state machine does not
 *   whitelist mode names itself (an unknown mode would fall through to
 *   its `overlays-content` branch), so T003 fails closed here instead of
 *   relying on it. Formal mode validation belongs to T005.
 * - Scale != 1, event-clock regression and out-of-range keyboard height
 *   are UNKNOWN via the T002 replay (state kept as of before the failing
 *   event, replay stops there), mirrored exactly by the Python Oracle.
 *
 * This module is pure: no wall clock, no timers, no randomness, no I/O,
 * no date/time access. Hashing lives in the scripts (node:crypto),
 * not here, so this file stays usable in the browser bundle.
 */

import {
  initialState,
  replay,
  transition,
} from "./viewport-state.ts";
import type {
  PanReport,
  RectMilli,
  ViewportMode,
  ViewportState,
} from "./viewport-state.ts";

export const SEED = "P021-VIEWPORTSHIFT-S0-2026-11-10";
export const VIEWPORT_MODES: ReadonlyArray<string> = [
  "resizes-visual",
  "resizes-content",
  "overlays-content",
];
export const ANALYSIS_VERSION = "s0-geometry/v1";

export type AnalysisStatus = "PASS" | "FAIL" | "UNKNOWN" | "INVALID";
export type StepStatus = "PASS" | "FAIL" | "INVALID" | "UNKNOWN";

export interface LayoutSpec {
  template: string;
  anchor: "bottom" | "top";
  offsetMilli: number;
  xMilli: number;
  widthMilli: number;
  heightMilli: number;
}

export interface FailurePredicate {
  field:
    | "visibleRatio"
    | "keyboardObscuredArea"
    | "bottomGap"
    | "anchorDriftMagnitude";
  op: "<" | ">" | "<=" | ">=" | "==";
  threshold: number;
}

export interface PlantedError {
  kind: string;
  description: string;
}

export interface ScenarioFixture {
  scenario_id: string;
  seed: string;
  layout: LayoutSpec;
  viewport: { layoutWidth: number; layoutHeight: number };
  keyboard: { heightMilli: number };
  mode: string;
  events: Array<Record<string, unknown>>;
  failure_predicates: Array<FailurePredicate>;
  limits: Record<string, unknown>;
  expected_status: string;
  planted_error: null | PlantedError;
  profile?: { scale: number };
}

export interface AnchorDrift {
  dx: number;
  dy: number;
  magnitude: number;
}

export interface GeometryMetrics {
  surfaceArea: number;
  keyboardObscuredArea: number;
  viewportClippedArea: number;
  visibleArea: number;
  /** Integer milli-ratio: floor(visibleArea * 1000 / surfaceArea). */
  visibleRatio: number;
  bottomGap: number;
  anchorDrift: AnchorDrift;
}

export interface StepGeometry {
  eventId: string;
  eventType: string;
  atMs: number;
  state: ViewportState;
  surfaceRect: RectMilli;
  expectedAnchorRect: RectMilli;
  metrics: GeometryMetrics | null;
  stepStatus: StepStatus;
  failedPredicates: Array<string>;
}

export interface ScenarioResult {
  scenarioId: string;
  scenarioSha256: string;
  seed: string;
  layoutTemplate: string;
  mode: string;
  status: AnalysisStatus;
  reason: string | null;
  failedEventId: string | null;
  replayStatus: "OK" | "UNKNOWN" | "NOT_RUN";
  finalState: ViewportState;
  finalMetrics: GeometryMetrics | null;
  failedPredicates: Array<string>;
  firstFailedStepIndex: number | null;
  expectedStatus: string;
  plantedError: null | PlantedError;
  panReports: Array<PanReport | null>;
  steps: Array<StepGeometry>;
}

function isInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

/** Exact integer square root (floor) via BigInt Newton iteration. */
export function isqrt(n: number): number {
  if (!isInt(n) || n < 0) {
    throw new RangeError("isqrt: non-negative integer required");
  }
  let x = BigInt(n);
  if (x < 2n) return Number(x);
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + BigInt(n) / x) / 2n;
  }
  return Number(x);
}

/** Axis-aligned rectangle intersection; null when the overlap is empty. */
export function rectIntersection(
  a: RectMilli,
  b: RectMilli,
): RectMilli | null {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Exact intersection area in (milli-px)^2; 0 when disjoint or touching. */
export function intersectionArea(a: RectMilli, b: RectMilli): number {
  const hit = rectIntersection(a, b);
  return hit === null ? 0 : hit.width * hit.height;
}

function rectArea(r: RectMilli): number {
  return r.width * r.height;
}

/**
 * Surface rect for a layout spec in the given (replayed) state.
 * Bottom anchor: y = layoutHeight - offset - height.
 * Top anchor: y = offset. x / width / height come from the spec.
 */
export function surfaceRectFor(
  layout: LayoutSpec,
  state: ViewportState,
): RectMilli {
  const y =
    layout.anchor === "bottom"
      ? state.layoutHeight - layout.offsetMilli - layout.heightMilli
      : layout.offsetMilli;
  return {
    x: layout.xMilli,
    y,
    width: layout.widthMilli,
    height: layout.heightMilli,
  };
}

/**
 * Where the surface rect *should* be if it tracked its declared anchor
 * relative to the visual viewport: bottom anchor keys off the visual
 * bottom edge, top anchor off the visual top edge; x keys off the visual
 * left edge.
 */
export function expectedAnchorRect(
  layout: LayoutSpec,
  state: ViewportState,
): RectMilli {
  const visualBottom = state.visualOffsetTop + state.visualHeight;
  const y =
    layout.anchor === "bottom"
      ? visualBottom - layout.offsetMilli - layout.heightMilli
      : state.visualOffsetTop + layout.offsetMilli;
  return {
    x: state.visualOffsetLeft + layout.xMilli,
    y,
    width: layout.widthMilli,
    height: layout.heightMilli,
  };
}

/**
 * Geometry for one state. Returns INVALID (metrics null) for a zero-area
 * surface or non-integer inputs; otherwise all metrics per §4.4.
 */
export function computeGeometry(
  state: ViewportState,
  surface: RectMilli,
): { status: "OK" | "INVALID"; reason: string | null; metrics: GeometryMetrics | null } {
  if (
    !isInt(surface.width) ||
    !isInt(surface.height) ||
    surface.width <= 0 ||
    surface.height <= 0
  ) {
    return { status: "INVALID", reason: "zero_area_surface", metrics: null };
  }
  const visualRect: RectMilli = {
    x: state.visualOffsetLeft,
    y: state.visualOffsetTop,
    width: state.visualWidth,
    height: state.visualHeight,
  };
  const keyboardRect = state.keyboardRect;
  const surfaceArea = rectArea(surface);
  const visibleIntersection = intersectionArea(surface, visualRect);
  let keyboardObscuredArea = 0;
  if (state.keyboardVisible) {
    const visibleKeyboard = rectIntersection(visualRect, keyboardRect);
    if (visibleKeyboard !== null) {
      keyboardObscuredArea = intersectionArea(surface, visibleKeyboard);
    }
  }
  const visibleArea = visibleIntersection - keyboardObscuredArea;
  const viewportClippedArea = surfaceArea - visibleIntersection;
  // Exact integer milli-ratio (BigInt division truncates toward zero;
  // both operands are non-negative, so this is floor).
  const visibleRatio = Number(
    (BigInt(visibleArea) * 1000n) / BigInt(surfaceArea),
  );
  const bottomGap =
    state.visualOffsetTop + state.visualHeight - (surface.y + surface.height);
  return {
    status: "OK",
    reason: null,
    metrics: {
      surfaceArea,
      keyboardObscuredArea,
      viewportClippedArea,
      visibleArea,
      visibleRatio,
      bottomGap,
      // Drift is filled in by computeMetrics (needs the layout spec).
      anchorDrift: { dx: 0, dy: 0, magnitude: 0 },
    },
  };
}

/**
 * Full metric computation including anchor drift. `computeGeometry` above
 * is kept drift-free so the drift inputs stay explicit at the call site;
 * this wrapper fills drift in from the layout spec.
 */
export function computeMetrics(
  layout: LayoutSpec,
  state: ViewportState,
): { status: "OK" | "INVALID"; reason: string | null; metrics: GeometryMetrics | null } {
  const surface = surfaceRectFor(layout, state);
  const base = computeGeometry(state, surface);
  if (base.status !== "OK" || base.metrics === null) {
    return base;
  }
  const expected = expectedAnchorRect(layout, state);
  const dx = surface.x - expected.x;
  const dy = surface.y - expected.y;
  const magnitude = isqrt(dx * dx + dy * dy);
  return {
    status: "OK",
    reason: null,
    metrics: { ...base.metrics, anchorDrift: { dx, dy, magnitude } },
  };
}

/**
 * Triple intersection area |A ∩ B ∩ C| in (milli-px)^2; 0 when the
 * three-way overlap is empty (including touching edges). This is the
 * exact term deducted once for keyboard obscuration: the part of the
 * surface that is both inside the visual viewport and under the
 * keyboard. Using the triple intersection (rather than |S ∩ K|) is
 * what prevents double deduction when the keyboard rect overlaps the
 * visual viewport only partially.
 */
export function tripleIntersectionArea(
  a: RectMilli,
  b: RectMilli,
  c: RectMilli,
): number {
  const ab = rectIntersection(a, b);
  if (ab === null) return 0;
  return intersectionArea(ab, c);
}

/** Fixed order of the T007 geometry contract checks (see below). */
export const GEOMETRY_CONTRACT_CHECK_NAMES: ReadonlyArray<string> = [
  "invariant_sum",
  "obscured_definition",
  "visible_ratio_range",
  "visible_ratio_floor",
  "obscured_within_visible",
  "obscured_within_keyboard",
  "clipped_within_surface",
  "areas_nonnegative",
  "bottom_gap_definition",
  "drift_vector",
  "drift_magnitude",
];

/** One frozen geometry contract check: name in fixed order, pass/fail. */
export interface GeometryContractCheck {
  name: string;
  passed: boolean;
}

/**
 * Direct (rect-level) geometry input: the surface rect S, the visual
 * viewport rect V, the keyboard rect K, whether the keyboard is
 * currently covering content, and the rect where the surface is
 * expected to sit given its declared anchor. This is the T007 entry
 * point for unit-level geometry: it takes rects directly, without a
 * scenario replay, so touching edges, zero area and overlap cases can
 * be tested in isolation from the state machine.
 */
export interface DirectGeometryInput {
  surface: RectMilli;
  visual: RectMilli;
  keyboard: RectMilli;
  keyboardVisible: boolean;
  expectedAnchor: RectMilli;
}

function geometryCheck(name: string, passed: boolean): GeometryContractCheck {
  return { name, passed };
}

/**
 * Geometry for one (surface, visual, keyboard) triple, per PROJECT_BOOK
 * §4.4, computed from the rects directly:
 * - keyboardObscuredArea = |S ∩ V ∩ K| while the keyboard is visible,
 *   else 0 (the keyboard rect alone never obscures what is outside V).
 * - viewportClippedArea = |S| - |S ∩ V|.
 * - visibleArea = |S ∩ V| - keyboardObscuredArea (the overlap is
 *   deducted exactly once).
 * - visibleRatio = floor(visibleArea * 1000 / surfaceArea), BigInt.
 * - bottomGap = visual bottom - surface bottom (signed).
 * - anchorDrift = surface origin - expected anchor origin; magnitude
 *   is the exact integer floor square root.
 * Zero-area surface (width <= 0 or height <= 0) is INVALID
 * (zero_area_surface); non-integer rect inputs are INVALID
 * (non_integer_geometry). Never silently 0.
 */
export function computeGeometryDirect(
  input: DirectGeometryInput,
): {
  status: "OK" | "INVALID";
  reason: string | null;
  metrics: GeometryMetrics | null;
} {
  const { surface, visual, keyboard, keyboardVisible, expectedAnchor } =
    input;
  for (const r of [surface, visual, keyboard, expectedAnchor]) {
    if (!isInt(r.x) || !isInt(r.y) || !isInt(r.width) || !isInt(r.height)) {
      return {
        status: "INVALID",
        reason: "non_integer_geometry",
        metrics: null,
      };
    }
  }
  if (surface.width <= 0 || surface.height <= 0) {
    return { status: "INVALID", reason: "zero_area_surface", metrics: null };
  }
  const surfaceArea = rectArea(surface);
  const visibleIntersection = intersectionArea(surface, visual);
  const keyboardObscuredArea = keyboardVisible
    ? tripleIntersectionArea(surface, visual, keyboard)
    : 0;
  const visibleArea = visibleIntersection - keyboardObscuredArea;
  const viewportClippedArea = surfaceArea - visibleIntersection;
  const visibleRatio = Number(
    (BigInt(visibleArea) * 1000n) / BigInt(surfaceArea),
  );
  const bottomGap =
    visual.y + visual.height - (surface.y + surface.height);
  const dx = surface.x - expectedAnchor.x;
  const dy = surface.y - expectedAnchor.y;
  const magnitude = isqrt(dx * dx + dy * dy);
  return {
    status: "OK",
    reason: null,
    metrics: {
      surfaceArea,
      keyboardObscuredArea,
      viewportClippedArea,
      visibleArea,
      visibleRatio,
      bottomGap,
      anchorDrift: { dx, dy, magnitude },
    },
  };
}

/**
 * The frozen §4.4 contract checks for one computed metric set, in
 * fixed order. Every check is an integer equality / bound over the
 * input rects and the metrics; they re-derive each field from first
 * principles, so a metric that disagrees with its own definition
 * fails here rather than passing silently.
 */
export function geometryContractChecksFor(
  input: DirectGeometryInput,
  metrics: GeometryMetrics,
): Array<GeometryContractCheck> {
  const { surface, visual, keyboard, keyboardVisible, expectedAnchor } =
    input;
  const surfaceArea = rectArea(surface);
  const visibleIntersection = intersectionArea(surface, visual);
  const obscured = keyboardVisible
    ? tripleIntersectionArea(surface, visual, keyboard)
    : 0;
  const expectedRatio = Number(
    (BigInt(metrics.visibleArea) * 1000n) / BigInt(surfaceArea),
  );
  const dx = surface.x - expectedAnchor.x;
  const dy = surface.y - expectedAnchor.y;
  return [
    geometryCheck(
      "invariant_sum",
      metrics.visibleArea +
        metrics.viewportClippedArea +
        metrics.keyboardObscuredArea ===
        surfaceArea,
    ),
    geometryCheck(
      "obscured_definition",
      metrics.keyboardObscuredArea === obscured,
    ),
    geometryCheck(
      "visible_ratio_range",
      metrics.visibleRatio >= 0 && metrics.visibleRatio <= 1000,
    ),
    geometryCheck(
      "visible_ratio_floor",
      metrics.visibleRatio === expectedRatio,
    ),
    geometryCheck(
      "obscured_within_visible",
      metrics.keyboardObscuredArea <= visibleIntersection,
    ),
    geometryCheck(
      "obscured_within_keyboard",
      metrics.keyboardObscuredArea <= intersectionArea(surface, keyboard),
    ),
    geometryCheck(
      "clipped_within_surface",
      metrics.viewportClippedArea === surfaceArea - visibleIntersection,
    ),
    geometryCheck(
      "areas_nonnegative",
      metrics.visibleArea >= 0 &&
        metrics.viewportClippedArea >= 0 &&
        metrics.keyboardObscuredArea >= 0,
    ),
    geometryCheck(
      "bottom_gap_definition",
      metrics.bottomGap ===
        visual.y + visual.height - (surface.y + surface.height),
    ),
    geometryCheck(
      "drift_vector",
      metrics.anchorDrift.dx === dx && metrics.anchorDrift.dy === dy,
    ),
    geometryCheck(
      "drift_magnitude",
      metrics.anchorDrift.magnitude === isqrt(dx * dx + dy * dy),
    ),
  ];
}

function metricField(
  metrics: GeometryMetrics,
  field: FailurePredicate["field"],
): number {
  switch (field) {
    case "visibleRatio":
      return metrics.visibleRatio;
    case "keyboardObscuredArea":
      return metrics.keyboardObscuredArea;
    case "bottomGap":
      return metrics.bottomGap;
    case "anchorDriftMagnitude":
      return metrics.anchorDrift.magnitude;
    default:
      throw new Error(`unknown predicate field: ${String(field)}`);
  }
}

/** Names of the predicates that fire on these metrics, in fixture order. */
export function evaluatePredicates(
  metrics: GeometryMetrics,
  predicates: ReadonlyArray<FailurePredicate>,
): Array<string> {
  const fired: Array<string> = [];
  for (const p of predicates) {
    const value = metricField(metrics, p.field);
    let hit = false;
    switch (p.op) {
      case "<":
        hit = value < p.threshold;
        break;
      case ">":
        hit = value > p.threshold;
        break;
      case "<=":
        hit = value <= p.threshold;
        break;
      case ">=":
        hit = value >= p.threshold;
        break;
      case "==":
        hit = value === p.threshold;
        break;
      default:
        throw new Error(`unknown predicate op: ${String(p.op)}`);
    }
    if (hit) fired.push(p.field);
  }
  return fired;
}

/** Deterministic canonical JSON: sorted keys, fixed array order, no spaces. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`)
    .join(",")}}`;
}

function validateFixture(fixture: ScenarioFixture): void {
  if (typeof fixture.scenario_id !== "string" || fixture.scenario_id.length === 0) {
    throw new Error("fixture: missing scenario_id");
  }
  if (fixture.seed !== SEED) {
    throw new Error(
      `fixture ${fixture.scenario_id}: seed mismatch (expected ${SEED})`,
    );
  }
  const layout = fixture.layout;
  if (
    layout.anchor !== "bottom" &&
    layout.anchor !== "top"
  ) {
    throw new Error(`fixture ${fixture.scenario_id}: bad layout anchor`);
  }
  for (const n of [
    layout.offsetMilli,
    layout.xMilli,
    layout.widthMilli,
    layout.heightMilli,
    fixture.viewport.layoutWidth,
    fixture.viewport.layoutHeight,
    fixture.keyboard.heightMilli,
  ]) {
    if (!isInt(n)) {
      throw new Error(`fixture ${fixture.scenario_id}: non-integer geometry input`);
    }
  }
  if (fixture.viewport.layoutWidth <= 0 || fixture.viewport.layoutHeight <= 0) {
    throw new Error(`fixture ${fixture.scenario_id}: non-positive viewport`);
  }
  if (!Array.isArray(fixture.events) || !Array.isArray(fixture.failure_predicates)) {
    throw new Error(`fixture ${fixture.scenario_id}: events/predicates must be arrays`);
  }
}

function unknownResult(
  fixture: ScenarioFixture,
  reason: string,
  failedEventId: string | null,
  initial: ViewportState,
): ScenarioResult {
  return {
    scenarioId: fixture.scenario_id,
    scenarioSha256: "",
    seed: fixture.seed,
    layoutTemplate: fixture.layout.template,
    mode: fixture.mode,
    status: "UNKNOWN",
    reason,
    failedEventId,
    replayStatus: "NOT_RUN",
    finalState: initial,
    finalMetrics: null,
    failedPredicates: [],
    firstFailedStepIndex: null,
    expectedStatus: fixture.expected_status,
    plantedError: fixture.planted_error,
    panReports: [],
    steps: [],
  };
}

/**
 * Analyse one scenario fixture end to end: validate, replay the event
 * timeline through the T002 state machine, compute geometry per step,
 * evaluate predicates, and decide the final status. `scenarioSha256` is
 * filled in by `analyzeScenarios` (needs the shared hash helper, which
 * lives in the scripts to keep this module free of node imports).
 */
export function analyzeScenario(
  fixture: ScenarioFixture,
  scenarioSha256: string,
): ScenarioResult {
  validateFixture(fixture);
  const initial = initialState(
    fixture.viewport.layoutWidth,
    fixture.viewport.layoutHeight,
    fixture.mode as ViewportMode,
  );
  if (!VIEWPORT_MODES.includes(fixture.mode)) {
    const firstId =
      fixture.events.length > 0 &&
      typeof (fixture.events[0] as Record<string, unknown>).id === "string"
        ? String((fixture.events[0] as Record<string, unknown>).id)
        : null;
    return {
      ...unknownResult(fixture, "unsupported_mode", firstId, initial),
      scenarioSha256,
      replayStatus: "NOT_RUN",
    };
  }
  const mode = fixture.mode as ViewportMode;
  const scale = fixture.profile?.scale ?? 1;
  // Rebuild typed events from the fixture JSON (the state machine takes
  // typed events; the fixture stores them as plain JSON).
  const events = fixture.events as unknown as Parameters<
    typeof replay
  >[1];
  const replayed = replay(initial, events, mode, { scale });
  const steps: Array<StepGeometry> = [];
  let firstFailedStepIndex: number | null = null;
  let geometryInvalid = false;
  let invalidReason: string | null = null;
  // Replay stops at the first UNKNOWN event; only successful steps get a
  // geometry entry. `replay` returns only the final state, so walk the
  // events again one transition at a time, collecting the state after
  // each successful event.
  const stepStates = stepStatesOf(initial, events, mode, scale);
  for (let i = 0; i < stepStates.length; i++) {
    const state = stepStates[i];
    const event = events[i] as unknown as Record<string, unknown>;
    const surface = surfaceRectFor(fixture.layout, state);
    const expected = expectedAnchorRect(fixture.layout, state);
    const computed = computeMetrics(fixture.layout, state);
    let stepStatus: StepStatus = "PASS";
    let fired: Array<string> = [];
    if (computed.status === "INVALID") {
      geometryInvalid = true;
      invalidReason = computed.reason;
      stepStatus = "INVALID";
    } else if (computed.metrics !== null) {
      fired = evaluatePredicates(computed.metrics, fixture.failure_predicates);
      stepStatus = fired.length > 0 ? "FAIL" : "PASS";
      if (fired.length > 0 && firstFailedStepIndex === null) {
        firstFailedStepIndex = i;
      }
    }
    steps.push({
      eventId: String(event.id ?? ""),
      eventType: String(event.type ?? ""),
      atMs: Number(event.atMs ?? 0),
      state,
      surfaceRect: surface,
      expectedAnchorRect: expected,
      metrics: computed.metrics,
      stepStatus,
      failedPredicates: fired,
    });
  }
  const finalState = stepStates.length > 0 ? stepStates[stepStates.length - 1] : initial;
  const finalStep = steps.length > 0 ? steps[steps.length - 1] : null;
  const finalMetrics = finalStep !== null ? finalStep.metrics : null;
  if (replayed.status === "UNKNOWN") {
    return {
      scenarioId: fixture.scenario_id,
      scenarioSha256,
      seed: fixture.seed,
      layoutTemplate: fixture.layout.template,
      mode: fixture.mode,
      status: "UNKNOWN",
      reason: replayed.reason,
      failedEventId: replayed.failedEventId,
      replayStatus: "UNKNOWN",
      finalState,
      finalMetrics,
      failedPredicates: [],
      firstFailedStepIndex,
      expectedStatus: fixture.expected_status,
      plantedError: fixture.planted_error,
      panReports: replayed.panReports,
      steps,
    };
  }
  if (geometryInvalid) {
    return {
      scenarioId: fixture.scenario_id,
      scenarioSha256,
      seed: fixture.seed,
      layoutTemplate: fixture.layout.template,
      mode: fixture.mode,
      status: "INVALID",
      reason: invalidReason,
      failedEventId: null,
      replayStatus: "OK",
      finalState,
      finalMetrics,
      failedPredicates: [],
      firstFailedStepIndex,
      expectedStatus: fixture.expected_status,
      plantedError: fixture.planted_error,
      panReports: replayed.panReports,
      steps,
    };
  }
  const finalFired = finalStep !== null ? finalStep.failedPredicates : [];
  return {
    scenarioId: fixture.scenario_id,
    scenarioSha256,
    seed: fixture.seed,
    layoutTemplate: fixture.layout.template,
    mode: fixture.mode,
    status: finalFired.length > 0 ? "FAIL" : "PASS",
    reason: null,
    failedEventId: null,
    replayStatus: "OK",
    finalState,
    finalMetrics,
    failedPredicates: finalFired,
    firstFailedStepIndex,
    expectedStatus: fixture.expected_status,
    plantedError: fixture.planted_error,
    panReports: replayed.panReports,
    steps,
  };
}

/**
 * States after each successful event, in order. Stops before the first
 * event whose transition is UNKNOWN (mirrors `replay` exactly).
 */
function stepStatesOf(
  initial: ViewportState,
  events: ReadonlyArray<unknown>,
  mode: ViewportMode,
  scale: number,
): Array<ViewportState> {
  const states: Array<ViewportState> = [];
  let state = initial;
  for (const event of events) {
    const result = transition(
      state,
      event as Parameters<typeof transition>[1],
      mode,
      { scale },
    );
    if (result.status === "UNKNOWN") break;
    state = result.state;
    states.push(state);
  }
  return states;
}
