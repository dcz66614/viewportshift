/**
 * P021 ViewportShift — T009 UI logic (pure, React-free).
 *
 * This module is the UI's only access point to the frozen domain: it
 * builds `viewportshift.scenario/v1` inputs from UI parameters and
 * calls the domain pure functions (`validateScenario`,
 * `evaluateGeometry`, `searchBfs`, `surfaceRectFor`,
 * `computeMetrics`, canonical JSON). It implements NO geometry,
 * state-machine, or search algorithm of its own — any second copy of
 * those algorithms here would be a contract violation.
 *
 * Determinism: fixed seed `P021-VIEWPORTSHIFT-S0-2026-11-10`, fixed
 * event sequences, deterministic scenario ids. No wall clock, no
 * randomness, no timers anywhere in this file.
 */

import { searchBfs } from "../domain/bfs.ts";
import type { BfsSearchResult } from "../domain/bfs.ts";
import { canonicalBfsJson } from "../domain/bfs.ts";
import { canonicalJson, computeMetrics, surfaceRectFor } from "../domain/geometry.ts";
import type { GeometryMetrics } from "../domain/geometry.ts";
import type { RectMilli } from "../domain/types.ts";
import { evaluateGeometry } from "../domain/geometry-eval.ts";
import type { GeometryEvaluation, GeometryStep } from "../domain/geometry-eval.ts";
import {
  DEFAULT_LIMITS,
  SCHEMA_UNIT,
  SCHEMA_VERSION,
} from "../domain/types.ts";
import type {
  AnalysisStatus,
  FailurePredicate,
  LayoutTemplate,
  ScenarioEvent,
  ViewportMode,
} from "../domain/types.ts";
import { validateScenario } from "../domain/validate.ts";
import type { ValidationResult } from "../domain/types.ts";

export const UI_SEED = "P021-VIEWPORTSHIFT-S0-2026-11-10";

/** The three synthetic UIs shipped in the product (§1.2). */
export const UI_TEMPLATES: ReadonlyArray<LayoutTemplate> = [
  "chat-input",
  "bottom-sheet",
  "fixed-cta",
];

/** The built-in four-layout test set (§1.2, §5.1): the three UIs plus search-bar. */
export const TEST_SET_TEMPLATES: ReadonlyArray<LayoutTemplate> = [
  "chat-input",
  "bottom-sheet",
  "fixed-cta",
  "search-bar",
];

export const TEMPLATE_LABELS: Record<LayoutTemplate, string> = {
  "chat-input": "聊天输入框",
  "bottom-sheet": "底部面板",
  "fixed-cta": "固定 CTA",
  "search-bar": "搜索栏",
};

export const MODE_LABELS: Record<ViewportMode, string> = {
  "resizes-visual": "resizes-visual（键盘缩视觉视口）",
  "resizes-content": "resizes-content（键盘缩布局视口）",
  "overlays-content": "overlays-content（键盘覆盖内容）",
};

export type EventSequenceId =
  | "open"
  | "open-scroll"
  | "open-pan-settled"
  | "open-close-open";

export const EVENT_SEQUENCE_IDS: ReadonlyArray<EventSequenceId> = [
  "open",
  "open-scroll",
  "open-pan-settled",
  "open-close-open",
];

export const EVENT_SEQUENCE_LABELS: Record<EventSequenceId, string> = {
  open: "仅键盘展开",
  "open-scroll": "展开 + 滚动",
  "open-pan-settled": "展开 + 延迟平移 + 稳定",
  "open-close-open": "展开 + 收起 + 再展开",
};

/** Fixed failure predicates (same set as the S0 chat fixture). */
export const DEFAULT_PREDICATES: ReadonlyArray<FailurePredicate> = [
  { field: "visibleRatio", op: "<", threshold: 1000 },
  { field: "keyboardObscuredArea", op: ">", threshold: 0 },
  { field: "bottomGap", op: "<", threshold: 0 },
  { field: "anchorDriftMagnitude", op: ">", threshold: 50000 },
];

