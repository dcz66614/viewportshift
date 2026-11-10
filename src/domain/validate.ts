/**
 * P021 ViewportShift — schema validation for `viewportshift.scenario/v1`
 * (T004, S1).
 *
 * Contract: P021_PROJECT_BOOK.md §3.4, §4.1, §6.1–§6.2 and the frozen
 * types/constants in ./types.ts. Pure function only: `validateScenario`
 * reads its input, never mutates it, and never reads the wall clock,
 * timers, randomness, or any ambient state.
 *
 * Fixed check order (deterministic: the same input always yields the
 * same issues in the same order):
 *   1. root is a plain object
 *   2. scenario_id  3. seed  4. unit  5. layout  6. viewport
 *   7. keyboard  8. mode  9. events (per-event, then clock regression,
 *      then duplicate ids)  10. failure_predicates  11. limits
 *   12. profile.scale  13. events.length vs limits.maxEvents
 * Dependent checks (keyboard height vs layoutHeight, pan delta vs
 * maxPanMilli) run only when their inputs are valid integers; a
 * missing/invalid prerequisite is reported once, at its own path.
 *
 * Outcome rule: any INVALID issue makes the outcome INVALID; otherwise
 * any UNKNOWN issue makes it UNKNOWN; otherwise VALID. INVALID
 * dominates UNKNOWN. The `scenario` field of the result is the
 * normalized typed scenario exactly when the outcome is VALID, else
 * null. Normalization fills the frozen defaults for optional `limits`
 * fields (`maxDepth`, `maxNodes`, `scale`) and for `profile`.
 *
 * Unit rule (no implicit conversion, no guessing): all numeric fields
 * are integers in milli-px (see types.ts). A dimension supplied as a
 * unit-suffixed string such as "390px" is INVALID (`illegal_unit`);
 * an explicit `unit` field must equal SCHEMA_UNIT. A missing `unit`
 * field is not an error: v1 fixes the unit at schema level, so there
 * is nothing to guess — this is what lets the unit-less S0 fixtures
 * validate.
 *
 * This module performs static validation only. It does not run the
 * viewport state machine, evaluate geometry, or search for witnesses
 * (T005–T008 own those); the static range checks here (clock
 * monotonicity, keyboard height vs layoutHeight, pan/event limits)
 * mirror the S0 fail-closed classifications so that validation and
 * analysis agree on every S0 fixture.
 */

import {
  DEFAULT_LIMITS,
  EVENT_TYPES,
  LAYOUT_ANCHORS,
  LAYOUT_TEMPLATES,
  MAX_AT_MS,
  MAX_DEPTH_LIMIT,
  MAX_DIMENSION_MILLI,
  MAX_EVENTS_LIMIT,
  MAX_NODES_LIMIT,
  PREDICATE_FIELDS,
  PREDICATE_OPS,
  SCHEMA_UNIT,
  VIEWPORT_MODES,
} from "./types.ts";
import type {
  FailurePredicate,
  LayoutTemplate,
  Scenario,
  ScenarioEvent,
  ValidationCode,
  ValidationIssue,
  ValidationOutcome,
  ValidationResult,
} from "./types.ts";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True when the value is a string carrying a unit suffix, e.g. "390px". */
function looksLikeUnitString(value: string): boolean {
  return /^-?\d+(\.\d+)?\s*[a-zA-Z%]+$/.test(value.trim());
}

class Collector {
  readonly issues: Array<ValidationIssue> = [];

  add(code: ValidationCode, path: string, message: string): void {
    this.issues.push({ code, path, message });
  }

  hasInvalid(): boolean {
    return this.issues.some((issue) => isInvalidCode(issue.code));
  }

  hasUnknown(): boolean {
    return this.issues.some((issue) => !isInvalidCode(issue.code));
  }
}

