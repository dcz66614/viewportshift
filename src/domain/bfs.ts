/**
 * P021 ViewportShift — bounded BFS shortest-failure-sequence search
 * (T008, S2).
 *
 * Contract: P021_PROJECT_BOOK.md §4.5, §4.3, §4.4, §6.2 (SPEC_VERSION
 * 1.0.0) and P021_IMPLEMENTATION_PLAN.md §5 (T008), §6.
 *
 * What this module is: a breadth-first search over the frozen event
 * alphabet that returns the shortest event sequence whose replay makes
 * a declared failure predicate fire. It reuses the T007 formal
 * geometry evaluator (`geometry-eval.ts`) as its state-transition
 * basis — it does not implement a second geometry — and the T006
 * event transition (`events.ts`) for single-step transitions, so the
 * search, the replay and the Oracle all agree on what a step does.
 *
 * Frozen semantics (T008):
 * - Any-step semantics. The predicate is evaluated after EVERY step
 *   (including the initial state, depth 0, and every step of a fixed
 *   input prefix). The first failing step is the hit. This differs
 *   deliberately from the S0 scenario verdict, which is decided by the
 *   FINAL step only (so an open-close sequence can PASS its scenario
 *   verdict while still containing a transient failure): BFS looks for
 *   the first failure, and a transient failure counts.
 * - Length-first. Sequences are explored in increasing length, so the
 *   first hit is a shortest sequence. Within one length, candidates
 *   are explored in frozen alphabet order (event-type order, then
 *   numeric parameter order); generated event ids are derived
 *   deterministically from that order, so the output is unique.
 * - Frozen alphabet (12 candidate events, see BFS_ALPHABET). The
 *   alphabet and the depth/node bounds are never expanded at search
 *   time. DELAYED_VISUAL_PAN carries dx = 0 only: visualWidth always
 *   equals layoutWidth (no pinch zoom, scale fixed at 1), so maxLeft
 *   is 0 and any non-zero dx pan is clamped to an applied dx of 0 —
 *   a geometrically inert branch that would only duplicate states.
 * - Step clock. Generated events are spaced 100 ms apart, continuing
 *   after the last prefix event (or from 0 when there is no prefix).
 *   The clock is part of the transition contract (monotonic atMs) and
 *   nothing else: no wall clock is ever read.
 * - Dedup key = the FULL ViewportState canonical JSON (all 13 fields,
 *   including eventClock, scrollX/scrollY and pendingPan). Two states
 *   share a key only when they are identical in every field, so two
 *   states with different observable geometry can never be merged.
 *   This is deliberately conservative: states that differ only in
 *   clock/scroll/pendingPan are kept as separate nodes even though
 *   their geometry is identical. Over-splitting costs nodes; merging
 *   would cost correctness. The naive-sum collision fixture
 *   (tests/fixtures/bfs/bfs-dedup-rv-sheet.json) pins this: two
 *   depth-3 states whose numeric fields sum to the same total are
 *   still searched separately, and both are visited (74 distinct
 *   states to depth 3; the fixture itself is BOUNDED_NO_WITNESS, so
 *   no witness is found through either of them — the collision pair
 *   is A=`[OPEN150, OPEN150, OPEN300]` and B=`[OPEN150, PAN300,
 *   PAN-300]`, both depth-3). An earlier header draft misstated
 *   this as a depth-2 pair with a witness found; corrected in T011.
 * - Bounds. maxDepth / maxNodes come from the scenario's (validated)
 *   limits. When the queue is exhausted without a hit, the result is
 *   BOUNDED_NO_WITNESS with limitReached "depth" — the search never
 *   claims the whole space is safe. When the node budget is exhausted
 *   first, the result is BOUNDED_NO_WITNESS with limitReached
 *   "nodes". A hit is status FAIL (a predicate failed), with the full
 *   witness: the event sequence, the first failing predicate(s), and
 *   the before/after state and metrics of every step.
 * - Fail-closed inputs. A scenario that fails T004 validation never
 *   reaches the search: INVALID stays INVALID, out-of-model inputs
 *   (for example profile.scale != 1) stay UNKNOWN, with the first
 *   validation issue code as the reason. The fail-closed result keeps
 *   the caller's `limits` when they are legal (see
 *   `limitsFromRawInput`): each of maxDepth / maxNodes is preserved
 *   when it is an integer inside its frozen bound, and only an
 *   illegal or missing field falls back to its default, with the
 *   fallback recorded in `limitsFallbackReason` (and the underlying
 *   `invalid_limits` issue already carried in `validationIssues`).
 *   (T011 changed this from the T008 behaviour, which always
 *   returned the defaults; T008's own note is superseded.)
 * - Prefix. The input scenario's own `events` (normally empty) are
 *   treated as a fixed prefix: they are replayed first, any-step
 *   checked, and the search extends them. The witness includes the
 *   prefix steps.
 *
 * Pure functions only: no wall clock, no timers, no randomness, no
 * I/O, no date/time access. Hashing lives in the scripts
 * (node:crypto), not here, so this file stays usable in the browser
 * bundle.
 */