/** Synthetic surface geometry per template, in milli-CSS-px. */
export const TEMPLATE_LAYOUTS: Record<
  LayoutTemplate,
  {
    anchor: "bottom" | "top";
    offsetMilli: number;
    xMilli: number;
    widthMilli: number;
    heightMilli: number;
  }
> = {
  "chat-input": {
    anchor: "bottom",
    offsetMilli: 0,
    xMilli: 0,
    widthMilli: 390000,
    heightMilli: 56000,
  },
  "bottom-sheet": {
    anchor: "bottom",
    offsetMilli: 0,
    xMilli: 0,
    widthMilli: 390000,
    heightMilli: 280000,
  },
  "fixed-cta": {
    anchor: "bottom",
    offsetMilli: 16000,
    xMilli: 16000,
    widthMilli: 358000,
    heightMilli: 64000,
  },
  "search-bar": {
    anchor: "top",
    offsetMilli: 16000,
    xMilli: 16000,
    widthMilli: 358000,
    heightMilli: 48000,
  },
};

export interface UiParams {
  template: LayoutTemplate;
  mode: ViewportMode;
  /** Synthetic layout viewport size, CSS px (integers). */
  layoutWidthCssPx: number;
  layoutHeightCssPx: number;
  /** Declared keyboard height, CSS px (integer, 0..layout height). */
  keyboardHeightCssPx: number;
  /** SCROLL deltas, CSS px (integers). */
  scrollDxCssPx: number;
  scrollDyCssPx: number;
  /** DELAYED_VISUAL_PAN dy, CSS px (integer, dx is always 0). */
  panDyCssPx: number;
  sequenceId: EventSequenceId;
}

export const DEFAULT_UI_PARAMS: UiParams = {
  template: "chat-input",
  mode: "resizes-visual",
  layoutWidthCssPx: 390,
  layoutHeightCssPx: 844,
  keyboardHeightCssPx: 300,
  scrollDxCssPx: 0,
  scrollDyCssPx: 100,
  panDyCssPx: 100,
  sequenceId: "open",
};

/** Deterministic scenario id for a UI parameter set. */
export function scenarioIdFor(params: UiParams): string {
  return `UI-${params.template}-${params.mode}`;
}

/**
 * Build the fixed event sequence for a parameter set. Event ids and
 * timestamps are deterministic (`ui-e1`… at 100 ms steps); no clock.
 */
export function buildEvents(params: UiParams): Array<ScenarioEvent> {
  const kbMilli = params.keyboardHeightCssPx * 1000;
  const scrollDx = params.scrollDxCssPx * 1000;
  const scrollDy = params.scrollDyCssPx * 1000;
  const panDy = params.panDyCssPx * 1000;
  const open: ScenarioEvent = {
    type: "KEYBOARD_OPEN",
    id: "ui-e1",
    atMs: 100,
    keyboardHeight: kbMilli,
  };
  switch (params.sequenceId) {
    case "open":
      return [open];
    case "open-scroll":
      return [
        open,
        { type: "SCROLL", id: "ui-e2", atMs: 200, dx: scrollDx, dy: scrollDy },
      ];
    case "open-pan-settled":
      return [
        open,
        {
          type: "DELAYED_VISUAL_PAN",
          id: "ui-e2",
          atMs: 200,
          dx: 0,
          dy: panDy,
        },
        { type: "VIEWPORT_SETTLED", id: "ui-e3", atMs: 300 },
      ];
    case "open-close-open":
      return [
        open,
        { type: "KEYBOARD_CLOSE", id: "ui-e2", atMs: 200 },
        {
          type: "KEYBOARD_OPEN",
          id: "ui-e3",
          atMs: 300,
          keyboardHeight: kbMilli,
        },
      ];
  }
}