const INVALID_CODES: ReadonlySet<ValidationCode> = new Set([
  "missing_field",
  "invalid_type",
  "invalid_value",
  "non_integer_value",
  "illegal_unit",
  "invalid_enum",
  "negative_size",
  "zero_area_surface",
  "non_positive_viewport",
  "value_out_of_range",
  "invalid_limits",
  "duplicate_event_id",
  "invalid_at_ms",
]);

function isInvalidCode(code: ValidationCode): boolean {
  return INVALID_CODES.has(code);
}

/**
 * Validate a required string field: missing, wrong type, or empty.
 * Returns the string when usable, else null (issue already recorded).
 */
function checkRequiredString(
  c: Collector,
  obj: UnknownRecord,
  field: string,
  path: string,
): string | null {
  if (!(field in obj) || obj[field] === undefined) {
    c.add("missing_field", path, `missing required field: ${field}`);
    return null;
  }
  const value = obj[field];
  if (typeof value !== "string") {
    c.add("invalid_type", path, `${field} must be a string`);
    return null;
  }
  if (value.length === 0) {
    c.add("invalid_value", path, `${field} must not be empty`);
    return null;
  }
  return value;
}

/**
 * Validate a required integer field in [min, max].
 * `negativeCode` is used for values below `min` when min is 0 and the
 * field is a dimension; otherwise `value_out_of_range` / `invalid_at_ms`
 * apply via `belowCode`. Returns the number when usable, else null.
 */
function checkRequiredInt(
  c: Collector,
  obj: UnknownRecord,
  field: string,
  path: string,
  opts: { min: number; max: number; belowCode: ValidationCode },
): number | null {
  if (!(field in obj) || obj[field] === undefined) {
    c.add("missing_field", path, `missing required field: ${field}`);
    return null;
  }
  const value = obj[field];
  if (typeof value === "string" && looksLikeUnitString(value)) {
    c.add(
      "illegal_unit",
      path,
      `${field} must be an integer in milli-px, not a unit-suffixed string`,
    );
    return null;
  }
  if (typeof value !== "number") {
    c.add("invalid_type", path, `${field} must be a number`);
    return null;
  }
  if (!Number.isInteger(value)) {
    c.add("non_integer_value", path, `${field} must be an integer`);
    return null;
  }
  if (value < opts.min) {
    c.add(opts.belowCode, path, `${field} is below its minimum (${opts.min})`);
    return null;
  }
  if (value > opts.max) {
    c.add(
      "value_out_of_range",
      path,
      `${field} exceeds its maximum (${opts.max})`,
    );
    return null;
  }
  return value;
}

function checkLayout(c: Collector, input: UnknownRecord): void {
  if (!("layout" in input) || input.layout === undefined) {
    c.add("missing_field", "layout", "missing required field: layout");
    return;
  }
  const layout = input.layout;
  if (!isRecord(layout)) {
    c.add("invalid_type", "layout", "layout must be an object");
    return;
  }
  if (!("template" in layout) || layout.template === undefined) {
    c.add("missing_field", "layout.template", "missing required field: template");
  } else if (typeof layout.template !== "string") {
    c.add("invalid_type", "layout.template", "template must be a string");
  } else if (
    !(LAYOUT_TEMPLATES as ReadonlyArray<string>).includes(layout.template)
  ) {
    c.add(
      "unsupported_layout_template",
      "layout.template",
      `unsupported layout template: ${layout.template}`,
    );
  }
  if (!("anchor" in layout) || layout.anchor === undefined) {
    c.add("missing_field", "layout.anchor", "missing required field: anchor");
  } else if (typeof layout.anchor !== "string") {
    c.add("invalid_type", "layout.anchor", "anchor must be a string");
  } else if (!(LAYOUT_ANCHORS as ReadonlyArray<string>).includes(layout.anchor)) {
    c.add(
      "invalid_enum",
      "layout.anchor",
      `anchor must be one of: ${LAYOUT_ANCHORS.join(", ")}`,
    );
  }
  checkRequiredInt(c, layout, "offsetMilli", "layout.offsetMilli", {
    min: 0,
    max: MAX_DIMENSION_MILLI,
    belowCode: "negative_size",
  });
  checkRequiredInt(c, layout, "xMilli", "layout.xMilli", {
    min: 0,
    max: MAX_DIMENSION_MILLI,
    belowCode: "negative_size",
  });
  const width = checkRequiredInt(c, layout, "widthMilli", "layout.widthMilli", {
    min: 0,
    max: MAX_DIMENSION_MILLI,
    belowCode: "negative_size",
  });
  const height = checkRequiredInt(c, layout, "heightMilli", "layout.heightMilli", {
    min: 0,
    max: MAX_DIMENSION_MILLI,
    belowCode: "negative_size",
  });
  if (
    width !== null &&
    height !== null &&
    (width === 0 || height === 0)
  ) {
    c.add(
      "zero_area_surface",
      "layout",
      "surface area must be positive (zero-area surface is INVALID)",
    );
  }
}

