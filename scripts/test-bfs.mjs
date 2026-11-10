#!/usr/bin/env node
/**
 * T008 acceptance runner: `npm run test:bfs`.
 *
 * Runs the TypeScript bounded BFS over the 11 BFS fixtures and asserts:
 * - exactly 11 fixtures are present (5 FAIL witnesses, 3
 *   BOUNDED_NO_WITNESS, 2 UNKNOWN, 1 INVALID);
 * - every fixture carries the frozen seed;
 * - every search status / reason / witness event list (type, id,
 *   atMs, parameters) / failed predicates / limitReached equals its
 *   hand-authored expected block;
 * - every witness step's metrics are re-derived independently in
 *   this runner (integer arithmetic: invariant sum, ratio floor,
 *   bottomGap definition, triple-intersection obscuration) and match
 *   the domain, and replaying the witness through the T007 geometry
 *   evaluator reproduces the same per-step metrics, surface rects,
 *   states and failed predicates;
 * - minimality and tie-break are verified by brute force in this
 *   runner, using its own independent copy of the frozen alphabet:
 *   no sequence shorter than the golden witness fires, and among
 *   sequences of the golden length the golden witness is the first
 *   firing sequence in alphabet order;
 * - the dedup fixture is a genuine anti-merge regression: two
 *   reachable depth-3 states with different observable geometry
 *   (visibleRatio 0 vs 500, bottomGap -300000 vs -150000) have equal
 *   naive numeric-field sums but different full-state keys; and an
 *   independent enumeration of the reachable states (runner-side
 *   canonical key, not the domain's stateKeyFor) counts 74 distinct
 *   states to depth 3 while the naive-sum key counts only 34 - the
 *   BFS's nodesVisited/nodesEnqueued must equal 74, proving it kept
 *   every distinct state instead of merging the 40 the naive key
 *   would have collapsed;
 * - the depth-bounded fixture is verified by exhaustive enumeration
 *   up to maxDepth (no sequence fires); the node-capped fixture
 *   stops exactly at its maxNodes budget with limitReached "nodes";
 * - the frozen alphabet in the domain equals this runner's
 *   independent literal copy (12 entries, fixed order);
 * - the search is deterministic: two full runs hash identically;
 * - the domain sources contain no wall-clock / timer / randomness /
 *   float-comparison dependency.
 *
 * Writes evidence/bfs/BFS_TS.json (canonical core + hash) and
 * evidence/bfs/SEARCH_BOUNDS_REPORT.md (frozen alphabet, discrete
 * parameter sets, limits, dedup rule, per-fixture search counts).
 * Exits 0 only when every check passes.
 */
import fs from "node:fs";
import path from "node:path";
import {
  BFS_VERSION,
  FORBIDDEN_TOKENS,
  ROOT,
  SEED,
  deepEqual,
  evaluateTsBfs,
  listBfsFixtures,
  loadJson,
  loadT008Domain,
  sha256Hex,
  writeJson,
  writeText,
} from "./t008-lib.mjs";

const OUT_REL = "evidence/bfs/BFS_TS.json";
const REPORT_REL = "evidence/bfs/SEARCH_BOUNDS_REPORT.md";

/**
 * Independent copy of the frozen alphabet (T008): the runner's
 * brute-force enumeration uses this literal, not the domain's
 * BFS_ALPHABET, so a drift in the domain alphabet is caught by the
 * equality check below instead of silently redefining the search.
 */
const RUNNER_ALPHABET = [
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

const failures = [];
const passes = [];

function check(name, ok, detail) {
  if (ok) passes.push(name);
  else failures.push(detail ? `${name} — ${detail}` : name);
  return ok;
}

function bigIsqrt(n) {
  let x = BigInt(n);
  if (x < 2n) return x;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + BigInt(n) / x) / 2n;
  }
  return x;
}

