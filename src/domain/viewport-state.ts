/**
 * P021 ViewportShift — deterministic viewport state machine (T002 PoC).
 *
 * Contract: P021_PROJECT_BOOK.md §4.1–§4.3 (SPEC_VERSION 1.0.0).
 *
 * - All geometry uses fixed-point integers: 1 unit = 1/1000 CSS px.
 *   Every comparison used as a decision basis is an integer comparison;
 *   no binary floating-point comparison decides anything here.
 * - Pure functions only: `transition()` / `replay()` take explicit inputs
 *   and return new state objects. They never read the wall clock, timers,
 *   randomness, or any ambient state, and they never mutate their inputs.
 * - `scale` is fixed at 1 (MVP, §4.1). Any other scale is UNKNOWN, never
 *   silently reinterpreted as 1.
 * - Events are processed in array order; `atMs` must be monotonically
 *   non-decreasing. Equal timestamps keep fixture array order (§4.3).
 * - `SCROLL` updates the independent scroll offsets only; it never moves
 *   the visual-viewport offset (§4.1: scroll must not be conflated with
 *   the visual viewport offset). Only `DELAYED_VISUAL_PAN` moves the
 *   visual offset, clamped to the legal range, with requested/applied
 *   values and a clamp reason reported (§4.2).
 * - `pendingPan` holds the applied pan delta of the most recent
 *   `DELAYED_VISUAL_PAN` until a `VIEWPORT_SETTLED` event clears it.
 *   It does not change the mode identifier: a delayed pan is a pressure
 *   event, not a fourth standard mode (§4.2).
 * - On UNKNOWN the input state is returned unchanged (fail-closed); the
 *   replay stops at the first UNKNOWN event.
 *
 * Mode contracts (keyboard height h, full layout height H):
 * - `resizes-visual`: layout viewport unchanged; visual height becomes
 *   H - h; keyboard rect sits at the bottom of the layout viewport.
 * - `resizes-content`: layout height becomes H - h and the visual
 *   viewport follows the layout viewport (visual height = layout height,
 *   visual offsets clamped to 0); the keyboard rect sits directly below
 *   the shrunken layout viewport.
 * - `overlays-content`: layout and visual viewport sizes do not move;
 *   the keyboard rect overlaps the bottom of the content area. Occlusion
 *   itself is a geometry question for T003, not a state-machine one.
 *
 * This file is T002 scope only: no UI, no geometry metrics, no BFS, no
 * real-browser access. The Python Oracle stays the T001 placeholder;
 * T003 implements it.
 */

export type ViewportMode =
  | "resizes-visual"
  | "resizes-content"
  | "overlays-content";

export type EventType =
  | "KEYBOARD_OPEN"
  | "KEYBOARD_CLOSE"
  | "SCROLL"
  | "DELAYED_VISUAL_PAN"
  | "VIEWPORT_SETTLED";

export type TransitionStatus = "OK" | "UNKNOWN";