function checkViewport(c: Collector, input: UnknownRecord): number | null {
  if (!("viewport" in input) || input.viewport === undefined) {
    c.add("missing_field", "viewport", "missing required field: viewport");
    return null;
  }
  const viewport = input.viewport;
  if (!isRecord(viewport)) {
    c.add("invalid_type", "viewport", "viewport must be an object");
    return null;
  }
  let layoutHeight: number | null = null;
  for (const field of ["layoutWidth", "layoutHeight"] as const) {
    const path = `viewport.${field}`;
    if (!(field in viewport) || viewport[field] === undefined) {
      c.add("missing_field", path, `missing required field: ${field}`);
      continue;
    }
    const value = viewport[field];
    if (typeof value === "string" && looksLikeUnitString(value)) {
      c.add(
        "illegal_unit",
        path,
        `${field} must be an integer in milli-px, not a unit-suffixed string`,
      );
      continue;
    }
    if (typeof value !== "number") {
      c.add("invalid_type", path, `${field} must be a number`);
      continue;
    }
    if (!Number.isInteger(value)) {
      c.add("non_integer_value", path, `${field} must be an integer`);
      continue;
    }
    if (value <= 0) {
      c.add(
        "non_positive_viewport",
        path,
        `${field} must be positive`,
      );
      continue;
    }
    if (value > MAX_DIMENSION_MILLI) {
      c.add(
        "value_out_of_range",
        path,
        `${field} exceeds its maximum (${MAX_DIMENSION_MILLI})`,
      );
      continue;
    }
    if (field === "layoutHeight") layoutHeight = value;
  }
  return layoutHeight;
}

function checkKeyboard(
  c: Collector,
  input: UnknownRecord,
  layoutHeight: number | null,
): void {
  if (!("keyboard" in input) || input.keyboard === undefined) {
    c.add("missing_field", "keyboard", "missing required field: keyboard");
    return;
  }
  const keyboard = input.keyboard;
  if (!isRecord(keyboard)) {
    c.add("invalid_type", "keyboard", "keyboard must be an object");
    return;
  }
  const height = checkRequiredInt(
    c,
    keyboard,
    "heightMilli",
    "keyboard.heightMilli",
    {
      min: 0,
      max: MAX_DIMENSION_MILLI,
      belowCode: "negative_size",
    },
  );
  if (
    height !== null &&
    layoutHeight !== null &&
    height > layoutHeight
  ) {
    c.add(
      "keyboard_height_out_of_range",
      "keyboard.heightMilli",
      "keyboard height exceeds the layout viewport height",
    );
  }
}

function checkMode(c: Collector, input: UnknownRecord): void {
  if (!("mode" in input) || input.mode === undefined) {
    c.add("missing_field", "mode", "missing required field: mode");
    return;
  }
  const mode = input.mode;
  if (typeof mode !== "string") {
    c.add("invalid_type", "mode", "mode must be a string");
    return;
  }
  if (!(VIEWPORT_MODES as ReadonlyArray<string>).includes(mode)) {
    c.add("unsupported_mode", "mode", `unsupported viewport mode: ${mode}`);
  }
}