import { canonicalStateJson, initialState } from "./viewport-state.ts";
import type { ViewportState } from "./viewport-state.ts";
import { evaluateEventTransition } from "./events.ts";
import {
  computeMetrics,
  evaluatePredicates,
  surfaceRectFor,
} from "./geometry.ts";
import type { GeometryMetrics } from "./geometry.ts";
import { evaluateScenarioGeometry } from "./geometry-eval.ts";
import type { RectMilli, Scenario, ScenarioEvent } from "./types.ts";
import {
  DEFAULT_LIMITS,
  MAX_DEPTH_LIMIT,
  MAX_NODES_LIMIT,
} from "./types.ts";
import { validateScenario } from "./validate.ts";
import type { ValidationIssue } from "./types.ts";

export const BFS_VERSION = "bfs/v1";
export const SEED = "P021-VIEWPORTSHIFT-S0-2026-11-10";

/** Fixed spacing between generated events, in ms (§4.3: atMs monotone). */
export const BFS_STEP_MS = 100;

/**
 * One frozen alphabet entry: an event type plus its discrete
 * parameters. Ids and timestamps are assigned when the event is
 * instantiated for a concrete step (see `buildBfsEvent`); they are
 * not part of the alphabet itself.
 */
export type BfsEventTemplate =
  | { type: "KEYBOARD_OPEN"; keyboardHeight: number }
  | { type: "KEYBOARD_CLOSE" }
  | { type: "SCROLL"; dx: number; dy: number }
  | { type: "DELAYED_VISUAL_PAN"; dx: number; dy: number }
  | { type: "VIEWPORT_SETTLED" };

/**
 * The frozen BFS alphabet, in frozen exploration order (§4.5:
 * event-type order, then numeric parameter order — dx ascending,
 * then dy ascending within a type):
 *
 * 1–2. KEYBOARD_OPEN 150000 / 300000 milli-px (150 / 300 CSS px).
 * 3.   KEYBOARD_CLOSE.
 * 4–7. SCROLL (dx, dy) in (-100000,0), (0,-100000), (0,100000),
 *      (100000,0) — 100 CSS px per axis.
 * 8–11. DELAYED_VISUAL_PAN (0, dy) in -300000, -100000, 100000,
 *      300000 — dx is 0 only (see the header note: any dx pan is
 *      clamped to an applied dx of 0 because maxLeft is always 0).
 * 12.  VIEWPORT_SETTLED.
 *
 * No other event type or parameter value is ever generated.
 */
