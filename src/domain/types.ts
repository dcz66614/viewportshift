/**
 * P021 ViewportShift — frozen scenario/result Schema (T004, S1).
 *
 * Contract: P021_PROJECT_BOOK.md §4.1–§4.6, §6.1–§6.2
 * (SPEC_VERSION 1.0.0) and P021_IMPLEMENTATION_PLAN.md §5 (T004), §6.
 *
 * Schema identity: `viewportshift.scenario/v1`.
 *
 * Frozen decisions (v1 — a change to any of these is a schema revision,
 * not a silent edit):
 *
 * - Units: every numeric geometry field is an integer in fixed-point
 *   milli-CSS-px (1 unit = 1/1000 CSS px, PROJECT_BOOK §4.1). The unit
 *   is declared by the schema version itself, not chosen per scenario:
 *   S0 fixtures carry no `unit` field and validate, because v1 fixes
 *   the unit. An explicit per-scenario `unit` field, when present, must
 *   equal SCHEMA_UNIT (`css-px-milli`); any other value is INVALID
 *   (`illegal_unit`). A dimension supplied as a unit-suffixed string
 *   (for example `"390px"`) is likewise INVALID (`illegal_unit`).
 *   There is no implicit unit conversion anywhere: a missing or
 *   illegal unit is INVALID, never guessed.
 * - Field names and value domains are taken from the project book and
 *   the S0 fixtures — no invented field names or units. The S0 fixture
 *   shape (`scenario_id`, `seed`, `layout`, `viewport`, `keyboard`,
 *   `mode`, `events`, `failure_predicates`, `limits`, plus the
 *   fixture-only `expected_status` / `planted_error` / `profile`) is
 *   the v1 wire shape; `expected_status` / `planted_error` are test
 *   metadata, not scenario fields, and are ignored by validation.
 * - Fixed-point integers only: no binary floating-point comparison
 *   decides anything. Non-integer numbers are INVALID
 *   (`non_integer_value`). `visibleRatio` is an integer milli-ratio
 *   (0..1000, floor(visibleArea * 1000 / surfaceArea)), never a float
 *   (S0-frozen convention, see geometry.ts).
 * - `scale` is fixed at 1 (MVP, §4.1). The effective scale is
 *   `profile.scale` (default 1); any other value is UNKNOWN
 *   (`unsupported_scale`). `limits.scale`, when present, is accepted
 *   for S0 compatibility and type-checked, but it does not set the
 *   effective scale (this mirrors the S0 implementation, which reads
 *   `profile.scale` only).
 * - Outcome classification (validate.ts implements this):
 *   structural violations (missing field, wrong type, negative size,
 *   zero-area surface, non-positive viewport, bad closed enum,
 *   malformed limits, duplicate event id) are INVALID; well-formed
 *   inputs outside the modelled range (non-1 scale, unknown mode /
 *   event type / layout template, event-clock regression,
 *   keyboard height out of range, event-count / pan limits exceeded)
 *   are UNKNOWN, per PROJECT_BOOK §3.4. INVALID dominates UNKNOWN
 *   when both kinds of issue are present.
 * - Unknown extra fields are ignored (PROJECT_BOOK §6.1 says a
 *   scenario contains "at least" the listed fields). A typo that
 *   drops a required field is still caught as `missing_field`.
 * - Frozen numeric bounds (v1): layout dimensions and deltas are at
 *   most MAX_DIMENSION_MILLI milli-px; `atMs` is an int32 millisecond
 *   clock; `limits` values are bounded (see DEFAULT_LIMITS and the
 *   MAX_*_LIMIT constants). `maxDepth` / `maxNodes` are the frozen BFS
 *   bounds required by §4.5; they are optional in the wire shape and
 *   default to DEFAULT_LIMITS when absent.
 *
 * This module is pure schema: types and frozen constants only. It does
 * no I/O, reads no clock/timer/randomness, and implements no mode
 * evaluator, event model, geometry, or search (T005–T008 own those).
 */

export const SCHEMA_VERSION = "viewportshift.scenario/v1";
export const SCHEMA_SPEC_VERSION = "1.0.0";
/** Frozen unit id: integers in 1/1000 CSS px (§4.1). */
export const SCHEMA_UNIT = "css-px-milli";

/** Largest admissible dimension / delta, in milli-px (= 10,000 CSS px). */
export const MAX_DIMENSION_MILLI = 10_000_000;
/** Largest admissible event timestamp, in ms (int32 max). */
export const MAX_AT_MS = 2_147_483_647;
/** Largest admissible `limits.maxEvents` value (v1 bound). */
export const MAX_EVENTS_LIMIT = 64;
/** Largest admissible `limits.maxDepth` value (v1 bound). */
export const MAX_DEPTH_LIMIT = 16;
/** Largest admissible `limits.maxNodes` value (v1 bound). */
export const MAX_NODES_LIMIT = 1_000_000;

export type ViewportMode =
  | "resizes-visual"
  | "resizes-content"
  | "overlays-content";

export const VIEWPORT_MODES: ReadonlyArray<ViewportMode> = [
  "resizes-visual",
  "resizes-content",
  "overlays-content",
];