function checkEventCommon(
  c: Collector,
  event: UnknownRecord,
  path: string,
): { id: string | null; atMs: number | null } {
  const id = checkRequiredString(c, event, "id", `${path}.id`);
  let atMs: number | null = null;
  if (!("atMs" in event) || event.atMs === undefined) {
    c.add("missing_field", `${path}.atMs`, "missing required field: atMs");
  } else if (typeof event.atMs !== "number") {
    c.add("invalid_type", `${path}.atMs`, "atMs must be a number");
  } else if (!Number.isInteger(event.atMs)) {
    c.add("non_integer_value", `${path}.atMs`, "atMs must be an integer");
  } else if (event.atMs < 0 || event.atMs > MAX_AT_MS) {
    c.add(
      "invalid_at_ms",
      `${path}.atMs`,
      `atMs must be within [0, ${MAX_AT_MS}]`,
    );
  } else {
    atMs = event.atMs;
  }
  return { id, atMs };
}

function checkDeltaPair(
  c: Collector,
  event: UnknownRecord,
  path: string,
  maxPanMilli: number | null,
  isPan: boolean,
): void {
  for (const field of ["dx", "dy"] as const) {
    const value = checkRequiredInt(c, event, field, `${path}.${field}`, {
      min: -MAX_DIMENSION_MILLI,
      max: MAX_DIMENSION_MILLI,
      belowCode: "value_out_of_range",
    });
    if (
      isPan &&
      value !== null &&
      maxPanMilli !== null &&
      Math.abs(value) > maxPanMilli
    ) {
      c.add(
        "pan_limit_exceeded",
        `${path}.${field}`,
        `pan delta exceeds limits.maxPanMilli (${maxPanMilli})`,
      );
    }
  }
}

function checkEvents(
  c: Collector,
  input: UnknownRecord,
  layoutHeight: number | null,
  maxPanMilli: number | null,
): Array<UnknownRecord> {
  if (!("events" in input) || input.events === undefined) {
    c.add("missing_field", "events", "missing required field: events");
    return [];
  }
  const events = input.events;
  if (!Array.isArray(events)) {
    c.add("invalid_type", "events", "events must be an array");
    return [];
  }
  const parsed: Array<UnknownRecord> = [];
  const clock: Array<number | null> = [];
  events.forEach((raw, index) => {
    const path = `events[${index}]`;
    if (!isRecord(raw)) {
      c.add("invalid_type", path, "event must be an object");
      clock.push(null);
      return;
    }
    parsed.push(raw);
    const { atMs } = checkEventCommon(c, raw, path);
    clock.push(atMs);
    if (!("type" in raw) || raw.type === undefined) {
      c.add("missing_field", `${path}.type`, "missing required field: type");
      return;
    }
    const type = raw.type;
    if (typeof type !== "string") {
      c.add("invalid_type", `${path}.type`, "type must be a string");
      return;
    }
    if (!(EVENT_TYPES as ReadonlyArray<string>).includes(type)) {
      c.add(
        "unsupported_event_type",
        `${path}.type`,
        `unsupported event type: ${type}`,
      );
      return;
    }
    if (type === "KEYBOARD_OPEN") {
      const height = checkRequiredInt(c, raw, "keyboardHeight", `${path}.keyboardHeight`, {
        min: 0,
        max: MAX_DIMENSION_MILLI,
        belowCode: "negative_size",
      });
      if (
        height !== null &&
        layoutHeight !== null &&
        height > layoutHeight
      ) {
        c.add(
          "keyboard_height_out_of_range",
          `${path}.keyboardHeight`,
          "keyboard height exceeds the layout viewport height",
        );
      }
    } else if (type === "SCROLL") {
      checkDeltaPair(c, raw, path, null, false);
    } else if (type === "DELAYED_VISUAL_PAN") {
      checkDeltaPair(c, raw, path, maxPanMilli, true);
    }
    // KEYBOARD_CLOSE and VIEWPORT_SETTLED carry no extra parameters.
  });
  // Cross-event checks, in fixture order: clock monotonicity, then ids.
  for (let i = 1; i < clock.length; i++) {
    const prev = clock[i - 1];
    const curr = clock[i];
    if (prev !== null && curr !== null && curr < prev) {
      c.add(
        "event_clock_regression",
        `events[${i}].atMs`,
        `event clock regressed: atMs ${curr} < previous ${prev}`,
      );
    }
  }
  const seen = new Set<string>();
  parsed.forEach((event, index) => {
    const id = event.id;
    if (typeof id === "string" && id.length > 0) {
      if (seen.has(id)) {
        c.add(
          "duplicate_event_id",
          `events[${index}].id`,
          `duplicate event id: ${id}`,
        );
      } else {
        seen.add(id);
      }
    }
  });
  return parsed;
}

