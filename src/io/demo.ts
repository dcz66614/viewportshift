/**
 * P021 ViewportShift — built-in synthetic demo scenario (T010, S3).
 *
 * Contract: P021_PROJECT_BOOK.md §1.2, §3.3 and
 * P021_IMPLEMENTATION_PLAN.md §5 (T010).
 *
 * The demo uses only synthetic data and the frozen seed: a chat
 * input (390 x 56 CSS px, bottom-anchored) on a 390 x 844 CSS px
 * layout viewport, a 300 CSS px keyboard, `overlays-content` mode,
 * and a single KEYBOARD_OPEN event. In this mode the keyboard covers
 * the input, so the replay FAILs (visible ratio 0%, keyboard
 * obscured area 21840 CSS px^2) and the bounded BFS finds a
 * one-event witness (KEYBOARD_OPEN at 300000 milli-px).
 *
 * Pure data only: no wall clock, no timers, no randomness, no I/O,
 * no network. The failure predicates are the same frozen set the UI
 * uses (visibleRatio < 1000, keyboardObscuredArea > 0, bottomGap < 0,
 * anchorDriftMagnitude > 50000).
 */

import { DEFAULT_LIMITS, SCHEMA_UNIT } from "../domain/types.ts";

/** Frozen seed (P021_IMPLEMENTATION_PLAN.md §6.2). */
export const DEMO_SEED = "P021-VIEWPORTSHIFT-S0-2026-11-10";
export const DEMO_SCENARIO_ID = "DEMO-chat-input-overlays-content";
export const DEMO_TEMPLATE = "chat-input";
export const DEMO_MODE = "overlays-content";

/** The frozen demo scenario, in `viewportshift.scenario/v1` wire shape. */
export function buildDemoScenario(): Record<string, unknown> {
  return {
    scenario_id: DEMO_SCENARIO_ID,
    seed: DEMO_SEED,
    unit: SCHEMA_UNIT,
    layout: {
      template: "chat-input",
      anchor: "bottom",
      offsetMilli: 0,
      xMilli: 0,
      widthMilli: 390000,
      heightMilli: 56000,
    },
    viewport: {
      layoutWidth: 390000,
      layoutHeight: 844000,
    },
    keyboard: { heightMilli: 300000 },
    mode: "overlays-content",
    events: [
      {
        type: "KEYBOARD_OPEN",
        id: "demo-e1",
        atMs: 100,
        keyboardHeight: 300000,
      },
    ],
    failure_predicates: [
      { field: "visibleRatio", op: "<", threshold: 1000 },
      { field: "keyboardObscuredArea", op: ">", threshold: 0 },
      { field: "bottomGap", op: "<", threshold: 0 },
      { field: "anchorDriftMagnitude", op: ">", threshold: 50000 },
    ],
    limits: { ...DEFAULT_LIMITS },
    profile: { scale: 1 },
  };
}