/** Build the frozen wire-shape scenario object for a parameter set. */
export function buildScenario(params: UiParams): Record<string, unknown> {
  const layout = TEMPLATE_LAYOUTS[params.template];
  return {
    scenario_id: scenarioIdFor(params),
    seed: UI_SEED,
    unit: SCHEMA_UNIT,
    layout: {
      template: params.template,
      anchor: layout.anchor,
      offsetMilli: layout.offsetMilli,
      xMilli: layout.xMilli,
      widthMilli: layout.widthMilli,
      heightMilli: layout.heightMilli,
    },
    viewport: {
      layoutWidth: params.layoutWidthCssPx * 1000,
      layoutHeight: params.layoutHeightCssPx * 1000,
    },
    keyboard: { heightMilli: params.keyboardHeightCssPx * 1000 },
    mode: params.mode,
    events: buildEvents(params),
    failure_predicates: DEFAULT_PREDICATES.map((p) => ({ ...p })),
    limits: { ...DEFAULT_LIMITS },
    profile: { scale: 1 },
  };
}

export function validateUiScenario(
  scenario: unknown,
): ValidationResult {
  return validateScenario(scenario);
}

export function canonicalScenarioJson(scenario: unknown): string {
  return canonicalJson(scenario);
}

/** SHA-256 via WebCrypto when available; deterministic FNV-1a fallback. */
export async function sha256HexBrowser(
  text: string,
): Promise<{ hex: string; method: "sha-256" | "fnv1a-fallback" }> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle !== undefined) {
    const digest = await subtle.digest(
      "SHA-256",
      new TextEncoder().encode(text),
    );
    const bytes = new Uint8Array(digest);
    let hex = "";
    for (const b of bytes) {
      hex += b.toString(16).padStart(2, "0");
    }
    return { hex, method: "sha-256" };
  }
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return { hex: `fnv1a-${h.toString(16).padStart(8, "0")}`, method: "fnv1a-fallback" };
}

/** Replay a scenario through the domain geometry evaluator. */
export function replayScenario(
  scenario: unknown,
  scenarioSha256: string,
): GeometryEvaluation {
  return evaluateGeometry(scenario, scenarioSha256);
}

/** Run the domain bounded BFS over a scenario. */
export function runBfs(
  scenario: unknown,
  scenarioSha256: string,
): BfsSearchResult {
  return searchBfs(scenario, scenarioSha256);
}

/** Canonical JSON export for a replay + BFS result (T009: JSON download). */
export function canonicalExportJson(value: unknown): string {
  return canonicalJson(value);
}

export function canonicalWitnessJson(value: unknown): string {
  return canonicalBfsJson(value);
}

/** Text status labels — status is never conveyed by colour alone (§5.2). */
export const STATUS_LABELS: Record<AnalysisStatus, string> = {
  PASS: "PASS（通过）",
  FAIL: "FAIL（失败）",
  UNKNOWN: "UNKNOWN（未知）",
  BOUNDED_NO_WITNESS: "BOUNDED_NO_WITNESS（有界搜索未找到见证）",
  INVALID: "INVALID（无效输入）",
};

export function statusLabel(status: AnalysisStatus): string {
  return STATUS_LABELS[status];
}

export function bfsStatusLabel(status: BfsSearchResult["status"]): string {
  return STATUS_LABELS[status];
}

/**
 * Derive the top-bar analysis status from a geometry evaluation.
 * Shared pure function (T011): re-exported from
 * `src/domain/analysis-status.ts`, which is the single definition
 * now used by both this module and `src/cli.ts` (T010 P2-2: the two
 * copies are merged; behaviour unchanged — UNKNOWN / INVALID fail
 * closed, otherwise FAIL when any step fired, else PASS; the status
 * is derived from the geometry evaluation only, so it never returns
 * BOUNDED_NO_WITNESS).
 */
export { deriveAnalysisStatus } from "../domain/analysis-status.ts";

/** One timeline row: the initial state (index -1) plus one per event step. */
export interface TimelineRow {
  index: number;
  eventId: string;
  eventType: string;
  atMs: number;
  state: GeometryStep["state"] | GeometryEvaluation["initialState"];
  surfaceRect: RectMilli;
  metrics: GeometryMetrics | null;
  failedPredicates: Array<string>;
}