/** Independent re-derivation of one metric set from its rects. */
function rederiveMetrics(surface, visual, keyboard, keyboardVisible, expectedAnchor) {
  const area = (r) => r.width * r.height;
  const inter = (a, b) => {
    const left = Math.max(a.x, b.x);
    const top = Math.max(a.y, b.y);
    const right = Math.min(a.x + a.width, b.x + b.width);
    const bottom = Math.min(a.y + a.height, b.y + b.height);
    if (right <= left || bottom <= top) return 0;
    return (right - left) * (bottom - top);
  };
  const triple = (a, b, c) => {
    const ab = {
      x: Math.max(a.x, b.x),
      y: Math.max(a.y, b.y),
      width: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
      height: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
    };
    if (ab.width <= 0 || ab.height <= 0) return 0;
    return inter(ab, c);
  };
  const surfaceArea = area(surface);
  const visibleIntersection = inter(surface, visual);
  const obscured = keyboardVisible ? triple(surface, visual, keyboard) : 0;
  const visibleArea = visibleIntersection - obscured;
  const dx = surface.x - expectedAnchor.x;
  const dy = surface.y - expectedAnchor.y;
  return {
    surfaceArea,
    keyboardObscuredArea: obscured,
    viewportClippedArea: surfaceArea - visibleIntersection,
    visibleArea,
    visibleRatio: Number((BigInt(visibleArea) * 1000n) / BigInt(surfaceArea)),
    bottomGap: visual.y + visual.height - (surface.y + surface.height),
    anchorDrift: { dx, dy, magnitude: Number(bigIsqrt(dx * dx + dy * dy)) },
  };
}

function visualRectOf(state) {
  return {
    x: state.visualOffsetLeft,
    y: state.visualOffsetTop,
    width: state.visualWidth,
    height: state.visualHeight,
  };
}