function checkPredicates(c: Collector, input: UnknownRecord): void {
  if (
    !("failure_predicates" in input) ||
    input.failure_predicates === undefined
  ) {
    c.add(
      "missing_field",
      "failure_predicates",
      "missing required field: failure_predicates",
    );
    return;
  }
  const predicates = input.failure_predicates;
  if (!Array.isArray(predicates)) {
    c.add(
      "invalid_type",
      "failure_predicates",
      "failure_predicates must be an array",
    );
    return;
  }
  predicates.forEach((raw, index) => {
    const path = `failure_predicates[${index}]`;
    if (!isRecord(raw)) {
      c.add("invalid_type", path, "predicate must be an object");
      return;
    }
    if (!("field" in raw) || raw.field === undefined) {
      c.add("missing_field", `${path}.field`, "missing required field: field");
    } else if (typeof raw.field !== "string") {
      c.add("invalid_type", `${path}.field`, "field must be a string");
    } else if (
      !(PREDICATE_FIELDS as ReadonlyArray<string>).includes(raw.field)
    ) {
      c.add(
        "invalid_enum",
        `${path}.field`,
        `field must be one of: ${PREDICATE_FIELDS.join(", ")}`,
      );
    }
    if (!("op" in raw) || raw.op === undefined) {
      c.add("missing_field", `${path}.op`, "missing required field: op");
    } else if (typeof raw.op !== "string") {
      c.add("invalid_type", `${path}.op`, "op must be a string");
    } else if (!(PREDICATE_OPS as ReadonlyArray<string>).includes(raw.op)) {
      c.add(
        "invalid_enum",
        `${path}.op`,
        `op must be one of: ${PREDICATE_OPS.join(", ")}`,
      );
    }
    checkRequiredInt(c, raw, "threshold", `${path}.threshold`, {
      min: -MAX_DIMENSION_MILLI,
      max: MAX_DIMENSION_MILLI,
      belowCode: "value_out_of_range",
    });
  });
}

/**
 * Validate `limits` and return the usable maxEvents / maxPanMilli
 * values (null when unusable, so dependent checks are skipped and the
 * malformed-limits issue is reported exactly once, here).
 */