export const BFS_ALPHABET: ReadonlyArray<BfsEventTemplate> = [
  { type: "KEYBOARD_OPEN", keyboardHeight: 150000 },
  { type: "KEYBOARD_OPEN", keyboardHeight: 300000 },
  { type: "KEYBOARD_CLOSE" },
  { type: "SCROLL", dx: -100000, dy: 0 },
  { type: "SCROLL", dx: 0, dy: -100000 },
  { type: "SCROLL", dx: 0, dy: 100000 },
  { type: "SCROLL", dx: 100000, dy: 0 },
  { type: "DELAYED_VISUAL_PAN", dx: 0, dy: -300000 },
  { type: "DELAYED_VISUAL_PAN", dx: 0, dy: -100000 },
  { type: "DELAYED_VISUAL_PAN", dx: 0, dy: 100000 },
  { type: "DELAYED_VISUAL_PAN", dx: 0, dy: 300000 },
  { type: "VIEWPORT_SETTLED" },
];

export type BfsSearchStatus =
  | "FAIL"
  | "BOUNDED_NO_WITNESS"
  | "UNKNOWN"
  | "INVALID";

export type BfsLimitReached = "depth" | "nodes" | null;

/** One step of a witness: the event plus the state/metrics it produced. */
export interface BfsWitnessStep {
  index: number;
  eventId: string;
  eventType: string;
  atMs: number;
  /** Event parameters, exactly as generated (absent fields omitted). */
  params: Record<string, number>;
  /** State after the event. */
  state: ViewportState;
  surfaceRect: RectMilli;
  metrics: GeometryMetrics;
  /** Predicates that fired on this step, in fixture order. */
  failedPredicates: Array<string>;
}

export interface BfsSearchResult {
  bfsVersion: typeof BFS_VERSION;
  scenarioId: string;
  scenarioSha256: string;
  seed: string;
  mode: string;
  status: BfsSearchStatus;
  /** First validation issue code, or null when the search ran. */
  reason: string | null;
  validationIssues: Array<ValidationIssue>;
  /** Null unless status is FAIL. */
  witness: Array<BfsWitnessStep> | null;
  /** Length of the witness, or null when there is none. */
  witnessLength: number | null;
  /** Predicates that fired at the witness step, in fixture order. */
  failedPredicates: Array<string>;
  /**
   * Index of the first failing step within the witness, or null when
   * there is none; -1 means the initial state (depth 0) already
   * failed, before any event.
   */
  firstFailedStepIndex: number | null;
  /** Nodes dequeued (expanded or returned as a hit). */
  nodesVisited: number;
  /** Nodes ever enqueued, including the start node. */
  nodesEnqueued: number;
  /** Candidates skipped because their state key was already visited. */
  nodesPrunedDuplicate: number;
  /** Candidates skipped because their transition failed closed. */
  transitionsSkippedUnknown: number;
  /** Deepest generated depth reached (0 = start node only). */
  maxDepthReached: number;
  /** Which bound ended a BOUNDED_NO_WITNESS search; null otherwise. */
  limitReached: BfsLimitReached;
  limits: { maxDepth: number; maxNodes: number };
  /**
   * Fail-closed limits note (T011, P2-2). Present only on fail-closed
   * results (INVALID / UNKNOWN from `searchBfs`): null when the
   * input limits were legal and preserved in `limits`; otherwise a
   * deterministic string naming every field that fell back to its
   * default (e.g. "limits.maxDepth invalid, using default 8"). The
   * underlying `invalid_limits` issue is also carried in
   * `validationIssues`. Valid-path results do not carry this field,
   * so their canonical JSON — and the demo envelope hash — is
   * unchanged.
   */
  limitsFallbackReason?: string | null;
  /** The frozen alphabet, for the search-bounds report. */
  alphabet: ReadonlyArray<BfsEventTemplate>;
  /** Null exactly when validation rejected the input. */
  initialState: ViewportState | null;
  initialMetrics: GeometryMetrics | null;
}

/**
 * Deterministic canonical JSON: sorted keys, fixed array order, no
 * spaces — identical to the S0 geometry / T005 modes canonicalisation.
 */
export function canonicalBfsJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalBfsJson).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonicalBfsJson(record[k])}`)
    .join(",")}}`;
}

/**
 * Dedup key for a state: the full canonical ViewportState JSON (all
 * 13 fields, fixed key order). Two states share a key only when they
 * are identical in every field, so different observable geometry can
 * never be merged. See the header note for why the key is the full
 * state rather than a geometry-only projection.
 */