/** Axis-aligned rectangle, fixed-point milli-px (1 unit = 1/1000 CSS px). */
export interface RectMilli {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PanDelta {
  dx: number;
  dy: number;
}

export interface PanReport {
  requestedDx: number;
  requestedDy: number;
  appliedDx: number;
  appliedDy: number;
  clamped: boolean;
  clampReason: string | null;
}

/** Viewport state, fields per PROJECT_BOOK.md §4.2. */
export interface ViewportState {
  layoutWidth: number;
  layoutHeight: number;
  visualOffsetLeft: number;
  visualOffsetTop: number;
  visualWidth: number;
  visualHeight: number;
  keyboardRect: RectMilli;
  keyboardVisible: boolean;
  scrollX: number;
  scrollY: number;
  mode: ViewportMode;
  pendingPan: PanDelta;
  eventClock: number;
}

export interface ViewportProfile {
  /** MVP: fixed at 1 (§4.1). Any other value yields UNKNOWN. */
  scale: number;
}

export type ViewportEvent =
  | {
      type: "KEYBOARD_OPEN";
      id: string;
      atMs: number;
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

export interface TransitionResult {
  status: TransitionStatus;
  state: ViewportState;
  /** Non-null only when status is UNKNOWN. */
  reason: string | null;
  /** Non-null only for DELAYED_VISUAL_PAN transitions. */
  panReport: PanReport | null;
}

export interface ReplayResult {
  status: TransitionStatus;
  state: ViewportState;
  reason: string | null;
  failedEventId: string | null;
  /** One entry per input event, in order; null except for pan events. */
  panReports: Array<PanReport | null>;
}

export const VIEWPORT_MODES: ReadonlyArray<ViewportMode> = [
  "resizes-visual",
  "resizes-content",
  "overlays-content",
];

export const DEFAULT_PROFILE: ViewportProfile = { scale: 1 };

/** Canonical fixed key order for deterministic state serialisation. */
export const STATE_FIELD_ORDER: ReadonlyArray<string> = [
  "layoutWidth",
  "layoutHeight",
  "visualOffsetLeft",
  "visualOffsetTop",
  "visualWidth",
  "visualHeight",
  "keyboardRect",
  "keyboardVisible",
  "scrollX",
  "scrollY",
  "mode",
  "pendingPan",
  "eventClock",
];

function isInt(value: number): boolean {
  return typeof value === "number" && Number.isInteger(value);
}

function clampInt(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function unknown(
  current: ViewportState,
  reason: string,
): TransitionResult {
  return { status: "UNKNOWN", state: current, reason, panReport: null };
}

/**
 * Initial state for a layout viewport of the given size (milli-px).
 * Throws RangeError on non-positive or non-integer dimensions: this is
 * construction-time validation, not an event transition.
 */
export function initialState(
  layoutWidth: number,
  layoutHeight: number,
  mode: ViewportMode,
): ViewportState {
  if (!isInt(layoutWidth) || !isInt(layoutHeight)) {
    throw new RangeError("initialState: dimensions must be integers");
  }
  if (layoutWidth <= 0 || layoutHeight <= 0) {
    throw new RangeError("initialState: dimensions must be positive");
  }
  return {
    layoutWidth,
    layoutHeight,
    visualOffsetLeft: 0,
    visualOffsetTop: 0,
    visualWidth: layoutWidth,
    visualHeight: layoutHeight,
    keyboardRect: { x: 0, y: layoutHeight, width: layoutWidth, height: 0 },
    keyboardVisible: false,
    scrollX: 0,
    scrollY: 0,
    mode,
    pendingPan: { dx: 0, dy: 0 },
    eventClock: 0,
  };
}

/** Deterministic canonical JSON for a state (fixed key order, no floats). */
export function canonicalStateJson(state: ViewportState): string {
  return JSON.stringify({
    layoutWidth: state.layoutWidth,
    layoutHeight: state.layoutHeight,
    visualOffsetLeft: state.visualOffsetLeft,
    visualOffsetTop: state.visualOffsetTop,
    visualWidth: state.visualWidth,
    visualHeight: state.visualHeight,
    keyboardRect: {
      x: state.keyboardRect.x,
      y: state.keyboardRect.y,
      width: state.keyboardRect.width,
      height: state.keyboardRect.height,
    },
    keyboardVisible: state.keyboardVisible,
    scrollX: state.scrollX,
    scrollY: state.scrollY,
    mode: state.mode,
    pendingPan: { dx: state.pendingPan.dx, dy: state.pendingPan.dy },
    eventClock: state.eventClock,
  });
}

/**
 * Pure single-step transition: nextState = transition(current, event, mode, profile).
 * Never mutates `current`; returns it unchanged on UNKNOWN.
 */
export function transition(
  current: ViewportState,
  event: ViewportEvent,
  mode: ViewportMode,
  profile: ViewportProfile,
): TransitionResult {
  if (mode !== current.mode) {
    return unknown(current, "mode_mismatch");
  }
  if (profile.scale !== 1) {
    return unknown(current, "unsupported_scale");
  }
  if (typeof event.id !== "string" || event.id.length === 0) {
    return unknown(current, "missing_event_id");
  }
  if (!isInt(event.atMs)) {
    return unknown(current, "invalid_at_ms");
  }
  if (event.atMs < current.eventClock) {
    return unknown(current, "event_clock_regression");
  }

  switch (event.type) {
    case "KEYBOARD_OPEN": {
      if (!isInt(event.keyboardHeight)) {
        return unknown(current, "invalid_keyboard_height");
      }
      // Full (keyboard-free) layout height: for resizes-content an open
      // keyboard has already shrunk layoutHeight, so add its height back.
      const fullHeight =
        mode === "resizes-content" && current.keyboardVisible
          ? current.layoutHeight + current.keyboardRect.height
          : current.layoutHeight;
      if (event.keyboardHeight < 0 || event.keyboardHeight > fullHeight) {
        return unknown(current, "keyboard_height_out_of_range");
      }
      const oldHeight = current.keyboardVisible
        ? current.keyboardRect.height
        : 0;
      const delta = event.keyboardHeight - oldHeight;
      const h = event.keyboardHeight;
      if (mode === "resizes-visual") {
        return {
          status: "OK",
          state: {
            ...current,
            visualHeight: current.layoutHeight - h,
            keyboardRect: {
              x: 0,
              y: current.layoutHeight - h,
              width: current.layoutWidth,
              height: h,
            },
            keyboardVisible: true,
            eventClock: event.atMs,
          },
          reason: null,
          panReport: null,
        };
      }
      if (mode === "resizes-content") {
        const newLayoutHeight = current.layoutHeight - delta;
        return {
          status: "OK",
          state: {
            ...current,
            layoutHeight: newLayoutHeight,
            visualOffsetLeft: 0,
            visualOffsetTop: 0,
            visualWidth: current.layoutWidth,
            visualHeight: newLayoutHeight,
            keyboardRect: {
              x: 0,
              y: newLayoutHeight,
              width: current.layoutWidth,
              height: h,
            },
            keyboardVisible: true,
            eventClock: event.atMs,
          },
          reason: null,
          panReport: null,
        };
      }
      // overlays-content: sizes do not move; the keyboard rect overlaps.
      return {
        status: "OK",
        state: {
          ...current,
          keyboardRect: {
            x: 0,
            y: current.layoutHeight - h,
            width: current.layoutWidth,
            height: h,
          },
          keyboardVisible: true,
          eventClock: event.atMs,
        },
        reason: null,
        panReport: null,
      };
    }

    case "KEYBOARD_CLOSE": {
      if (!current.keyboardVisible) {
        // Idempotent close: only the clock advances.
        return {
          status: "OK",
          state: { ...current, eventClock: event.atMs },
          reason: null,
          panReport: null,
        };
      }
      const h = current.keyboardRect.height;
      if (mode === "resizes-visual") {
        return {
          status: "OK",
          state: {
            ...current,
            visualHeight: current.visualHeight + h,
            keyboardRect: {
              x: 0,
              y: current.layoutHeight,
              width: current.layoutWidth,
              height: 0,
            },
            keyboardVisible: false,
            eventClock: event.atMs,
          },
          reason: null,
          panReport: null,
        };
      }
      if (mode === "resizes-content") {
        const newLayoutHeight = current.layoutHeight + h;
        return {
          status: "OK",
          state: {
            ...current,
            layoutHeight: newLayoutHeight,
            visualOffsetLeft: 0,
            visualOffsetTop: 0,
            visualWidth: current.layoutWidth,
            visualHeight: newLayoutHeight,
            keyboardRect: {
              x: 0,
              y: newLayoutHeight,
              width: current.layoutWidth,
              height: 0,
            },
            keyboardVisible: false,
            eventClock: event.atMs,
          },
          reason: null,
          panReport: null,
        };
      }
      // overlays-content: sizes do not move.
      return {
        status: "OK",
        state: {
          ...current,
          keyboardRect: {
            x: 0,
            y: current.layoutHeight,
            width: current.layoutWidth,
            height: 0,
          },
          keyboardVisible: false,
          eventClock: event.atMs,
        },
        reason: null,
        panReport: null,
      };
    }

    case "SCROLL": {
      if (!isInt(event.dx) || !isInt(event.dy)) {
        return unknown(current, "invalid_scroll_delta");
      }
      // Scroll offsets are independent fields; the visual offset is
      // untouched (§4.1). Lower bound 0; no upper bound is modelled.
      return {
        status: "OK",
        state: {
          ...current,
          scrollX: current.scrollX + event.dx < 0 ? 0 : current.scrollX + event.dx,
          scrollY: current.scrollY + event.dy < 0 ? 0 : current.scrollY + event.dy,
          eventClock: event.atMs,
        },
        reason: null,
        panReport: null,
      };
    }

    case "DELAYED_VISUAL_PAN": {
      if (!isInt(event.dx) || !isInt(event.dy)) {
        return unknown(current, "invalid_pan_delta");
      }
      const maxLeft =
        current.layoutWidth - current.visualWidth < 0
          ? 0
          : current.layoutWidth - current.visualWidth;
      const maxTop =
        current.layoutHeight - current.visualHeight < 0
          ? 0
          : current.layoutHeight - current.visualHeight;
      const newLeft = clampInt(
        current.visualOffsetLeft + event.dx,
        0,
        maxLeft,
      );
      const newTop = clampInt(
        current.visualOffsetTop + event.dy,
        0,
        maxTop,
      );
      const appliedDx = newLeft - current.visualOffsetLeft;
      const appliedDy = newTop - current.visualOffsetTop;
      const reasons: Array<string> = [];
      if (appliedDx !== event.dx) {
        reasons.push(`dx clamped to [0, ${maxLeft}]`);
      }
      if (appliedDy !== event.dy) {
        reasons.push(`dy clamped to [0, ${maxTop}]`);
      }
      const panReport: PanReport = {
        requestedDx: event.dx,
        requestedDy: event.dy,
        appliedDx,
        appliedDy,
        clamped: reasons.length > 0,
        clampReason: reasons.length > 0 ? reasons.join("; ") : null,
      };
      return {
        status: "OK",
        state: {
          ...current,
          visualOffsetLeft: newLeft,
          visualOffsetTop: newTop,
          pendingPan: { dx: appliedDx, dy: appliedDy },
          eventClock: event.atMs,
        },
        reason: null,
        panReport,
      };
    }

    case "VIEWPORT_SETTLED": {
      return {
        status: "OK",
        state: {
          ...current,
          pendingPan: { dx: 0, dy: 0 },
          eventClock: event.atMs,
        },
        reason: null,
        panReport: null,
      };
    }

    default: {
      return unknown(current, "unknown_event_type");
    }
  }
}

/**
 * Deterministic replay: events in array order (equal timestamps keep
 * array order). Stops at the first UNKNOWN event and returns the state
 * as of before that event, with its id and reason.
 */
export function replay(
  initial: ViewportState,
  events: ReadonlyArray<ViewportEvent>,
  mode: ViewportMode,
  profile: ViewportProfile,
): ReplayResult {
  let state = initial;
  const panReports: Array<PanReport | null> = [];
  for (const event of events) {
    const result = transition(state, event, mode, profile);
    panReports.push(result.panReport);
    if (result.status === "UNKNOWN") {
      return {
        status: "UNKNOWN",
        state,
        reason: result.reason,
        failedEventId: event.id,
        panReports,
      };
    }
    state = result.state;
  }
  return {
    status: "OK",
    state,
    reason: null,
    failedEventId: null,
    panReports,
  };
}