export function timelineRows(
  evaluation: GeometryEvaluation,
  scenario: Record<string, unknown>,
): Array<TimelineRow> {
  const rows: Array<TimelineRow> = [];
  const layout = scenario.layout as {
    template: string;
    anchor: "bottom" | "top";
    offsetMilli: number;
    xMilli: number;
    widthMilli: number;
    heightMilli: number;
  };
  if (evaluation.initialState !== null) {
    const surface = surfaceRectFor(layout, evaluation.initialState);
    const computed = computeMetrics(layout, evaluation.initialState);
    rows.push({
      index: -1,
      eventId: "initial",
      eventType: "INITIAL",
      atMs: 0,
      state: evaluation.initialState,
      surfaceRect: surface,
      metrics: computed.metrics,
      failedPredicates: [],
    });
  }
  for (let i = 0; i < evaluation.steps.length; i++) {
    const step = evaluation.steps[i];
    rows.push({
      index: i,
      eventId: step.eventId,
      eventType: step.eventType,
      atMs: step.atMs,
      state: step.state,
      surfaceRect: step.surfaceRect,
      metrics: step.metrics,
      failedPredicates: step.failedPredicates,
    });
  }
  return rows;
}

/** The row a timeline click selects; falls back to the initial row. */
export function selectedRow(
  rows: Array<TimelineRow>,
  index: number,
): TimelineRow | null {
  for (const row of rows) {
    if (row.index === index) return row;
  }
  return rows.length > 0 ? rows[0] : null;
}

/** Before/after states around the first failing witness step. */
export function witnessBeforeAfter(bfs: BfsSearchResult): {
  before: BfsSearchResult["initialState"];
  after: BfsSearchResult["initialState"];
  firstFailedStepIndex: number | null;
} {
  const idx = bfs.firstFailedStepIndex;
  if (bfs.witness === null || idx === null) {
    return { before: bfs.initialState, after: null, firstFailedStepIndex: idx };
  }
  if (idx === -1) {
    return {
      before: bfs.initialState,
      after: bfs.initialState,
      firstFailedStepIndex: idx,
    };
  }
  const before =
    idx > 0 ? (bfs.witness[idx - 1]?.state ?? bfs.initialState) : bfs.initialState;
  const after = bfs.witness[idx]?.state ?? null;
  return { before, after, firstFailedStepIndex: idx };
}

/** Predicate description text for display. */
export function predicateText(predicate: FailurePredicate): string {
  return `${predicate.field} ${predicate.op} ${predicate.threshold}`;
}

/** Format milli-CSS-px as CSS px with at most 3 decimals (integer math). */
export function formatCssPx(milli: number): string {
  const sign = milli < 0 ? "-" : "";
  const abs = milli < 0 ? -milli : milli;
  const whole = Math.trunc(abs / 1000);
  const frac = abs % 1000;
  if (frac === 0) return `${sign}${whole}`;
  let fracText = String(frac).padStart(3, "0");
  while (fracText.endsWith("0")) {
    fracText = fracText.slice(0, -1);
  }
  return `${sign}${whole}.${fracText}`;
}

/** Format a (milli-px)^2 area as CSS px^2 with at most 3 decimals. */
export function formatAreaCssPx2(milliSq: number): string {
  const sign = milliSq < 0 ? "-" : "";
  const abs = milliSq < 0 ? -milliSq : milliSq;
  const whole = Math.trunc(abs / 1000000);
  const rem = abs % 1000000;
  const frac3 = Math.trunc(rem / 1000);
  if (frac3 === 0) return `${sign}${whole}`;
  let fracText = String(frac3).padStart(3, "0");
  while (fracText.endsWith("0")) {
    fracText = fracText.slice(0, -1);
  }
  return `${sign}${whole}.${fracText}`;
}

/** Format an integer milli-ratio (0..1000) as a percent. */
export function formatRatioPercent(milliRatio: number): string {
  const whole = Math.trunc(milliRatio / 10);
  const frac = milliRatio % 10;
  if (frac === 0) return `${whole}%`;
  return `${whole}.${frac}%`;
}

export { SCHEMA_VERSION };