export function stateKeyFor(state: ViewportState): string {
  return canonicalStateJson(state);
}

/** Short slug for one alphabet entry, used to build generated event ids. */
export function alphabetSlug(template: BfsEventTemplate): string {
  switch (template.type) {
    case "KEYBOARD_OPEN":
      return `open-${template.keyboardHeight}`;
    case "KEYBOARD_CLOSE":
      return "close";
    case "SCROLL":
      return `scroll-${template.dx}-${template.dy}`;
    case "DELAYED_VISUAL_PAN":
      return `pan-${template.dx}-${template.dy}`;
    case "VIEWPORT_SETTLED":
      return "settled";
    default:
      throw new Error(
        `unknown alphabet entry: ${String((template as { type: string }).type)}`,
      );
  }
}

/**
 * Instantiate one alphabet entry as a concrete event for step
 * `stepIndex` (1-based within the generated sequence, i.e. 1 for the
 * first generated event after the prefix). The id is deterministic:
 * `bfs-<step>-<slug>`, so the same sequence always carries the same
 * ids and ids are unique within a sequence.
 */
export function buildBfsEvent(
  template: BfsEventTemplate,
  stepIndex: number,
  atMs: number,
): ScenarioEvent {
  const id = `bfs-${stepIndex}-${alphabetSlug(template)}`;
  switch (template.type) {
    case "KEYBOARD_OPEN":
      return {
        type: "KEYBOARD_OPEN",
        id,
        atMs,
        keyboardHeight: template.keyboardHeight,
      };
    case "KEYBOARD_CLOSE":
      return { type: "KEYBOARD_CLOSE", id, atMs };
    case "SCROLL":
      return { type: "SCROLL", id, atMs, dx: template.dx, dy: template.dy };
    case "DELAYED_VISUAL_PAN":
      return {
        type: "DELAYED_VISUAL_PAN",
        id,
        atMs,
        dx: template.dx,
        dy: template.dy,
      };
    case "VIEWPORT_SETTLED":
      return { type: "VIEWPORT_SETTLED", id, atMs };
    default:
      throw new Error(
        `unknown alphabet entry: ${String((template as { type: string }).type)}`,
      );
  }
}

/** Parameter fields of a concrete event, for witness steps. */
function eventParams(event: ScenarioEvent): Record<string, number> {
  switch (event.type) {
    case "KEYBOARD_OPEN":
      return { keyboardHeight: event.keyboardHeight };
    case "SCROLL":
    case "DELAYED_VISUAL_PAN":
      return { dx: event.dx, dy: event.dy };
    default:
      return {};
  }
}

interface BfsNode {
  /** Generated events from the start node (prefix excluded). */
  events: Array<ScenarioEvent>;
  /** Full step history from the start node (prefix excluded). */
  steps: Array<BfsWitnessStep>;
  state: ViewportState;
  metrics: GeometryMetrics;
  /** Generated depth (0 = start node). */
  depth: number;
  /** atMs of the next generated event. */
  nextAtMs: number;
}

function failClosedResult(
  scenarioId: string,
  scenarioSha256: string,
  seed: string,
  mode: string,
  status: "UNKNOWN" | "INVALID",
  reason: string | null,
  validationIssues: Array<ValidationIssue>,
  limits: { maxDepth: number; maxNodes: number },
  limitsFallbackReason: string | null,
): BfsSearchResult {
  return {
    bfsVersion: BFS_VERSION,
    scenarioId,
    scenarioSha256,
    seed,
    mode,
    status,
    reason,
    validationIssues,
    witness: null,
    witnessLength: null,
    failedPredicates: [],
    firstFailedStepIndex: null,
    nodesVisited: 0,
    nodesEnqueued: 0,
    nodesPrunedDuplicate: 0,
    transitionsSkippedUnknown: 0,
    maxDepthReached: 0,
    limitReached: null,
    limits,
    limitsFallbackReason,
    alphabet: BFS_ALPHABET,
    initialState: null,
    initialMetrics: null,
  };
}