function checkLimits(
  c: Collector,
  input: UnknownRecord,
): { maxEvents: number | null; maxPanMilli: number | null } {
  const empty = { maxEvents: null, maxPanMilli: null };
  if (!("limits" in input) || input.limits === undefined) {
    c.add("missing_field", "limits", "missing required field: limits");
    return empty;
  }
  const limits = input.limits;
  if (!isRecord(limits)) {
    c.add("invalid_type", "limits", "limits must be an object");
    return empty;
  }
  let maxEvents: number | null = null;
  let maxPanMilli: number | null = null;
  if (!("maxEvents" in limits) || limits.maxEvents === undefined) {
    c.add("missing_field", "limits.maxEvents", "missing required field: maxEvents");
  } else if (typeof limits.maxEvents !== "number") {
    c.add("invalid_type", "limits.maxEvents", "maxEvents must be a number");
  } else if (!Number.isInteger(limits.maxEvents)) {
    c.add("non_integer_value", "limits.maxEvents", "maxEvents must be an integer");
  } else if (limits.maxEvents < 1 || limits.maxEvents > MAX_EVENTS_LIMIT) {
    c.add(
      "invalid_limits",
      "limits.maxEvents",
      `maxEvents must be within [1, ${MAX_EVENTS_LIMIT}]`,
    );
  } else {
    maxEvents = limits.maxEvents;
  }
  if (!("maxPanMilli" in limits) || limits.maxPanMilli === undefined) {
    c.add("missing_field", "limits.maxPanMilli", "missing required field: maxPanMilli");
  } else if (typeof limits.maxPanMilli !== "number") {
    c.add("invalid_type", "limits.maxPanMilli", "maxPanMilli must be a number");
  } else if (!Number.isInteger(limits.maxPanMilli)) {
    c.add("non_integer_value", "limits.maxPanMilli", "maxPanMilli must be an integer");
  } else if (limits.maxPanMilli < 0 || limits.maxPanMilli > MAX_DIMENSION_MILLI) {
    c.add(
      "invalid_limits",
      "limits.maxPanMilli",
      `maxPanMilli must be within [0, ${MAX_DIMENSION_MILLI}]`,
    );
  } else {
    maxPanMilli = limits.maxPanMilli;
  }
  for (const [field, max] of [
    ["maxDepth", MAX_DEPTH_LIMIT],
    ["maxNodes", MAX_NODES_LIMIT],
  ] as const) {
    if (field in limits && limits[field] !== undefined) {
      const value = limits[field];
      if (typeof value !== "number") {
        c.add("invalid_type", `limits.${field}`, `${field} must be a number`);
      } else if (!Number.isInteger(value)) {
        c.add("non_integer_value", `limits.${field}`, `${field} must be an integer`);
      } else if (value < 1 || value > max) {
        c.add(
          "invalid_limits",
          `limits.${field}`,
          `${field} must be within [1, ${max}]`,
        );
      }
    }
  }
  if ("scale" in limits && limits.scale !== undefined) {
    if (typeof limits.scale !== "number") {
      c.add("invalid_type", "limits.scale", "scale must be a number");
    }
    // Value is intentionally not enforced here: the effective scale is
    // profile.scale (see types.ts); limits.scale is S0-compat metadata.
  }
  return { maxEvents, maxPanMilli };
}

function checkProfile(c: Collector, input: UnknownRecord): void {
  if (!("profile" in input) || input.profile === undefined) {
    return;
  }
  const profile = input.profile;
  if (!isRecord(profile)) {
    c.add("invalid_type", "profile", "profile must be an object");
    return;
  }
  if ("scale" in profile && profile.scale !== undefined) {
    if (typeof profile.scale !== "number") {
      c.add("invalid_type", "profile.scale", "scale must be a number");
    } else if (profile.scale !== 1) {
      c.add(
        "unsupported_scale",
        "profile.scale",
        `unsupported scale: ${profile.scale} (MVP scale is fixed at 1)`,
      );
    }
  }
}

/**
 * Validate an unknown value as a `viewportshift.scenario/v1` scenario.
 * Never mutates its input. Issues are emitted in fixed check order,
 * so the same input always yields the same codes.
 */
