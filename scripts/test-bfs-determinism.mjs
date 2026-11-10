#!/usr/bin/env node
/**
 * T008 determinism runner: `npm run test:bfs:determinism`.
 *
 * Determinism contract (IMPLEMENTATION_PLAN §6.2–§6.3): the fixed seed
 * `P021-VIEWPORTSHIFT-S0-2026-11-10`, normalised JSON (sorted keys,
 * fixed array order), no wall-clock time, no random UUIDs, no machine
 * absolute paths in canonical results. Fixed input repeated must
 * yield exactly 1 SHA-256.
 *
 * - Full-run determinism: `node scripts/test-bfs.mjs` is run twice as
 *   separate processes; the analysisSha256 written to
 *   evidence/bfs/BFS_TS.json must be identical both times.
 * - Repeat determinism: the dedup fixture is re-read from disk and
 *   searched 100 times in-process; all 100 canonical hashes must be
 *   identical.
 *
 * Writes evidence/bfs/BFS_DETERMINISM.json. Exits 0 only when both
 * checks pass.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  BFS_VERSION,
  ROOT,
  SEED,
  evaluateTsBfs,
  listBfsFixtures,
  loadJson,
  loadT008Domain,
  sha256Hex,
  writeJson,
} from "./t008-lib.mjs";

const RUNS = 100;
const OUT_REL = "evidence/bfs/BFS_DETERMINISM.json";
const BFS_TS_REL = "evidence/bfs/BFS_TS.json";

const failures = [];
const passes = [];

function check(name, ok, detail) {
  if (ok) passes.push(name);
  else failures.push(detail ? `${name} — ${detail}` : name);
  return ok;
}

async function main() {
  // 1. Two separate full runs of the acceptance runner.
  const hashes = [];
  for (let run = 0; run < 2; run++) {
    const proc = spawnSync("node", ["scripts/test-bfs.mjs"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    if (proc.status !== 0) {
      check(`test:bfs subprocess run ${run + 1} exits 0`, false, `exit=${proc.status}\n${proc.stdout}\n${proc.stderr}`);
      break;
    }
    const written = JSON.parse(fs.readFileSync(path.join(ROOT, BFS_TS_REL), "utf8"));
    hashes.push(written.analysisSha256);
  }
  if (hashes.length === 2) {
    check("two separate test:bfs runs yield 1 unique hash", hashes[0] === hashes[1], `run1=${hashes[0]} run2=${hashes[1]}`);
    console.log(`full runs: 2 uniqueHashes=${new Set(hashes).size} hash=${hashes[0]}`);
  }

  // 2. 100 in-process repeats of one fixture search.
  const { bfs } = await loadT008Domain();
  const dedupFile = listBfsFixtures().find((f) => f.endsWith("bfs-dedup-rv-sheet.json"));
  check("dedup fixture present", dedupFile !== undefined, "bfs-dedup-rv-sheet.json missing");
  const repeatHashes = new Set();
  let lastCore = null;
  if (dedupFile !== undefined) {
    for (let i = 0; i < RUNS; i++) {
      const fixture = loadJson(dedupFile);
      const { core, analysisSha256 } = evaluateTsBfs(bfs, [fixture]);
      repeatHashes.add(analysisSha256);
      lastCore = core;
    }
    check(
      `dedup fixture: ${RUNS} runs yield 1 unique hash`,
      repeatHashes.size === 1,
      `unique=${repeatHashes.size}: ${[...repeatHashes].join(", ")}`,
    );
    check(
      "canonical output contains no absolute workspace path",
      lastCore !== null && !bfs.canonicalBfsJson(lastCore).includes(ROOT),
      "absolute path leaked into canonical result",
    );
    console.log(`repeat runs: ${RUNS} uniqueHashes=${repeatHashes.size} hash=${[...repeatHashes][0]}`);
  }

  const out = {
    fullRuns: { runs: 2, uniqueHashes: new Set(hashes).size, hashes },
    repeatRuns: { runs: RUNS, uniqueHashes: repeatHashes.size, hashes: [...repeatHashes] },
    seed: SEED,
    version: BFS_VERSION,
  };
  writeJson(path.join(ROOT, OUT_REL), out);
  console.log(`wrote ${OUT_REL}`);
  console.log(`\nchecks passed: ${passes.length}, checks failed: ${failures.length}`);
  if (failures.length > 0) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(`- ${f}`);
    console.log("\nBFS determinism: FAIL");
    process.exitCode = 1;
  } else {
    console.log("\nBFS determinism: PASS");
    process.exitCode = 0;
  }
}

main().catch((err) => {
  console.error(`runner error: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