/**
 * Search a validated scenario. The input scenario's own `events`
 * are a fixed prefix (normally empty): they are replayed first and
 * any-step checked, and the BFS extends them.
 */
export function searchBfsScenario(
  scenario: Scenario,
  scenarioSha256: string,
): BfsSearchResult {
  const limits = {
    maxDepth: scenario.limits.maxDepth,
    maxNodes: scenario.limits.maxNodes,
  };
  const base = {
    bfsVersion: BFS_VERSION as typeof BFS_VERSION,
    scenarioId: scenario.scenario_id,
    scenarioSha256,
    seed: scenario.seed,
    mode: scenario.mode,
    validationIssues: [] as Array<ValidationIssue>,
    limits,
    alphabet: BFS_ALPHABET,
  };
  const initial = initialState(
    scenario.viewport.layoutWidth,
    scenario.viewport.layoutHeight,
    scenario.mode,
  );
  const initialComputed = computeMetrics(scenario.layout, initial);
  if (initialComputed.status !== "OK" || initialComputed.metrics === null) {
    return {
      ...base,
      status: "INVALID",
      reason: initialComputed.reason,
      witness: null,
      witnessLength: null,
      failedPredicates: [],
      firstFailedStepIndex: null,
      nodesVisited: 0,
      nodesEnqueued: 0,
      nodesPrunedDuplicate: 0,
      transitionsSkippedUnknown: 0,
      maxDepthReached: 0,
      limitReached: null,
      initialState: initial,
      initialMetrics: null,
    };
  }
  const initialMetrics = initialComputed.metrics;

  // Any-step check on the initial state (depth 0): an empty witness.
  const initialFired = evaluatePredicates(
    initialMetrics,
    scenario.failure_predicates,
  );
  if (initialFired.length > 0) {
    return {
      ...base,
      status: "FAIL",
      reason: null,
      witness: [],
      witnessLength: 0,
      failedPredicates: initialFired,
      firstFailedStepIndex: -1,
      nodesVisited: 1,
      nodesEnqueued: 1,
      nodesPrunedDuplicate: 0,
      transitionsSkippedUnknown: 0,
      maxDepthReached: 0,
      limitReached: null,
      initialState: initial,
      initialMetrics,
    };
  }

  // Replay the fixed prefix (if any) through the T007 evaluator and
  // any-step check it. A prefix step that fires is the witness.
  let startState = initial;
  let prefixSteps: Array<BfsWitnessStep> = [];
  let nextAtMs = BFS_STEP_MS;
  if (scenario.events.length > 0) {
    const prefixEval = evaluateScenarioGeometry(scenario, scenarioSha256);
    if (prefixEval.status !== "OK") {
      return {
        ...base,
        status: prefixEval.status === "INVALID" ? "INVALID" : "UNKNOWN",
        reason: prefixEval.reason,
        witness: null,
        witnessLength: null,
        failedPredicates: [],
        firstFailedStepIndex: null,
        nodesVisited: 0,
        nodesEnqueued: 0,
        nodesPrunedDuplicate: 0,
        transitionsSkippedUnknown: 0,
        maxDepthReached: 0,
        limitReached: null,
        initialState: initial,
        initialMetrics,
      };
    }
    if (prefixEval.finalState !== null) startState = prefixEval.finalState;
    prefixSteps = prefixEval.steps.map((step) => {
      const event = scenario.events[step.index];
      return {
        index: step.index,
        eventId: step.eventId,
        eventType: step.eventType,
        atMs: step.atMs,
        params: eventParams(event),
        state: step.state,
        surfaceRect: step.surfaceRect,
        metrics: step.metrics as GeometryMetrics,
        failedPredicates: step.failedPredicates,
      };
    });
    for (let i = 0; i < prefixSteps.length; i++) {
      if (prefixSteps[i].failedPredicates.length > 0) {
        return {
          ...base,
          status: "FAIL",
          reason: null,
          witness: prefixSteps.slice(0, i + 1),
          witnessLength: i + 1,
          failedPredicates: prefixSteps[i].failedPredicates,
          firstFailedStepIndex: i,
          nodesVisited: 1,
          nodesEnqueued: 1,
          nodesPrunedDuplicate: 0,
          transitionsSkippedUnknown: 0,
          maxDepthReached: 0,
          limitReached: null,
          initialState: initial,
          initialMetrics,
        };
      }
    }
    const lastPrefix = scenario.events[scenario.events.length - 1];
    nextAtMs = lastPrefix.atMs + BFS_STEP_MS;
  }
  const startMetricsComputed = computeMetrics(scenario.layout, startState);
  if (
    startMetricsComputed.status !== "OK" ||
    startMetricsComputed.metrics === null
  ) {
    return {
      ...base,
      status: "INVALID",
      reason: startMetricsComputed.reason,
      witness: null,
      witnessLength: null,
      failedPredicates: [],
      firstFailedStepIndex: null,
      nodesVisited: 0,
      nodesEnqueued: 0,
      nodesPrunedDuplicate: 0,
      transitionsSkippedUnknown: 0,
      maxDepthReached: 0,
      limitReached: null,
      initialState: initial,
      initialMetrics,
    };
  }
  const startMetrics = startMetricsComputed.metrics;

  // Breadth-first search from the start node. The queue is an array
  // with a head index (no shift, no reordering); candidates are
  // appended in frozen alphabet order, so nodes are dequeued in
  // (length, alphabet) order and the first hit is the shortest,
  // tie-broken witness.
  const visited = new Set<string>();
  visited.add(stateKeyFor(startState));
  const queue: Array<BfsNode> = [
    {
      events: [],
      steps: [],
      state: startState,
      metrics: startMetrics,
      depth: 0,
      nextAtMs,
    },
  ];
  let head = 0;
  let nodesVisited = 0;
  let nodesEnqueued = 1;
  let nodesPrunedDuplicate = 0;
  let transitionsSkippedUnknown = 0;
  let maxDepthReached = 0;
  let nodesLimitHit = false;

  while (head < queue.length) {
    const node = queue[head];
    head += 1;
    nodesVisited += 1;
    if (node.depth >= limits.maxDepth) continue;
    for (const template of BFS_ALPHABET) {
      const stepIndex = prefixSteps.length + node.depth + 1;
      const event = buildBfsEvent(template, stepIndex, node.nextAtMs);
      const transition = evaluateEventTransition(
        node.state,
        event,
        scenario.mode,
        scenario.profile,
      );
      if (transition.status === "UNKNOWN") {
        transitionsSkippedUnknown += 1;
        continue;
      }
      const nextState = transition.state;
      const computed = computeMetrics(scenario.layout, nextState);
      if (computed.status !== "OK" || computed.metrics === null) {
        transitionsSkippedUnknown += 1;
        continue;
      }
      const nextMetrics = computed.metrics;
      const fired = evaluatePredicates(
        nextMetrics,
        scenario.failure_predicates,
      );
      const step: BfsWitnessStep = {
        index: prefixSteps.length + node.depth,
        eventId: event.id,
        eventType: event.type,
        atMs: event.atMs,
        params: eventParams(event),
        state: nextState,
        surfaceRect: surfaceRectFor(scenario.layout, nextState),
        metrics: nextMetrics,
        failedPredicates: fired,
      };
      const witness = [...prefixSteps, ...node.steps, step];
      if (fired.length > 0) {
        return {
          ...base,
          status: "FAIL",
          reason: null,
          witness,
          witnessLength: witness.length,
          failedPredicates: fired,
          firstFailedStepIndex: witness.length - 1,
          nodesVisited,
          nodesEnqueued,
          nodesPrunedDuplicate,
          transitionsSkippedUnknown,
          maxDepthReached: Math.max(maxDepthReached, node.depth + 1),
          limitReached: null,
          initialState: initial,
          initialMetrics,
        };
      }
      const key = stateKeyFor(nextState);
      if (visited.has(key)) {
        nodesPrunedDuplicate += 1;
        continue;
      }
      if (nodesEnqueued >= limits.maxNodes) {
        nodesLimitHit = true;
        break;
      }
      visited.add(key);
      nodesEnqueued += 1;
      maxDepthReached = Math.max(maxDepthReached, node.depth + 1);
      queue.push({
        events: [...node.events, event],
        steps: [...node.steps, step],
        state: nextState,
        metrics: nextMetrics,
        depth: node.depth + 1,
        nextAtMs: node.nextAtMs + BFS_STEP_MS,
      });
    }
    if (nodesLimitHit) break;
  }

  return {
    ...base,
    status: "BOUNDED_NO_WITNESS",
    reason: null,
    witness: null,
    witnessLength: null,
    failedPredicates: [],
    firstFailedStepIndex: null,
    nodesVisited,
    nodesEnqueued,
    nodesPrunedDuplicate,
    transitionsSkippedUnknown,
    maxDepthReached,
    limitReached: nodesLimitHit ? "nodes" : "depth",
    initialState: initial,
    initialMetrics,
  };
}