export type EventType =
  | "KEYBOARD_OPEN"
  | "KEYBOARD_CLOSE"
  | "SCROLL"
  | "DELAYED_VISUAL_PAN"
  | "VIEWPORT_SETTLED";

export const EVENT_TYPES: ReadonlyArray<EventType> = [
  "KEYBOARD_OPEN",
  "KEYBOARD_CLOSE",
  "SCROLL",
  "DELAYED_VISUAL_PAN",
  "VIEWPORT_SETTLED",
];

/**
 * The four frozen synthetic layout templates (§1.2, §3.3; S0 uses all
 * four). A template name outside this set is UNKNOWN
 * (`unsupported_layout_template`), not INVALID: the input is
 * well-formed but outside the modelled template set.
 */
export type LayoutTemplate =
  | "chat-input"
  | "bottom-sheet"
  | "fixed-cta"
  | "search-bar";

export const LAYOUT_TEMPLATES: ReadonlyArray<LayoutTemplate> = [
  "chat-input",
  "bottom-sheet",
  "fixed-cta",
  "search-bar",
];

export type LayoutAnchor = "bottom" | "top";
export const LAYOUT_ANCHORS: ReadonlyArray<LayoutAnchor> = [
  "bottom",
  "top",
];

export type AnalysisStatus =
  | "PASS"
  | "FAIL"
  | "UNKNOWN"
  | "BOUNDED_NO_WITNESS"
  | "INVALID";

/**
 * Axis-aligned rectangle, fixed-point milli-px (1 unit = 1/1000 CSS px).
 * PROJECT_BOOK §6.2 names this type `Rect`; the milli-px unit is the
 * S0-frozen reading of that contract, so `Rect` is an alias of
 * `RectMilli` here.
 */
