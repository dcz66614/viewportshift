#!/usr/bin/env node
/**
 * T011 acceptance runner: `npm run test:golden`.
 *
 * Runs the TypeScript geometry evaluator and bounded BFS over the 24
 * hand-authored Golden fixtures (`tests/fixtures/golden/`: three
 * modes x four templates with a single KEYBOARD_OPEN, delayed-pan /
 * pan-close / scroll / zero- and full-height keyboard boundaries,
 * and four fail-closed cases) and asserts every hand-written
 * expectation: geometry status / reason / final metrics /
 * final failed predicates / step count, BFS status / reason /
 * witness (type, id, atMs, parameters) / failed predicates /
 * limitReached / first failing step / preserved limits, plus a
 * runner-side independent re-derivation of the final step's metrics
 * from its rects. Also replays each BFS witness through the geometry
 * evaluator and checks the replay reproduces the witness's final
 * metrics and failed predicates.
 *
 * Writes evidence/coverage/GOLDEN_TEST.json (counts + hash).
 * Exits 0 only when every check passes.
 */
import path from "node:path";
import {
  BFS_VERSION,
  ROOT,
  SEED,
  checkGoldenFixture,
  deepEqual,
  listGoldenFixtures,
  loadJson,
  loadT011Domain,
  sha256Hex,
  witnessEventOf,
  writeJson,
} from "./t011-lib.mjs";

const OUT_REL = "evidence/coverage/GOLDEN_TEST.json";

const failures = [];
const passes = [];

function check(name, ok, detail) {
  if (ok) passes.push(name);
  else failures.push(detail ? `${name} — ${detail}` : name);
  return ok;
}

async function main() {
  const { geometryEval, bfs } = await loadT011Domain();
  const files = listGoldenFixtures();
  check("exactly 24 golden fixtures present", files.length === 24,
    `found ${files.length}`);
  const fixtures = files.map(loadJson);
  for (const fixture of fixtures) {
    check(
      `${fixture.scenario_id}: frozen seed`,
      fixture.seed === SEED,
      `seed=${fixture.seed}`,
    );
    check(
      `${fixture.scenario_id}: expected blocks present`,
      fixture.expected !== undefined &&
        fixture.expected.geometry !== undefined &&
        fixture.expected.bfs !== undefined,
      "missing expected.geometry / expected.bfs",
    );
  }

  const results = [];
  for (const fixture of fixtures) {
    const scenarioSha256 = sha256Hex(bfs.canonicalBfsJson(fixture));
    const geometryResult = geometryEval.evaluateGeometry(
      fixture,
      scenarioSha256,
    );
    const bfsResult = bfs.searchBfs(fixture, scenarioSha256);
    results.push({ fixture, geometryResult, bfsResult });
    const before = failures.length;
    const fixtureFailures = checkGoldenFixture(
      fixture,
      geometryResult,
      bfsResult,
    );
    for (const failure of fixtureFailures) failures.push(failure);
    if (failures.length === before) {
      passes.push(`${fixture.scenario_id}: golden expectations hold`);
    }
    // Witness replay: the witness events replayed through the
    // geometry evaluator must reproduce the witness's final metrics
    // and failed predicates (prefix steps included).
    if (bfsResult.status === "FAIL" && bfsResult.witness !== null) {
      const witnessEvents = bfsResult.witness.map((step) => {
        const event = { type: step.eventType, id: step.eventId, atMs: step.atMs };
        for (const [k, v] of Object.entries(step.params ?? {})) event[k] = v;
        return event;
      });
      const replayScenario = { ...fixture, events: witnessEvents };
      const replayed = geometryEval.evaluateGeometry(
        replayScenario,
        sha256Hex(bfs.canonicalBfsJson(replayScenario)),
      );
      const lastStep = bfsResult.witness[bfsResult.witness.length - 1];
      check(
        `${fixture.scenario_id}: witness replays to the same final metrics`,
        replayed.status === "OK" &&
          replayed.finalMetrics !== null &&
          deepEqual(replayed.finalMetrics, lastStep.metrics),
        `replay status=${replayed.status} metrics=${JSON.stringify(replayed.finalMetrics)}`,
      );
      check(
        `${fixture.scenario_id}: witness replays to the same failed predicates`,
        deepEqual(
          replayed.finalFailedPredicates ?? [],
          bfsResult.failedPredicates ?? [],
        ),
        `replay fired=${JSON.stringify(replayed.finalFailedPredicates)}`,
      );
    }
  }

  // Coverage summary: every supported semantic has positive, negative
  // and boundary samples; unsupported inputs never fake-PASS.
  const byMode = {};
  for (const { fixture, geometryResult } of results) {
    const key = fixture.mode;
    byMode[key] = byMode[key] ?? { total: 0, ok: 0, unknown: 0, invalid: 0 };
    byMode[key].total += 1;
    if (geometryResult.status === "OK") byMode[key].ok += 1;
    if (geometryResult.status === "UNKNOWN") byMode[key].unknown += 1;
    if (geometryResult.status === "INVALID") byMode[key].invalid += 1;
  }
  for (const mode of ["resizes-visual", "resizes-content", "overlays-content"]) {
    check(
      `coverage: ${mode} has golden samples`,
      (byMode[mode]?.total ?? 0) >= 4,
      `found ${byMode[mode]?.total ?? 0}`,
    );
  }
  const failClosed = results.filter(
    (r) => r.geometryResult.status === "UNKNOWN" || r.geometryResult.status === "INVALID",
  );
  check(
    "coverage: fail-closed goldens never PASS/FAIL",
    failClosed.length === 4 &&
      failClosed.every(
        (r) => r.bfsResult.status === r.geometryResult.status,
      ),
    `fail-closed=${failClosed.length}`,
  );
  const core = {
    results: results.map(({ fixture, geometryResult, bfsResult }) => ({
      scenarioId: fixture.scenario_id,
      geometry: {
        status: geometryResult.status,
        reason: geometryResult.reason,
        finalMetrics: geometryResult.finalMetrics,
        finalFailedPredicates: geometryResult.finalFailedPredicates,
      },
      bfs: {
        status: bfsResult.status,
        reason: bfsResult.reason,
        witnessLength: bfsResult.witnessLength,
        failedPredicates: bfsResult.failedPredicates,
        limitReached: bfsResult.limitReached,
        limits: bfsResult.limits,
        limitsFallbackReason: bfsResult.limitsFallbackReason ?? null,
      },
    })),
    seed: SEED,
    version: BFS_VERSION,
  };
  const analysisSha256 = sha256Hex(bfs.canonicalBfsJson(core));
  writeJson(path.join(ROOT, OUT_REL), {
    ...core,
    analysisSha256,
    checksPassed: passes.length,
    checksFailed: failures.length,
  });

  console.log(`golden fixtures: ${fixtures.length}`);
  console.log(`checks passed: ${passes.length}, checks failed: ${failures.length}`);
  if (failures.length > 0) {
    for (const failure of failures) console.log(`FAIL: ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log("Golden (TS): PASS");
}

await main();