/**
 * Full BFS entry point for an unknown input value: validate first
 * (T004 frozen rules), then search only when VALID. INVALID and
 * UNKNOWN inputs never reach the state machine; their states are null
 * and their witnesses are empty. `scenarioSha256` is supplied by the
 * caller (hashing lives in the scripts, not in this module).
 */
export function searchBfs(
  input: unknown,
  scenarioSha256: string,
): BfsSearchResult {
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
  const { limits, limitsFallbackReason } = limitsFromRawInput(record);
  const validated = validateScenario(input);
  if (validated.outcome !== "VALID" || validated.scenario === null) {
    const status =
      validated.outcome === "INVALID" ? "INVALID" : "UNKNOWN";
    return failClosedResult(
      scenarioId,
      scenarioSha256,
      seed,
      mode,
      status,
      validated.issues.length > 0
        ? validated.issues[0].code
        : "invalid_input",
      validated.issues,
      limits,
      limitsFallbackReason,
    );
  }
  return searchBfsScenario(validated.scenario, scenarioSha256);
}

/**
 * Fail-closed limits (T011, P2-2). Each of `limits.maxDepth` /
 * `limits.maxNodes` is preserved exactly when it is an integer
 * inside its frozen bound ([1, MAX_DEPTH_LIMIT] /
 * [1, MAX_NODES_LIMIT]); a missing, non-numeric, non-integer or
 * out-of-range field falls back to its DEFAULT_LIMITS value, and
 * every fallback is named in the returned reason string (null when
 * nothing fell back). The strings are frozen — the Python BFS Oracle
 * emits the identical strings, so the two sides stay field-identical
 * on fail-closed results.
 */