function expectedAnchorOf(layout, state) {
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

/** Deliberately naive state hash: sum of all numeric state fields. */
function naiveStateSum(state) {
  return (
    state.layoutWidth +
    state.layoutHeight +
    state.visualOffsetLeft +
    state.visualOffsetTop +
    state.visualWidth +
    state.visualHeight +
    state.keyboardRect.x +
    state.keyboardRect.y +
    state.keyboardRect.width +
    state.keyboardRect.height +
    state.scrollX +
    state.scrollY +
    state.pendingPan.dx +
    state.pendingPan.dy +
    state.eventClock
  );
}

/** Runner-side canonical JSON (sorted keys, fixed array order). */
function runnerCanonicalJson(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(runnerCanonicalJson).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${runnerCanonicalJson(value[k])}`)
    .join(",")}}`;
}

/**
 * Independently enumerate the reachable states of a fixture up to
 * its maxDepth, using the runner-side canonical key (not the
 * domain's stateKeyFor) and the T007 evaluator for transitions.
 * Returns { fullCount, naiveCount }: distinct states under the full
 * canonical key vs under the naive numeric-field sum.
 */
function enumerateReachableStates(geometryEval, bfs, fixture) {
  const maxDepth = fixture.limits.maxDepth;
  const fullSeen = new Set();
  const naiveSeen = new Set();
  const startCandidate = { ...fixture, events: [] };
  delete startCandidate.expected;
  const startEval = geometryEval.evaluateGeometry(
    startCandidate,
    sha256Hex(bfs.canonicalBfsJson(startCandidate)),
  );
  if (startEval.status !== "OK" || startEval.initialState === null) {
    throw new Error(`enumeration start failed: status=${startEval.status}`);
  }
  fullSeen.add(runnerCanonicalJson(startEval.initialState));
  naiveSeen.add(naiveStateSum(startEval.initialState));
  let current = [{ events: [], state: startEval.initialState }];
  for (let d = 0; d < maxDepth; d++) {
    const next = [];
    for (const node of current) {
      for (const template of RUNNER_ALPHABET) {
        const baseAtMs =
          node.events.length > 0
            ? node.events[node.events.length - 1].atMs
            : 0;
        const event = runnerEvent(
          template,
          node.events.length + 1,
          baseAtMs + 100,
        );
        const candidate = { ...fixture, events: [...node.events, event] };
        delete candidate.expected;
        const evaled = geometryEval.evaluateGeometry(
          candidate,
          sha256Hex(bfs.canonicalBfsJson(candidate)),
        );
        if (evaled.status !== "OK") continue;
        const state = evaled.steps[evaled.steps.length - 1].state;
        const key = runnerCanonicalJson(state);
        if (fullSeen.has(key)) continue;
        fullSeen.add(key);
        naiveSeen.add(naiveStateSum(state));
        next.push({ events: [...node.events, event], state });
      }
    }
    current = next;
  }
  return { fullCount: fullSeen.size, naiveCount: naiveSeen.size };
}

/** Build one generated event from a runner-alphabet entry. */
function runnerEvent(template, stepIndex, atMs) {
  const slug =
    template.type === "KEYBOARD_OPEN"
      ? `open-${template.keyboardHeight}`
      : template.type === "KEYBOARD_CLOSE"
        ? "close"
        : template.type === "SCROLL"
          ? `scroll-${template.dx}-${template.dy}`
          : template.type === "DELAYED_VISUAL_PAN"
            ? `pan-${template.dx}-${template.dy}`
            : "settled";
  const id = `chk-${stepIndex}-${slug}`;
  switch (template.type) {
    case "KEYBOARD_OPEN":
      return { type: "KEYBOARD_OPEN", id, atMs, keyboardHeight: template.keyboardHeight };
    case "KEYBOARD_CLOSE":
      return { type: "KEYBOARD_CLOSE", id, atMs };
    case "SCROLL":
      return { type: "SCROLL", id, atMs, dx: template.dx, dy: template.dy };
    case "DELAYED_VISUAL_PAN":
      return { type: "DELAYED_VISUAL_PAN", id, atMs, dx: template.dx, dy: template.dy };
    case "VIEWPORT_SETTLED":
      return { type: "VIEWPORT_SETTLED", id, atMs };
    default:
      throw new Error(`unknown template type ${template.type}`);
  }
}

/** All sequences of `length` alphabet entries, in alphabet order. */
function* sequencesOf(length, prefix = []) {
  if (length === 0) {
    yield prefix;
    return;
  }
  for (const template of RUNNER_ALPHABET) {
    yield* sequencesOf(length - 1, [...prefix, template]);
  }
}

/**
 * Does this generated suffix (appended to the fixture prefix) make
 * any predicate fire, when replayed through the T007 evaluator?
 * Returns the first firing step index, or null.
 */
function firstFiringStep(geometryEval, bfs, fixture, suffix) {
  const prefix = fixture.events ?? [];
  const baseAtMs = prefix.length > 0 ? prefix[prefix.length - 1].atMs : 0;
  const events = [
    ...prefix,
    ...suffix.map((t, j) =>
      runnerEvent(t, prefix.length + j + 1, baseAtMs + (j + 1) * 100),
    ),
  ];
  const candidate = { ...fixture, events };
  delete candidate.expected;
  const sha = sha256Hex(bfs.canonicalBfsJson(candidate));
  const evaled = geometryEval.evaluateGeometry(candidate, sha);
  if (evaled.status !== "OK") return { error: evaled.status, step: null };
  for (let i = 0; i < evaled.steps.length; i++) {
    if (evaled.steps[i].failedPredicates.length > 0) return { error: null, step: i };
  }
  return { error: null, step: null };
}

function witnessEventView(step) {
  const view = { type: step.eventType, id: step.eventId, atMs: step.atMs };
  if (step.params.keyboardHeight !== undefined) view.keyboardHeight = step.params.keyboardHeight;
  if (step.params.dx !== undefined) {
    view.dx = step.params.dx;
    view.dy = step.params.dy;
  }
  return view;
}

function eventObjectOf(step) {
  const event = { type: step.eventType, id: step.eventId, atMs: step.atMs };
  if (step.params.keyboardHeight !== undefined) event.keyboardHeight = step.params.keyboardHeight;
  if (step.params.dx !== undefined) {
    event.dx = step.params.dx;
    event.dy = step.params.dy;
  }
  return event;
}

async function main() {
  const files = listBfsFixtures();
  check("exactly 11 BFS fixtures present", files.length === 11, `found ${files.length}`);
  const fixtures = files.map(loadJson);
  for (const f of fixtures) {
    check(`fixture ${f.scenario_id} carries the frozen seed`, f.seed === SEED, `seed=${f.seed}`);
  }

  const { bfs, geometryEval, sources } = await loadT008Domain();
  for (const [relPath, source] of Object.entries(sources)) {
    for (const token of FORBIDDEN_TOKENS) {
      check(
        `${relPath} contains no forbidden token ${token}`,
        !source.includes(token),
        `${relPath} contains ${token}`,
      );
    }
  }
  check(
    "domain alphabet equals the runner's independent literal (12 entries, frozen order)",
    deepEqual(bfs.BFS_ALPHABET, RUNNER_ALPHABET),
    `domain=${JSON.stringify(bfs.BFS_ALPHABET)}`,
  );
  check("BFS version is bfs/v1", bfs.BFS_VERSION === "bfs/v1", `version=${bfs.BFS_VERSION}`);
  check("BFS step spacing is 100 ms", bfs.BFS_STEP_MS === 100, `stepMs=${bfs.BFS_STEP_MS}`);

  const { core, analysisSha256 } = evaluateTsBfs(bfs, fixtures);
  const { core: core2, analysisSha256: hash2 } = evaluateTsBfs(bfs, fixtures);
  check(
    "two full BFS runs hash identically",
    analysisSha256 === hash2,
    `run1=${analysisSha256} run2=${hash2}`,
  );
  check(
    "canonical output contains no absolute workspace path",
    !bfs.canonicalBfsJson(core).includes(ROOT),
    "absolute path leaked into canonical result",
  );

  const results = core.results;
  const byId = new Map(results.map((r) => [r.scenarioId, r]));
  const byFixture = new Map(fixtures.map((f) => [f.scenario_id, f]));

  let failCount = 0;
  let boundedCount = 0;
  let unknownCount = 0;
  let invalidCount = 0;
  for (const fixture of fixtures) {
    const result = byId.get(fixture.scenario_id);
    const expected = fixture.expected;
    const tag = fixture.scenario_id;
    check(
      `${tag}: status is ${expected.status}`,
      result.status === expected.status,
      `status=${result.status} reason=${result.reason}`,
    );
    check(
      `${tag}: reason is ${expected.reason ?? "null"}`,
      result.reason === (expected.reason ?? null),
      `reason=${result.reason}`,
    );
    check(
      `${tag}: limitReached is ${expected.limitReached ?? "null"}`,
      result.limitReached === (expected.limitReached ?? null),
      `limitReached=${result.limitReached}`,
    );
    if (expected.nodesVisited !== undefined) {
      check(
        `${tag}: nodesVisited is ${expected.nodesVisited}`,
        result.nodesVisited === expected.nodesVisited,
        `nodesVisited=${result.nodesVisited}`,
      );
    }
    if (expected.nodesEnqueued !== undefined) {
      check(
        `${tag}: nodesEnqueued is ${expected.nodesEnqueued}`,
        result.nodesEnqueued === expected.nodesEnqueued,
        `nodesEnqueued=${result.nodesEnqueued}`,
      );
    }
    check(
      `${tag}: failedPredicates equal expected`,
      deepEqual(result.failedPredicates, expected.failedPredicates ?? []),
      `failedPredicates=${JSON.stringify(result.failedPredicates)}`,
    );

    if (result.status === "FAIL") {
      failCount += 1;
      check(
        `${tag}: witness is present`,
        Array.isArray(result.witness) && result.witness !== null,
        "witness is null",
      );
      const witness = result.witness ?? [];
      check(
        `${tag}: witnessLength is ${expected.witness.length}`,
        result.witnessLength === expected.witness.length,
        `witnessLength=${result.witnessLength}`,
      );
      check(
        `${tag}: witness events equal golden (type/id/atMs/params)`,
        deepEqual(witness.map(witnessEventView), expected.witness),
        `witness=${JSON.stringify(witness.map(witnessEventView))}`,
      );
      check(
        `${tag}: firstFailedStepIndex is the last witness step`,
        result.firstFailedStepIndex === witness.length - 1,
        `firstFailedStepIndex=${result.firstFailedStepIndex}`,
      );
      // Independent metric re-derivation + witness replay via T007.
      const prefixLen = fixture.events.length;
      for (let i = 0; i < witness.length; i++) {
        const step = witness[i];
        const rederived = rederiveMetrics(
          step.surfaceRect,
          visualRectOf(step.state),
          step.state.keyboardRect,
          step.state.keyboardVisible,
          expectedAnchorOf(fixture.layout, step.state),
        );
        check(
          `${tag}: step ${i} metrics re-derived independently`,
          deepEqual(step.metrics, rederived),
          `metrics=${JSON.stringify(step.metrics)} rederived=${JSON.stringify(rederived)}`,
        );
        check(
          `${tag}: step ${i} fires exactly its recorded predicates`,
          i < witness.length - 1
            ? step.failedPredicates.length === 0
            : deepEqual(step.failedPredicates, expected.failedPredicates ?? []),
          `step failedPredicates=${JSON.stringify(step.failedPredicates)}`,
        );
      }
      const replayScenario = { ...fixture, events: witness.map(eventObjectOf) };
      delete replayScenario.expected;
      const replaySha = sha256Hex(bfs.canonicalBfsJson(replayScenario));
      const replayed = geometryEval.evaluateGeometry(replayScenario, replaySha);
      check(`${tag}: witness replays OK through T007`, replayed.status === "OK", `status=${replayed.status} reason=${replayed.reason}`);
      if (replayed.status === "OK") {
        check(
          `${tag}: replay step metrics match witness steps`,
          replayed.steps.length === witness.length &&
            replayed.steps.every((s, i) => deepEqual(s.metrics, witness[i].metrics)),
          `replay steps=${replayed.steps.length} witness=${witness.length}`,
        );
        check(
          `${tag}: replay step states match witness steps`,
          replayed.steps.length === witness.length &&
            replayed.steps.every((s, i) => deepEqual(s.state, witness[i].state)),
          "replay state mismatch",
        );
        check(
          `${tag}: replay first failure is the last step`,
          replayed.steps.every((s, i) =>
            i < witness.length - 1
              ? s.failedPredicates.length === 0
              : s.failedPredicates.length > 0,
          ),
          `replay failedPredicates=${JSON.stringify(replayed.steps.map((s) => s.failedPredicates))}`,
        );
      }
      // Minimality + tie-break by brute force with the runner alphabet.
      const goldenLen = expected.witness.length;
      const suffixLen = goldenLen - prefixLen;
      let shorterFired = false;
      for (let len = 0; len < suffixLen; len++) {
        for (const suffix of sequencesOf(len)) {
          const found = firstFiringStep(geometryEval, bfs, fixture, suffix);
          if (found.error !== null) {
            check(`${tag}: brute-force length-${len} replay is OK`, false, `error=${found.error}`);
            shorterFired = true;
            break;
          }
          if (found.step !== null) {
            shorterFired = true;
            break;
          }
        }
        if (shorterFired) break;
      }
      check(`${tag}: no shorter sequence fires (minimality)`, !shorterFired, "a shorter sequence fired");
      let firstAtGoldenLen = null;
      for (const suffix of sequencesOf(suffixLen)) {
        const found = firstFiringStep(geometryEval, bfs, fixture, suffix);
        if (found.error !== null) {
          check(`${tag}: brute-force length-${suffixLen} replay is OK`, false, `error=${found.error}`);
          break;
        }
        if (found.step !== null) {
          firstAtGoldenLen = suffix;
          break;
        }
      }
      const goldenSuffix = expected.witness.slice(prefixLen).map((w) => {
        if (w.type === "KEYBOARD_OPEN") return { type: "KEYBOARD_OPEN", keyboardHeight: w.keyboardHeight };
        if (w.type === "KEYBOARD_CLOSE") return { type: "KEYBOARD_CLOSE" };
        if (w.type === "SCROLL") return { type: "SCROLL", dx: w.dx, dy: w.dy };
        if (w.type === "DELAYED_VISUAL_PAN") return { type: "DELAYED_VISUAL_PAN", dx: w.dx, dy: w.dy };
        return { type: "VIEWPORT_SETTLED" };
      });
      check(
        `${tag}: golden is the first firing sequence at its length (tie-break)`,
        deepEqual(firstAtGoldenLen, goldenSuffix),
        `first=${JSON.stringify(firstAtGoldenLen)} golden=${JSON.stringify(goldenSuffix)}`,
      );
    } else if (result.status === "BOUNDED_NO_WITNESS") {
      boundedCount += 1;
      check(`${tag}: witness is null`, result.witness === null, "witness present");
      check(`${tag}: witnessLength is null`, result.witnessLength === null, `witnessLength=${result.witnessLength}`);
      if (result.limitReached === "depth") {
        // Exhaustive enumeration up to maxDepth: no sequence may fire.
        const prefixLen = fixture.events.length;
        const maxDepth = fixture.limits.maxDepth;
        let anyFired = false;
        for (let len = 0; len <= maxDepth - prefixLen; len++) {
          for (const suffix of sequencesOf(len)) {
            const found = firstFiringStep(geometryEval, bfs, fixture, suffix);
            if (found.error !== null) {
              check(`${tag}: exhaustive length-${len} replay is OK`, false, `error=${found.error}`);
              anyFired = true;
              break;
            }
            if (found.step !== null) {
              anyFired = true;
              break;
            }
          }
          if (anyFired) break;
        }
        check(`${tag}: exhaustive enumeration to maxDepth finds no failure`, !anyFired, "a sequence fired");
      } else if (result.limitReached === "nodes") {
        check(
          `${tag}: node budget exhausted exactly at maxNodes`,
          result.nodesEnqueued === fixture.limits.maxNodes,
          `nodesEnqueued=${result.nodesEnqueued} maxNodes=${fixture.limits.maxNodes}`,
        );
      }
    } else if (result.status === "UNKNOWN") {
      unknownCount += 1;
      check(`${tag}: UNKNOWN witness is null`, result.witness === null, "witness present");
      check(`${tag}: UNKNOWN initialState is null`, result.initialState === null, "initialState present");
    } else if (result.status === "INVALID") {
      invalidCount += 1;
      check(`${tag}: INVALID witness is null`, result.witness === null, "witness present");
      check(`${tag}: INVALID initialState is null`, result.initialState === null, "initialState present");
    }
    check(
      `${tag}: search never claims full-space safety`,
      result.status !== "BOUNDED_NO_WITNESS" || result.limitReached !== null,
      "BOUNDED without a limit",
    );
  }
  check("5 FAIL witnesses", failCount === 5, `fail=${failCount}`);
  check("3 BOUNDED_NO_WITNESS", boundedCount === 3, `bounded=${boundedCount}`);
  check("2 UNKNOWN", unknownCount === 2, `unknown=${unknownCount}`);
  check("1 INVALID", invalidCount === 1, `invalid=${invalidCount}`);
  const modes = new Set(results.filter((r) => r.status === "FAIL").map((r) => r.mode));
  check(
    "witnesses cover all three modes",
    ["resizes-visual", "resizes-content", "overlays-content"].every((m) => modes.has(m)),
    `modes=${[...modes].join(",")}`,
  );

  // Dedup regression, in two independent parts.
  //
  // (a) Collision pair: two reachable depth-3 states with different
  // observable geometry whose naive numeric-field sums are equal.
  //   A = [OPEN150, OPEN150, OPEN300]  (visualHeight 544000, kb 300000)
  //   B = [OPEN150, PAN300, PAN-300]   (visualHeight 694000, kb 150000,
  //                                      pendingPan (0,-150000))
  // Both sum to 3402300, but A has visibleRatio 0 / bottomGap -300000
  // while B has visibleRatio 500 / bottomGap -150000.
  //
  // (b) Independent reachable-state enumeration for the dedup
  // fixture (runner-side canonical key, written here, not the
  // domain's stateKeyFor): the full key must count 74 distinct
  // states to depth 3 while the naive-sum key counts only 34, and
  // the BFS's nodesVisited/nodesEnqueued must equal 74 - proving
  // the search kept every distinct state instead of merging the 40
  // the naive key would have collapsed.
  {
    const dedupFixture = byFixture.get("bfs-dedup-rv-sheet");
    const dedupResult = byId.get("bfs-dedup-rv-sheet");
    const stateAfter = (events) => {
      const candidate = { ...dedupFixture, events };
      delete candidate.expected;
      const sha = sha256Hex(bfs.canonicalBfsJson(candidate));
      const evaled = geometryEval.evaluateGeometry(candidate, sha);
      if (evaled.status !== "OK" || evaled.steps.length !== events.length) {
        throw new Error(`dedup replay failed: status=${evaled.status}`);
      }
      const last = evaled.steps[evaled.steps.length - 1];
      return { state: last.state, metrics: last.metrics };
    };
    const stateA = stateAfter([
      { type: "KEYBOARD_OPEN", id: "d-a1", atMs: 100, keyboardHeight: 150000 },
      { type: "KEYBOARD_OPEN", id: "d-a2", atMs: 200, keyboardHeight: 150000 },
      { type: "KEYBOARD_OPEN", id: "d-a3", atMs: 300, keyboardHeight: 300000 },
    ]);
    const stateB = stateAfter([
      { type: "KEYBOARD_OPEN", id: "d-b1", atMs: 100, keyboardHeight: 150000 },
      { type: "DELAYED_VISUAL_PAN", id: "d-b2", atMs: 200, dx: 0, dy: 300000 },
      { type: "DELAYED_VISUAL_PAN", id: "d-b3", atMs: 300, dx: 0, dy: -300000 },
    ]);
    check(
      "dedup: naive numeric-field sums collide for the two states",
      naiveStateSum(stateA.state) === naiveStateSum(stateB.state),
      `sumA=${naiveStateSum(stateA.state)} sumB=${naiveStateSum(stateB.state)}`,
    );
    check(
      "dedup: full-state keys differ for the two states",
      bfs.stateKeyFor(stateA.state) !== bfs.stateKeyFor(stateB.state),
      "keys are equal - observable states would be merged",
    );
    check(
      "dedup: the two states have different observable geometry",
      stateA.metrics.visibleRatio !== stateB.metrics.visibleRatio &&
        stateA.metrics.bottomGap !== stateB.metrics.bottomGap,
      `metricsA=${JSON.stringify(stateA.metrics)} metricsB=${JSON.stringify(stateB.metrics)}`,
    );
    check(
      "dedup: pair metrics are the hand-computed values (ratio 0 vs 500)",
      stateA.metrics.visibleRatio === 0 && stateB.metrics.visibleRatio === 500 &&
        stateA.metrics.bottomGap === -300000 && stateB.metrics.bottomGap === -150000,
      `metricsA=${JSON.stringify(stateA.metrics)} metricsB=${JSON.stringify(stateB.metrics)}`,
    );
    const enumerated = enumerateReachableStates(geometryEval, bfs, dedupFixture);
    check(
      "dedup: independent enumeration counts 74 distinct states to depth 3",
      enumerated.fullCount === 74,
      `fullCount=${enumerated.fullCount}`,
    );
    check(
      "dedup: naive-sum key would count only 34 distinct states",
      enumerated.naiveCount === 34 && enumerated.naiveCount < enumerated.fullCount,
      `naiveCount=${enumerated.naiveCount} fullCount=${enumerated.fullCount}`,
    );
    check(
      "dedup: BFS visited exactly the independently enumerated states",
      dedupResult.nodesVisited === enumerated.fullCount &&
        dedupResult.nodesEnqueued === enumerated.fullCount,
      `nodesVisited=${dedupResult.nodesVisited} nodesEnqueued=${dedupResult.nodesEnqueued} fullCount=${enumerated.fullCount}`,
    );
  }

  const out = {
    analysisSha256,
    determinism: { runs: 2, uniqueHashes: 1, hashes: [analysisSha256] },
    results,
    seed: SEED,
    version: BFS_VERSION,
  };
  writeJson(path.join(ROOT, OUT_REL), out);
  writeText(path.join(ROOT, REPORT_REL), boundsReport(results, fixtures));
  console.log(
    `\nfixtures: ${fixtures.length} (FAIL=${failCount}, BOUNDED_NO_WITNESS=${boundedCount}, UNKNOWN=${unknownCount}, INVALID=${invalidCount})`,
  );
  console.log(`analysisSha256: ${analysisSha256}`);
  console.log(`wrote ${OUT_REL}`);
  console.log(`wrote ${REPORT_REL}`);
  console.log(`\nchecks passed: ${passes.length}, checks failed: ${failures.length}`);
  if (failures.length > 0) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(`- ${f}`);
    console.log("\nBFS (TS): FAIL");
    process.exitCode = 1;
  } else {
    console.log("\nBFS (TS): PASS");
    process.exitCode = 0;
  }
}

