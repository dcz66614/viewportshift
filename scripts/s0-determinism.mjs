#!/usr/bin/env node
/**
 * T003 acceptance runner: `npm run s0:determinism`.
 *
 * Determinism contract (IMPLEMENTATION_PLAN §6.2–§6.3): the fixed seed
 * `P021-VIEWPORTSHIFT-S0-2026-11-10`, normalised JSON (sorted keys, fixed
 * array order), no wall-clock time, no random UUIDs, no machine absolute
 * paths in canonical results. 100 runs must yield exactly 1 SHA-256.
 *
 * - TypeScript side: 100 runs, fixtures re-read from disk every run,
 *   analysis re-executed every run; all 100 canonical hashes collected.
 * - Python side: the Oracle CLI with --repeat 100 (it re-reads the
 *   fixtures and re-analyses on every run); its hash must equal the
 *   TypeScript hash.
 *
 * Writes evidence/s0/S0_DETERMINISM.json and
 * evidence/s0/S0_DETERMINISM_PY.json (the Oracle's 100-run output).
 * Exits 0 only when both sides produce exactly 1 hash and the hashes
 * agree.
 */
import path from "node:path";
import {
  ROOT,
  SEED,
  analyzeTs,
  listFixtures,
  loadDomain,
  loadFixture,
  runPythonOracle,
  writeJson,
} from "./s0-lib.mjs";

const RUNS = 100;
const OUT_REL = "evidence/s0/S0_DETERMINISM.json";
const PY_OUT_REL = "evidence/s0/S0_DETERMINISM_PY.json";

const failures = [];
const passes = [];

function check(name, ok, detail) {
  if (ok) passes.push(name);
  else failures.push(detail ? `${name} — ${detail}` : name);
  return ok;
}

async function main() {
  const { main } = listFixtures();
  check("exactly 48 main S0 fixtures present", main.length === 48,
    `found ${main.length}`);
  const { geometry } = await loadDomain();

  const tsHashes = new Set();
  let lastCore = null;
  for (let i = 0; i < RUNS; i++) {
    const fixtures = main.map(loadFixture);
    const { core, analysisSha256 } = analyzeTs(geometry, fixtures);
    tsHashes.add(analysisSha256);
    lastCore = core;
  }
  const tsHash = [...tsHashes][0];
  check(`TypeScript: ${RUNS} runs yield 1 unique hash`, tsHashes.size === 1,
    `unique=${tsHashes.size}: ${[...tsHashes].join(", ")}`);
  check(
    "TypeScript canonical output contains no absolute workspace path",
    !geometry.canonicalJson(lastCore).includes(ROOT),
    "absolute path leaked into canonical result",
  );
  console.log(`typescript: runs=${RUNS} uniqueHashes=${tsHashes.size} hash=${tsHash}`);

  const pyOutPath = path.join(ROOT, PY_OUT_REL);
  const run = runPythonOracle(main, pyOutPath, RUNS);
  console.log(run.stdout);
  if (run.stderr) console.log(run.stderr);
  check("python oracle --repeat 100 exits 0", run.code === 0,
    `exit=${run.code} stderr=${run.stderr}`);
  const pyHashes = run.output?.determinism?.hashes ?? [];
  check(`Python: ${RUNS} runs yield 1 unique hash`, pyHashes.length === 1,
    `unique=${pyHashes.length}: ${pyHashes.join(", ")}`);
  const pyHash = pyHashes[0];
  check("TypeScript and Python determinism hashes agree", tsHash === pyHash,
    `ts=${tsHash} py=${pyHash}`);
  console.log(`python: runs=${RUNS} uniqueHashes=${pyHashes.length} hash=${pyHash}`);

  const out = {
    analysisSha256: tsHash,
    determinism: {
      runs: RUNS,
      tsUniqueHashes: tsHashes.size,
      pyUniqueHashes: pyHashes.length,
      tsHashes: [...tsHashes].sort(),
      pyHashes: [...pyHashes].sort(),
    },
    seed: SEED,
    version: "s0-geometry/v1",
  };
  writeJson(path.join(ROOT, OUT_REL), out);
  console.log(`\nwrote ${OUT_REL}`);
  console.log(`wrote ${PY_OUT_REL}`);
  console.log(
    `\nchecks passed: ${passes.length}, checks failed: ${failures.length}`,
  );
  if (failures.length > 0) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(`- ${f}`);
    console.log("\nS0 determinism: FAIL");
    process.exitCode = 1;
  } else {
    console.log("\nS0 determinism: PASS");
    process.exitCode = 0;
  }
}

main().catch((err) => {
  console.error(`runner error: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