export function limitsFromRawInput(
  record: Record<string, unknown> | null,
): {
  limits: { maxDepth: number; maxNodes: number };
  limitsFallbackReason: string | null;
} {
  const fallbackParts: Array<string> = [];
  const limitsRecord =
    record !== null &&
    typeof record.limits === "object" &&
    record.limits !== null &&
    !Array.isArray(record.limits)
      ? (record.limits as Record<string, unknown>)
      : null;
  const pick = (
    field: "maxDepth" | "maxNodes",
    max: number,
    fallback: number,
  ): number => {
    const value = limitsRecord !== null ? limitsRecord[field] : undefined;
    if (
      typeof value === "number" &&
      Number.isInteger(value) &&
      value >= 1 &&
      value <= max
    ) {
      return value;
    }
    fallbackParts.push(`limits.${field} invalid, using default ${fallback}`);
    return fallback;
  };
  const limits = {
    maxDepth: pick("maxDepth", MAX_DEPTH_LIMIT, DEFAULT_LIMITS.maxDepth),
    maxNodes: pick("maxNodes", MAX_NODES_LIMIT, DEFAULT_LIMITS.maxNodes),
  };
  return {
    limits,
    limitsFallbackReason:
      fallbackParts.length > 0 ? fallbackParts.join("; ") : null,
  };
}