function boundsReport(results, fixtures) {
  const lines = [];
  lines.push("# P021 ViewportShift — BFS search-bounds report (T008)");
  lines.push("");
  lines.push("Seed: `P021-VIEWPORTSHIFT-S0-2026-11-10`. BFS version: `bfs/v1`.");
  lines.push("Generated by `npm run test:bfs` from the frozen domain constants;");
  lines.push("no timestamps, wall-clock values, random values or machine paths.");
  lines.push("");
  lines.push("## Frozen alphabet (12 candidate events, fixed exploration order)");
  lines.push("");
  lines.push("Order is event-type order, then numeric parameter order");
  lines.push("(dx ascending, then dy ascending within a type). Generated event");
  lines.push("ids are `bfs-<step>-<slug>`; generated events are spaced 100 ms apart,");
  lines.push("continuing after the last prefix event (or from 0 with no prefix).");
  lines.push("");
  lines.push("| # | Event type | Parameters |");
  lines.push("|---:|---|---|");
  RUNNER_ALPHABET.forEach((t, i) => {
    const params =
      t.type === "KEYBOARD_OPEN"
        ? `keyboardHeight=${t.keyboardHeight}`
        : t.type === "SCROLL" || t.type === "DELAYED_VISUAL_PAN"
          ? `dx=${t.dx}, dy=${t.dy}`
          : "—";
    lines.push(`| ${i + 1} | ${t.type} | ${params} |`);
  });
  lines.push("");
  lines.push("## Discrete parameter sets");
  lines.push("");
  lines.push("- `KEYBOARD_OPEN.keyboardHeight`: {150000, 300000} milli-px (150 / 300 CSS px).");
  lines.push("- `SCROLL` (dx, dy): {(-100000, 0), (0, -100000), (0, 100000), (100000, 0)}.");
  lines.push("- `DELAYED_VISUAL_PAN` (dx, dy): dx is 0 only; dy in {-300000, -100000, 100000, 300000}.");
  lines.push("  dx is 0 only because visualWidth always equals layoutWidth (no pinch zoom,");
  lines.push("  scale fixed at 1), so maxLeft is 0 and any non-zero dx pan is clamped to an");
  lines.push("  applied dx of 0 — a geometrically inert branch that would only duplicate states.");
  lines.push("- `KEYBOARD_CLOSE`, `VIEWPORT_SETTLED`: no parameters.");
  lines.push("");
  lines.push("## Depth / node bounds");
  lines.push("");
  lines.push("- Default limits (Schema `viewportshift.scenario/v1`, DEFAULT_LIMITS):");
  lines.push("  maxDepth 8, maxNodes 10000.");
  lines.push("- Each fixture may freeze tighter limits in its own `limits` block;");
  lines.push("  the search never exceeds the scenario's maxDepth / maxNodes.");
  lines.push("- `limitReached: \"depth\"` means the queue was exhausted within maxDepth;");
  lines.push("  `limitReached: \"nodes\"` means the node budget was exhausted first.");
  lines.push("  Either way the result is BOUNDED_NO_WITNESS — never a claim that the");
  lines.push("  whole space is safe.");
  lines.push("");
  lines.push("## Dedup rule");
  lines.push("");
  lines.push("Dedup key = the full ViewportState canonical JSON (all 13 fields, fixed");
  lines.push("key order, including eventClock, scrollX/scrollY and pendingPan). Two");
  lines.push("states share a key only when identical in every field, so different");
  lines.push("observable geometry can never be merged. This is deliberately");
  lines.push("conservative: states differing only in clock/scroll/pendingPan are kept");
  lines.push("as separate nodes (over-splitting costs nodes; merging would cost");
  lines.push("correctness). Regression fixture: bfs-dedup-rv-sheet — two depth-3");
  lines.push("states with different observable geometry (visibleRatio 0 vs 500)");
  lines.push("share one naive numeric-field sum (3402300) but have different keys;");
  lines.push("an independent enumeration counts 74 distinct states to depth 3 under");
  lines.push("the full key vs only 34 under the naive sum, and the BFS visits all 74.");
  lines.push("");
  lines.push("## Per-fixture search counts");
  lines.push("");
  lines.push("| Fixture | Status | Witness | Nodes visited | Nodes enqueued | Pruned duplicates | Unknown transitions | Max depth reached | Limit |");
  lines.push("|---|---|---|---|---|---|---|---|---|");
  for (const r of results) {
    const fx = fixtures.find((f) => f.scenario_id === r.scenarioId);
    lines.push(
      `| ${r.scenarioId} | ${r.status} | ${r.witnessLength ?? "—"} | ${r.nodesVisited} | ${r.nodesEnqueued} | ${r.nodesPrunedDuplicate} | ${r.transitionsSkippedUnknown} | ${r.maxDepthReached} | ${r.limitReached ?? "—"} |`,
    );
    void fx;
  }
  lines.push("");
  lines.push("## Semantics notes");
  lines.push("");
  lines.push("- Any-step semantics: the predicate is evaluated after every step, including");
  lines.push("  the initial state and every prefix step; the first failing step is the hit.");
  lines.push("  (S0 scenario verdicts use final-step semantics instead; that is a verdict");
  lines.push("  rule, not the BFS rule — a transient open-close failure is a BFS witness.)");
  lines.push("- A hit is status FAIL with the full witness: event sequence, first failing");
  lines.push("  predicate(s), and the before/after state and metrics of every step.");
  lines.push("- Out-of-model inputs fail closed as UNKNOWN (e.g. profile.scale != 1,");
  lines.push("  unknown mode); structurally malformed inputs are INVALID.");
  lines.push("");
  return `${lines.join("\n")}`;
}

main().catch((err) => {
  console.error(`runner error: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
