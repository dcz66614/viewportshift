#!/usr/bin/env node
/**
 * T011 acceptance runner: `npm run test:property -- --seed
 * P021-VIEWPORTSHIFT-S0-2026-11-10`.
 *
 * Fixed-seed property tests over deterministically generated
 * scenarios (no wall clock, no randomness: a mulberry32 PRNG seeded
 * from the frozen seed string). The property fixtures in
 * `tests/fixtures/properties/` declare the seven properties and
 * their sample counts; this runner executes them:
 *
 * - invariant-sum: visible + clipped + obscured == surfaceArea on
 *   every replayed step (exact integer invariant, PROJECT_BOOK §4.4).
 * - ratio-floor: visibleRatio == floor(visibleArea*1000/surfaceArea)
 *   and 0 <= visibleRatio <= 1000 on every step.
 * - determinism: evaluating and searching the same scenario twice
 *   yields byte-identical canonical JSON.
 * - bfs-shortest: for small scenarios (maxDepth 2, no prefix),
 *   brute-force enumeration finds no firing sequence shorter than
 *   the BFS witness, and the witness replays to a firing step.
 * - fail-closed: unsupported inputs never evaluate to PASS/FAIL.
 * - pan-clamp: after any DELAYED_VISUAL_PAN the visual offsets stay
 *   inside the bounds computed from the pre-pan state.
 * - oracle-parity-random: generated (not hand-written) scenarios
 *   agree field-by-field between TS and the Python Geometry Oracle.
 *
 * Writes evidence/coverage/PROPERTY_TEST.json (counts + hash).
 * Exits 0 only when every check passes. `--seed` must equal the
 * frozen seed; any other seed is rejected.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ROOT,
  SEED,
  deepEqual,
  diffPaths,
  listPropertyFixtures,
  loadJson,
  loadT011Domain,
  rederiveMetrics,
  runPythonGeometryOracle,
  sha256Hex,
  writeJson,
} from "./t011-lib.mjs";

const OUT_REL = "evidence/coverage/PROPERTY_TEST.json";

const failures = [];
const passes = [];

function check(name, ok, detail) {
  if (ok) passes.push(name);
  else failures.push(detail ? `${name} — ${detail}` : name);
  return ok;
}

/** FNV-1a 32-bit hash of a string (deterministic seed derivation). */
function fnv1a(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** Mulberry32 PRNG (deterministic; seed is a 32-bit integer). */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TEMPLATES = {
  "chat-input": { template: "chat-input", anchor: "bottom", offsetMilli: 0, xMilli: 0, widthMilli: 390000, heightMilli: 56000 },
  "bottom-sheet": { template: "bottom-sheet", anchor: "bottom", offsetMilli: 0, xMilli: 0, widthMilli: 390000, heightMilli: 280000 },
  "fixed-cta": { template: "fixed-cta", anchor: "bottom", offsetMilli: 16000, xMilli: 16000, widthMilli: 358000, heightMilli: 64000 },
  "search-bar": { template: "search-bar", anchor: "top", offsetMilli: 16000, xMilli: 16000, widthMilli: 358000, heightMilli: 48000 },
};
const TEMPLATE_NAMES = Object.keys(TEMPLATES);
const MODES = ["resizes-visual", "resizes-content", "overlays-content"];
const KB_HEIGHTS = [0, 150000, 300000, 544000, 844000];
const PREDS = [
  { field: "visibleRatio", op: "<", threshold: 1000 },
  { field: "keyboardObscuredArea", op: ">", threshold: 0 },
  { field: "bottomGap", op: "<", threshold: 0 },
  { field: "anchorDriftMagnitude", op: ">", threshold: 50000 },
];

function pick(rand, arr) {
  return arr[Math.floor(rand() * arr.length)];
}

function randomEvent(rand, index) {
  const atMs = 100 * (index + 1);
  const id = `r${index + 1}`;
  const kind = pick(rand, ["OPEN150", "OPEN300", "CLOSE", "SCROLL", "PAN", "SETTLED"]);
  switch (kind) {
    case "OPEN150": return { type: "KEYBOARD_OPEN", id, atMs, keyboardHeight: 150000 };
    case "OPEN300": return { type: "KEYBOARD_OPEN", id, atMs, keyboardHeight: 300000 };
    case "CLOSE": return { type: "KEYBOARD_CLOSE", id, atMs };
    case "SCROLL": {
      const deltas = [[-100000, 0], [0, -100000], [0, 100000], [100000, 0]];
      const [dx, dy] = pick(rand, deltas);
      return { type: "SCROLL", id, atMs, dx, dy };
    }
    case "PAN": {
      const dy = pick(rand, [-300000, -100000, 100000, 300000]);
      return { type: "DELAYED_VISUAL_PAN", id, atMs, dx: 0, dy };
    }
    default: return { type: "VIEWPORT_SETTLED", id, atMs };
  }
}

function randomScenario(rand, index, maxDepth = 3, eventCount = null) {
  const template = pick(rand, TEMPLATE_NAMES);
  const count = eventCount ?? Math.floor(rand() * 4);
  const events = [];
  for (let i = 0; i < count; i++) events.push(randomEvent(rand, i));
  return {
    scenario_id: `prop-random-${index}`,
    seed: SEED,
    unit: "css-px-milli",
    layout: { ...TEMPLATES[template] },
    viewport: { layoutWidth: 390000, layoutHeight: 844000 },
    keyboard: { heightMilli: pick(rand, KB_HEIGHTS) },
    mode: pick(rand, MODES),
    events,
    failure_predicates: PREDS.map((p) => ({ ...p })),
    limits: { maxEvents: 8, maxPanMilli: 500000, maxDepth, maxNodes: 10000, scale: 1 },
    profile: { scale: 1 },
  };
}

async function main() {
  const argv = process.argv.slice(2);
  let seedArg = SEED;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--seed" && i + 1 < argv.length) seedArg = argv[i + 1];
  }
  check("seed argument equals the frozen seed", seedArg === SEED, `seed=${seedArg}`);
  if (seedArg !== SEED) {
    console.log(`checks passed: ${passes.length}, checks failed: ${failures.length}`);
    process.exitCode = 1;
    return;
  }

  const propertyFiles = listPropertyFixtures();
  check("exactly 7 property fixtures present", propertyFiles.length === 7,
    `found ${propertyFiles.length}`);
  const properties = propertyFiles.map(loadJson);
  const byId = {};
  for (const prop of properties) {
    byId[prop.property_id] = prop;
    check(
      `${prop.property_id}: frozen seed`,
      prop.seed === SEED,
      `seed=${prop.seed}`,
    );
    check(
      `${prop.property_id}: sample_count is a positive integer`,
      Number.isInteger(prop.sample_count) && prop.sample_count > 0,
      `sample_count=${prop.sample_count}`,
    );
  }

  const { geometryEval, geometry, events, bfs } = await loadT011Domain();
  const rand = mulberry32(fnv1a(SEED));
  const perProperty = {};

  const record = (id, ok) => {
    perProperty[id] = perProperty[id] ?? { passed: 0, failed: 0 };
    if (ok) perProperty[id].passed += 1;
    else perProperty[id].failed += 1;
  };

  // ---- invariant-sum + ratio-floor (shared generated scenarios). ----
  {
    const count = byId["prop-invariant-sum"].sample_count;
    const countRatio = byId["prop-ratio-floor"].sample_count;
    const n = Math.max(count, countRatio);
    for (let i = 0; i < n; i++) {
      const scenario = randomScenario(rand, i);
      const sha = sha256Hex(bfs.canonicalBfsJson(scenario));
      const result = geometryEval.evaluateGeometry(scenario, sha);
      let invariantOk = true;
      let ratioOk = true;
      for (const step of result.steps) {
        if (step.status !== "OK" || step.metrics === null) continue;
        const m = step.metrics;
        if (
          m.visibleArea + m.viewportClippedArea + m.keyboardObscuredArea !==
          m.surfaceArea
        ) invariantOk = false;
        const expectedRatio = Number(
          (BigInt(m.visibleArea) * 1000n) / BigInt(m.surfaceArea),
        );
        if (
          m.visibleRatio !== expectedRatio ||
          m.visibleRatio < 0 ||
          m.visibleRatio > 1000
        ) ratioOk = false;
        // Cross-check against the runner-side re-derivation too.
        const visualRect = {
          x: step.state.visualOffsetLeft,
          y: step.state.visualOffsetTop,
          width: step.state.visualWidth,
          height: step.state.visualHeight,
        };
        if (
          !deepEqual(
            rederiveMetrics(
              step.surfaceRect, visualRect, step.state.keyboardRect,
              step.state.keyboardVisible, step.expectedAnchorRect,
            ),
            step.metrics,
          )
        ) {
          invariantOk = false;
          ratioOk = false;
        }
      }
      if (i < count) {
        check(`prop-invariant-sum #${i}`, invariantOk);
        record("prop-invariant-sum", invariantOk);
      }
      if (i < countRatio) {
        check(`prop-ratio-floor #${i}`, ratioOk);
        record("prop-ratio-floor", ratioOk);
      }
    }
  }

  // ---- determinism. ----
  {
    const count = byId["prop-determinism"].sample_count;
    for (let i = 0; i < count; i++) {
      const scenario = randomScenario(rand, 1000 + i);
      const sha = sha256Hex(bfs.canonicalBfsJson(scenario));
      const firstEval = geometryEval.evaluateGeometry(scenario, sha);
      const secondEval = geometryEval.evaluateGeometry(scenario, sha);
      const firstBfs = bfs.searchBfs(scenario, sha);
      const secondBfs = bfs.searchBfs(scenario, sha);
      const ok =
        geometry.canonicalJson(firstEval) === geometry.canonicalJson(secondEval) &&
        bfs.canonicalBfsJson(firstBfs) === bfs.canonicalBfsJson(secondBfs);
      check(`prop-determinism #${i}`, ok);
      record("prop-determinism", ok);
    }
  }

  // ---- bfs-shortest (brute force, maxDepth 2, no prefix). ----
  {
    const count = byId["prop-bfs-shortest"].sample_count;
    const alphabet = bfs.BFS_ALPHABET;
    for (let i = 0; i < count; i++) {
      const scenario = randomScenario(rand, 2000 + i, 2, 0);
      const sha = sha256Hex(bfs.canonicalBfsJson(scenario));
      const result = bfs.searchBfs(scenario, sha);
      // Brute force: shortest firing length over sequences of length
      // 0..2 (initial state = length 0), in alphabet order.
      const initial = geometryEval.evaluateGeometry(scenario, sha).initialState;
      const fireAt = (state) => {
        const computed = geometry.computeMetrics(scenario.layout, state);
        if (computed.status !== "OK" || computed.metrics === null) return false;
        return (
          geometry.evaluatePredicates(
            computed.metrics,
            scenario.failure_predicates,
          ).length > 0
        );
      };
      let bruteShortest = null;
      if (fireAt(initial)) {
        bruteShortest = 0;
      } else {
        outer: for (let len = 1; len <= 2; len++) {
          const seqs = [[]];
          for (let d = 0; d < len; d++) {
            const next = [];
            for (const s of seqs) {
              for (const t of alphabet) next.push([...s, t]);
            }
            seqs.splice(0, seqs.length, ...next);
          }
          for (const seq of seqs) {
            let state = initial;
            let fired = false;
            let unknown = false;
            for (let d = 0; d < seq.length; d++) {
              const event = bfs.buildBfsEvent(seq[d], d + 1, 100 * (d + 1));
              const transition = events.evaluateEventTransition(
                state, event, scenario.mode, scenario.profile,
              );
              if (transition.status === "UNKNOWN") { unknown = true; break; }
              state = transition.state;
              if (fireAt(state)) { fired = true; break; }
            }
            if (!unknown && fired) { bruteShortest = len; break outer; }
          }
        }
      }
      const gotLength = result.witnessLength;
      let ok = gotLength === bruteShortest;
      if (ok && result.status === "FAIL" && result.witness !== null && result.witness.length > 0) {
        // The witness itself must replay to a firing step.
        const replayScenario = {
          ...scenario,
          events: result.witness.map((step) => {
            const event = { type: step.eventType, id: step.eventId, atMs: step.atMs };
            for (const [k, v] of Object.entries(step.params ?? {})) event[k] = v;
            return event;
          }),
        };
        const replayed = geometryEval.evaluateGeometry(
          replayScenario,
          sha256Hex(bfs.canonicalBfsJson(replayScenario)),
        );
        ok =
          replayed.status === "OK" &&
          deepEqual(replayed.finalFailedPredicates ?? [], result.failedPredicates ?? []);
      }
      if (ok && result.status === "BOUNDED_NO_WITNESS") {
        ok = bruteShortest === null && result.limitReached === "depth";
      }
      check(
        `prop-bfs-shortest #${i} (bfs=${gotLength} brute=${bruteShortest})`,
        ok,
        `scenario=${scenario.scenario_id} mode=${scenario.mode} template=${scenario.layout.template}`,
      );
      record("prop-bfs-shortest", ok);
    }
  }

  // ---- fail-closed. ----
  {
    const count = byId["prop-fail-closed"].sample_count;
    const faults = ["mode", "scale", "clock", "keyboard"];
    for (let i = 0; i < count; i++) {
      const base = randomScenario(rand, 3000 + i, 3, 2);
      const fault = faults[i % faults.length];
      if (fault === "mode") base.mode = "pinch-zoom";
      if (fault === "scale") base.profile = { scale: 2 };
      if (fault === "clock") {
        base.events = [
          { type: "KEYBOARD_OPEN", id: "r1", atMs: 200, keyboardHeight: 300000 },
          { type: "KEYBOARD_CLOSE", id: "r2", atMs: 100 },
        ];
      }
      if (fault === "keyboard") {
        base.events = [
          { type: "KEYBOARD_OPEN", id: "r1", atMs: 100, keyboardHeight: 900000 },
        ];
      }
      const sha = sha256Hex(bfs.canonicalBfsJson(base));
      const geo = geometryEval.evaluateGeometry(base, sha);
      const found = bfs.searchBfs(base, sha);
      const ok =
        (geo.status === "UNKNOWN" || geo.status === "INVALID") &&
        (found.status === "UNKNOWN" || found.status === "INVALID") &&
        geo.reason !== null && found.reason !== null &&
        found.witness === null;
      check(`prop-fail-closed #${i} (${fault})`, ok,
        `geo=${geo.status} bfs=${found.status}`);
      record("prop-fail-closed", ok);
    }
  }

  // ---- pan-clamp. ----
  {
    const count = byId["prop-pan-clamp"].sample_count;
    for (let i = 0; i < count; i++) {
      const scenario = randomScenario(rand, 4000 + i);
      const sha = sha256Hex(bfs.canonicalBfsJson(scenario));
      const result = geometryEval.evaluateGeometry(scenario, sha);
      let ok = true;
      let prev = result.initialState;
      for (const step of result.steps) {
        if (step.status !== "OK") break;
        if (step.state.visualOffsetLeft !== 0) ok = false;
        if (step.state.visualOffsetTop < 0) ok = false;
        if (step.eventType === "DELAYED_VISUAL_PAN" && prev !== null) {
          const maxTop = Math.max(0, prev.layoutHeight - prev.visualHeight);
          if (step.state.visualOffsetTop > maxTop) ok = false;
        }
        prev = step.state;
      }
      check(`prop-pan-clamp #${i}`, ok);
      record("prop-pan-clamp", ok);
    }
  }

  // ---- oracle-parity-random. ----
  {
    const count = byId["prop-oracle-parity-random"].sample_count;
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "viewportshift-prop-"));
    try {
      const fixtures = [];
      const files = [];
      for (let i = 0; i < count; i++) {
        const scenario = randomScenario(rand, 5000 + i);
        fixtures.push(scenario);
        const file = path.join(tmpDir, `prop-${String(i).padStart(2, "0")}.json`);
        fs.writeFileSync(file, `${JSON.stringify(scenario, null, 2)}\n`, "utf8");
        files.push(file);
      }
      const tsResults = fixtures.map((fixture) =>
        geometryEval.evaluateGeometry(
          fixture,
          sha256Hex(bfs.canonicalBfsJson(fixture)),
        ),
      );
      const pyOut = path.join(tmpDir, "PY.json");
      const run = runPythonGeometryOracle(files, pyOut, 1);
      check("prop-oracle-parity-random: python oracle exits 0", run.code === 0,
        `exit=${run.code} stderr=${run.stderr}`);
      check("prop-oracle-parity-random: python output parses",
        run.output !== null, "no output JSON");
      if (run.output !== null) {
        const pyResults = run.output.results ?? [];
        check("prop-oracle-parity-random: python returned all results",
          pyResults.length === count, `got ${pyResults.length}`);
        for (let i = 0; i < Math.min(count, pyResults.length); i++) {
          const diffs = diffPaths(tsResults[i], pyResults[i], `prop-random-${i}`);
          const ok = diffs.length === 0;
          check(`prop-oracle-parity-random #${i}`, ok, diffs.slice(0, 3).join("; "));
          record("prop-oracle-parity-random", ok);
        }
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  writeJson(path.join(ROOT, OUT_REL), {
    seed: SEED,
    version: "t011-properties/v1",
    perProperty,
    checksPassed: passes.length,
    checksFailed: failures.length,
    analysisSha256: sha256Hex(bfs.canonicalBfsJson(perProperty)),
  });
  console.log(`checks passed: ${passes.length}, checks failed: ${failures.length}`);
  if (failures.length > 0) {
    for (const failure of failures) console.log(`FAIL: ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log("Property (TS): PASS");
}

await main();