export function validateScenario(input: unknown): ValidationResult {
  const c = new Collector();
  if (!isRecord(input)) {
    c.add("invalid_type", "$", "scenario must be an object");
    return { outcome: "INVALID", issues: c.issues, scenario: null };
  }

  const scenarioId = checkRequiredString(c, input, "scenario_id", "scenario_id");
  checkRequiredString(c, input, "seed", "seed");

  if ("unit" in input && input.unit !== undefined) {
    if (typeof input.unit !== "string") {
      c.add("invalid_type", "unit", "unit must be a string");
    } else if (input.unit !== SCHEMA_UNIT) {
      c.add(
        "illegal_unit",
        "unit",
        `unit must be ${SCHEMA_UNIT} (all values are integers in milli-px)`,
      );
    }
  }

  checkLayout(c, input);
  const layoutHeight = checkViewport(c, input);
  checkKeyboard(c, input, layoutHeight);
  checkMode(c, input);

  // limits.maxPanMilli is needed by the per-event pan check, so read
  // limits first (its own issues are recorded here, in field order
  // after failure_predicates only in the emitted sequence — the
  // collector preserves insertion order, and limits issues are added
  // by checkLimits below; to keep the documented order
  // events(9) < predicates(10) < limits(11), the pan check re-reads
  // the raw value leniently instead of depending on checkLimits).
  const rawMaxPan =
    isRecord(input.limits) &&
    typeof input.limits.maxPanMilli === "number" &&
    Number.isInteger(input.limits.maxPanMilli) &&
    input.limits.maxPanMilli >= 0
      ? input.limits.maxPanMilli
      : null;
  const events = checkEvents(c, input, layoutHeight, rawMaxPan);
  checkPredicates(c, input);
  const { maxEvents } = checkLimits(c, input);
  checkProfile(c, input);
  if (maxEvents !== null && events.length > maxEvents) {
    c.add(
      "event_limit_exceeded",
      "events",
      `event count ${events.length} exceeds limits.maxEvents (${maxEvents})`,
    );
  }

  let outcome: ValidationOutcome = "VALID";
  if (c.hasInvalid()) outcome = "INVALID";
  else if (c.hasUnknown()) outcome = "UNKNOWN";

  if (outcome !== "VALID" || scenarioId === null) {
    return { outcome, issues: c.issues, scenario: null };
  }

  // Normalize: all structural checks passed, so every field below is
  // present with the right type (casts are safe by construction).
  const layout = input.layout as UnknownRecord;
  const viewport = input.viewport as UnknownRecord;
  const keyboard = input.keyboard as UnknownRecord;
  const limits = input.limits as UnknownRecord;
  const profile = isRecord(input.profile) ? input.profile : {};
  const scenario: Scenario = {
    scenario_id: scenarioId,
    seed: input.seed as string,
    unit: SCHEMA_UNIT,
    layout: {
      template: layout.template as LayoutTemplate,
      anchor: layout.anchor as "bottom" | "top",
      offsetMilli: layout.offsetMilli as number,
      xMilli: layout.xMilli as number,
      widthMilli: layout.widthMilli as number,
      heightMilli: layout.heightMilli as number,
    },
    viewport: {
      layoutWidth: viewport.layoutWidth as number,
      layoutHeight: viewport.layoutHeight as number,
    },
    keyboard: {
      heightMilli: keyboard.heightMilli as number,
    },
    mode: input.mode as Scenario["mode"],
    events: events as unknown as Array<ScenarioEvent>,
    failure_predicates: input.failure_predicates as unknown as Array<FailurePredicate>,
    limits: {
      maxEvents: limits.maxEvents as number,
      maxPanMilli: limits.maxPanMilli as number,
      maxDepth:
        typeof limits.maxDepth === "number"
          ? limits.maxDepth
          : DEFAULT_LIMITS.maxDepth,
      maxNodes:
        typeof limits.maxNodes === "number"
          ? limits.maxNodes
          : DEFAULT_LIMITS.maxNodes,
      scale:
        typeof limits.scale === "number"
          ? limits.scale
          : DEFAULT_LIMITS.scale,
    },
    profile: {
      scale:
        typeof profile.scale === "number"
          ? profile.scale
          : DEFAULT_LIMITS.scale,
    },
  };
  return { outcome, issues: c.issues, scenario };
}