export interface RectMilli {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Rect = RectMilli;

export interface AnchorDrift {
  dx: number;
  dy: number;
  magnitude: number;
}

/**
 * Geometry metrics, PROJECT_BOOK §6.2 plus the S0-frozen `surfaceArea`
 * field. `visibleRatio` is an integer milli-ratio 0..1000, never a
 * float. All areas are in (milli-px)^2; `bottomGap` is in milli-px.
 */
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

/** A UI surface in layout coordinates (milli-px integers). */
export interface LayoutSpec {
  template: LayoutTemplate;
  anchor: LayoutAnchor;
  /** Offset from the anchor edge, milli-px, >= 0. */
  offsetMilli: number;
  /** Left edge in layout coordinates, milli-px, >= 0. */
  xMilli: number;
  /** Surface width, milli-px, > 0 (0 is INVALID: zero-area surface). */
  widthMilli: number;
  /** Surface height, milli-px, > 0 (0 is INVALID: zero-area surface). */
  heightMilli: number;
}

/** Layout viewport size, milli-px integers, both > 0. */
export interface ViewportSpec {
  layoutWidth: number;
  layoutHeight: number;
}

/** Declared keyboard geometry, milli-px integers. */
export interface KeyboardSpec {
  /** Declared keyboard height, milli-px, 0..layoutHeight. */
  heightMilli: number;
}

export type ScenarioEvent =
  | {
      type: "KEYBOARD_OPEN";
      id: string;
      atMs: number;
      /** Requested keyboard height, milli-px, 0..layoutHeight. */
      keyboardHeight: number;
    }
  | { type: "KEYBOARD_CLOSE"; id: string; atMs: number }
  | { type: "SCROLL"; id: string; atMs: number; dx: number; dy: number }
  | {
      type: "DELAYED_VISUAL_PAN";
      id: string;
      atMs: number;
      dx: number;
      dy: number;
    }
  | { type: "VIEWPORT_SETTLED"; id: string; atMs: number };

export type PredicateField =
  | "visibleRatio"
  | "keyboardObscuredArea"
  | "bottomGap"
  | "anchorDriftMagnitude";

export const PREDICATE_FIELDS: ReadonlyArray<PredicateField> = [
  "visibleRatio",
  "keyboardObscuredArea",
  "bottomGap",
  "anchorDriftMagnitude",
];

export type PredicateOp = "<" | ">" | "<=" | ">=" | "==";

export const PREDICATE_OPS: ReadonlyArray<PredicateOp> = [
  "<",
  ">",
  "<=",
  ">=",
  "==",
];

/** A failure predicate: fires when `metric(field) op threshold`. */
export interface FailurePredicate {
  field: PredicateField;
  op: PredicateOp;
  /** Integer threshold, in the metric's own unit (milli-ratio for visibleRatio). */
  threshold: number;
}

/**
 * Frozen search/validation limits (§4.5). `maxDepth` / `maxNodes` are
 * the BFS bounds; `maxEvents` caps the scenario's own event list;
 * `maxPanMilli` caps each DELAYED_VISUAL_PAN |dx| / |dy|.
 */
export interface ScenarioLimits {
  maxEvents: number;
  maxPanMilli: number;
  maxDepth: number;
  maxNodes: number;
  scale: number;
}

/** Wire shape of `limits`: `maxDepth` / `maxNodes` / `scale` are optional. */
export interface ScenarioLimitsInput {
  maxEvents: number;
  maxPanMilli: number;
  maxDepth?: number;
  maxNodes?: number;
  scale?: number;
}

/** Frozen defaults applied when optional `limits` fields are absent. */
export const DEFAULT_LIMITS: ScenarioLimits = {
  maxEvents: 8,
  maxPanMilli: 500000,
  maxDepth: 8,
  maxNodes: 10000,
  scale: 1,
};

/** Effective profile: MVP scale is fixed at 1 (§4.1). */
export interface ScenarioProfile {
  scale: number;
}

export const DEFAULT_PROFILE: ScenarioProfile = { scale: 1 };

/**
 * Frozen `viewportshift.scenario/v1` scenario (PROJECT_BOOK §6.1).
 * `unit`, when present on the wire, must equal SCHEMA_UNIT; the
 * normalized form always carries it. `profile` is optional on the
 * wire and defaults to `{ scale: 1 }`.
 */
export interface Scenario {
  scenario_id: string;
  seed: string;
  unit: typeof SCHEMA_UNIT;
  layout: LayoutSpec;
  viewport: ViewportSpec;
  keyboard: KeyboardSpec;
  mode: ViewportMode;
  events: Array<ScenarioEvent>;
  failure_predicates: Array<FailurePredicate>;
  limits: ScenarioLimits;
  profile: ScenarioProfile;
}

/**
 * A scenario fixture as stored under tests/fixtures/: the frozen
 * scenario plus S0 test metadata. `expected_status` / `planted_error`
 * are fixture metadata, not schema fields; validation ignores them.
 */
export interface ScenarioFixture extends Scenario {
  expected_status?: AnalysisStatus;
  planted_error?: null | { kind: string; description: string };
}

/** Frozen result envelope for one analysed scenario (v1). */
export interface AnalysisResult {
  schemaVersion: typeof SCHEMA_VERSION;
  scenarioId: string;
  seed: string;
  mode: string;
  status: AnalysisStatus;
  reason: string | null;
  failedEventId: string | null;
  finalMetrics: GeometryMetrics | null;
  failedPredicates: Array<string>;
  firstFailedStepIndex: number | null;
}

/**
 * Stable validation error codes (v1). The same illegal input always
 * yields the same codes in the same order; codes are part of the
 * frozen contract and must not be renamed silently.
 *
 * INVALID (structurally malformed):
 * - missing_field, invalid_type, invalid_value, non_integer_value,
 *   illegal_unit, invalid_enum, negative_size, zero_area_surface,
 *   non_positive_viewport, value_out_of_range, invalid_limits,
 *   duplicate_event_id, invalid_at_ms.
 * UNKNOWN (well-formed but outside the modelled range, §3.4):
 * - unsupported_mode, unsupported_event_type,
 *   unsupported_layout_template, unsupported_scale,
 *   event_clock_regression, keyboard_height_out_of_range,
 *   event_limit_exceeded, pan_limit_exceeded.
 */
export type ValidationCode =
  | "missing_field"
  | "invalid_type"
  | "invalid_value"
  | "non_integer_value"
  | "illegal_unit"
  | "invalid_enum"
  | "negative_size"
  | "zero_area_surface"
  | "non_positive_viewport"
  | "value_out_of_range"
  | "invalid_limits"
  | "duplicate_event_id"
  | "invalid_at_ms"
  | "unsupported_mode"
  | "unsupported_event_type"
  | "unsupported_layout_template"
  | "unsupported_scale"
  | "event_clock_regression"
  | "keyboard_height_out_of_range"
  | "event_limit_exceeded"
  | "pan_limit_exceeded";

export interface ValidationIssue {
  code: ValidationCode;
  /** Dotted path, e.g. "layout.widthMilli" or "events[2].atMs"; "$" is the root. */
  path: string;
  message: string;
}

export type ValidationOutcome = "VALID" | "INVALID" | "UNKNOWN";

export interface ValidationResult {
  outcome: ValidationOutcome;
  /** In fixed check order; empty exactly when outcome is VALID. */
  issues: Array<ValidationIssue>;
  /**
   * The normalized typed scenario when the input is VALID; null
   * otherwise. UNKNOWN inputs stay null even though they are
   * well-formed: they can carry a mode / event-type / template string
   * outside the frozen enums, which the frozen `Scenario` type cannot
   * hold, and downstream evaluation must only ever receive VALID
   * scenarios. Normalization fills the frozen defaults for optional
   * `limits` fields and `profile`.
   */
  scenario: Scenario | null;
}

export function isViewportMode(value: string): value is ViewportMode {
  return (VIEWPORT_MODES as ReadonlyArray<string>).includes(value);
}

export function isEventType(value: string): value is EventType {
  return (EVENT_TYPES as ReadonlyArray<string>).includes(value);
}

export function isLayoutTemplate(value: string): value is LayoutTemplate {
  return (LAYOUT_TEMPLATES as ReadonlyArray<string>).includes(value);
}
