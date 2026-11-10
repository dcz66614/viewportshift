#!/usr/bin/env node
/**
 * T011 acceptance runner: `npm run test:mutation`.
 *
 * Mutation testing for the domain logic. For each mutation fixture
 * in `tests/fixtures/mutations/` (a small, realistic change to one
 * domain source file: a flipped comparison, a pairwise instead of
 * triple intersection, a swapped alphabet order, a naive dedup key,
 * a dropped deduction, a clamped pan, an off-by-one depth bound):
 *
 * 1. The `find` string must occur exactly once in the target source
 *    (otherwise the mutation is ambiguous and the run fails).
 * 2. The mutation is applied to a TEMPORARY COPY of the domain
 *    sources only (see `loadT011Domain(overrides)`); the real sources
 *    on disk are never touched — verified at the end by re-reading
 *    every target file and asserting it is byte-identical to before.
 * 3. The full Golden set (24) plus the full BFS set (11 T008 + 4
 *    T011 branch fixtures) is checked against the mutated domain
 *    with the same checkers as the baseline.
 * 4. The mutant is DETECTED exactly when at least one check fails
 *    and at least one of the fixture ids named in `detected_by`
 *    fails. A mutant no fixture detects is a SURVIVOR and fails the
 *    run.
 *
 * A baseline run (unmutated domain) first proves the checks
 * themselves pass; a baseline failure aborts the run, because
 * mutation results would be meaningless.
 *
 * Writes evidence/coverage/MUTATION_TEST.json (per-mutant verdicts).
 * Exits 0 only when every mutant is detected.
 */
import fs from "node:fs";
import path from "node:path";
import {
  BFS_VERSION,
  ROOT,
  SEED,
  checkBfsExpected,
  checkGoldenFixture,
  listAllBfsFixtures,
  listGoldenFixtures,
  listMutationFixtures,
  loadJson,
  loadT011Domain,
  sha256Hex,
  writeJson,
} from "./t011-lib.mjs";

const OUT_REL = "evidence/coverage/MUTATION_TEST.json";

const failures = [];
const passes = [];

function check(name, ok, detail) {
  if (ok) passes.push(name);
  else failures.push(detail ? `${name} — ${detail}` : name);
  return ok;
}

/** Run the golden + BFS checks against a loaded domain; return failing fixture ids. */
function runChecks(domain, goldenFixtures, bfsFixtures) {
  const { geometryEval, bfs } = domain;
  const failing = [];
  for (const fixture of goldenFixtures) {
    const sha = sha256Hex(bfs.canonicalBfsJson(fixture));
    const geo = geometryEval.evaluateGeometry(fixture, sha);
    const found = bfs.searchBfs(fixture, sha);
    const fixtureFailures = checkGoldenFixture(fixture, geo, found);
    if (fixtureFailures.length > 0) failing.push(fixture.scenario_id);
  }
  for (const fixture of bfsFixtures) {
    const sha = sha256Hex(bfs.canonicalBfsJson(fixture));
    const found = bfs.searchBfs(fixture, sha);
    const local = [];
    checkBfsExpected(fixture.scenario_id, found, fixture.expected, fixture, local);
    if (local.length > 0) failing.push(fixture.scenario_id);
  }
  return failing;
}

async function main() {
  const mutationFiles = listMutationFixtures();
  check("exactly 8 mutation fixtures present", mutationFiles.length === 8,
    `found ${mutationFiles.length}`);
  const mutations = mutationFiles.map(loadJson);
  for (const mutation of mutations) {
    check(
      `${mutation.mutation_id}: detected_by is non-empty`,
      Array.isArray(mutation.detected_by) && mutation.detected_by.length > 0,
      "empty detected_by",
    );
  }
  const goldenFixtures = listGoldenFixtures().map(loadJson);
  const bfsFixtures = listAllBfsFixtures().map(loadJson);
  check("golden fixtures present", goldenFixtures.length === 24,
    `found ${goldenFixtures.length}`);
  check("BFS fixtures present (11 T008 + 4 branch)", bfsFixtures.length === 15,
    `found ${bfsFixtures.length}`);

  // Snapshot every target file before mutating (byte-identity proof).
  const targetFiles = [...new Set(mutations.map((m) => m.target_file))];
  const before = {};
  for (const rel of targetFiles) {
    before[rel] = fs.readFileSync(path.join(ROOT, rel), "utf8");
  }

  // Baseline: the checks must pass on the unmutated domain.
  const baselineDomain = await loadT011Domain();
  const baselineFailing = runChecks(baselineDomain, goldenFixtures, bfsFixtures);
  check("baseline: all golden + BFS checks pass unmutated",
    baselineFailing.length === 0,
    `failing: ${baselineFailing.join(", ")}`);
  if (baselineFailing.length > 0) {
    console.log(`checks passed: ${passes.length}, checks failed: ${failures.length}`);
    for (const failure of failures) console.log(`FAIL: ${failure}`);
    process.exitCode = 1;
    return;
  }

  const verdicts = [];
  for (const mutation of mutations) {
    const target = mutation.target_file;
    const source = before[target];
    const occurrences = source.split(mutation.find).length - 1;
    if (occurrences !== 1) {
      failures.push(
        `${mutation.mutation_id}: find string occurs ${occurrences} times in ${target}, expected exactly 1`,
      );
      verdicts.push({ ...mutation, detected: false, failingFixtures: [], error: `find occurs ${occurrences}x` });
      continue;
    }
    const mutatedSource = source.replace(mutation.find, mutation.replace);
    if (mutatedSource === source) {
      failures.push(`${mutation.mutation_id}: replacement did not change the source`);
      verdicts.push({ ...mutation, detected: false, failingFixtures: [], error: "no-op replacement" });
      continue;
    }
    const domain = await loadT011Domain({ [target]: mutatedSource });
    const failing = runChecks(domain, goldenFixtures, bfsFixtures);
    const detectedByHit = mutation.detected_by.filter((id) => failing.includes(id));
    const detected = failing.length > 0 && detectedByHit.length > 0;
    check(
      `${mutation.mutation_id}: detected by ${mutation.detected_by.join(", ")}`,
      detected,
      `failing fixtures: ${failing.length > 0 ? failing.join(", ") : "(none — survivor)"}`,
    );
    if (detected) passes.push(`${mutation.mutation_id}: killed by ${detectedByHit.join(", ")}`);
    verdicts.push({
      mutation_id: mutation.mutation_id,
      description: mutation.description,
      target_file: target,
      detected,
      failingFixtures: failing,
      detectedByHit,
    });
  }

  // The real sources must be byte-identical to before the run.
  for (const rel of targetFiles) {
    const after = fs.readFileSync(path.join(ROOT, rel), "utf8");
    check(`sources untouched: ${rel}`, after === before[rel], "file changed during mutation run");
  }

  writeJson(path.join(ROOT, OUT_REL), {
    seed: SEED,
    version: BFS_VERSION,
    verdicts,
    checksPassed: passes.length,
    checksFailed: failures.length,
    analysisSha256: sha256Hex(JSON.stringify(verdicts)),
  });
  console.log(`checks passed: ${passes.length}, checks failed: ${failures.length}`);
  if (failures.length > 0) {
    for (const failure of failures) console.log(`FAIL: ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log("Mutation (TS): PASS — all 8 mutants detected");
}

await main();
