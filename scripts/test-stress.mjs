#!/usr/bin/env node
/**
 * T012 acceptance runner: `npm run test:stress`.
 *
 * Pressure / determinism suite (all real work, no stubs):
 *  1. Two clean rebuilds (`rm -rf dist && npm run build`, twice):
 *     every dist file's SHA-256 must be identical across builds.
 *  2. Five demo runs: resultSha256 / reportSha256 / witnessLength
 *     must equal the frozen values every time.
 *  3. 100x replay hash stability re-check (S0 determinism contract):
 *     the default UI scenario is replayed 100 times through the
 *     frozen domain; exactly 1 canonical hash must result.
 *  4. Three preview page loads: the on-screen scenario SHA-256 must
 *     be identical every time.
 *
 * Exits 0 only when every check passes. Writes
 * evidence/performance/STRESS_TEST.json.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  CdpBrowser,
  FROZEN_DEMO_REPORT_SHA256,
  FROZEN_DEMO_RESULT_SHA256,
  ROOT,
  SEED,
  findChrome,
  loadUiDomain,
  makeHarness,
  sha256File,
  sha256Hex,
  sleep,
  startPreview,
} from "./e2e-lib.mjs";

const PREVIEW_PORT = 4177;
const CDP_PORT = 9337;
const EVIDENCE_DIR = path.join(ROOT, "evidence", "performance");

const h = makeHarness("test:stress");
const { check } = h;

function runCommand(cmd, args, cwd = ROOT) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => { out += d; });
    p.stderr.on("data", (d) => { err += d; });
    p.on("error", reject);
    p.on("close", (code) => resolve({ code, out, err }));
  });
}

function distManifest() {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else files.push(p);
    }
  };
  walk(path.join(ROOT, "dist"));
  files.sort();
  return files.map((f) => ({
    file: path.relative(path.join(ROOT, "dist"), f),
    size: fs.statSync(f).size,
    sha256: sha256File(f),
  }));
}

async function main() {
  // ---- 1. two clean rebuilds, byte-identical dist ----
  const builds = [];
  for (let i = 1; i <= 2; i++) {
    fs.rmSync(path.join(ROOT, "dist"), { recursive: true, force: true });
    const build = await runCommand("npm", ["run", "build"]);
    check(`clean rebuild ${i} exits 0`, build.code === 0, build.err.slice(-300));
    if (build.code !== 0) {
      process.exitCode = 1;
      return;
    }
    builds.push(distManifest());
    console.log(`test:stress: rebuild ${i}: ${builds[i - 1].length} dist files`);
  }
  const manifestA = JSON.stringify(builds[0]);
  const manifestB = JSON.stringify(builds[1]);
  check("two clean rebuilds produce identical dist file hashes", manifestA === manifestB,
    builds[0].map((f, i) => (f.sha256 !== builds[1][i].sha256 ? `${f.file}: ${f.sha256.slice(0, 12)} vs ${builds[1][i].sha256.slice(0, 12)}` : null)).filter(Boolean).join("; "));
  check("dist manifest is non-empty and includes the CLI bundle",
    builds[0].some((f) => f.file === "viewportshift.mjs") && builds[0].some((f) => f.file === "index.html"));

  // ---- 2. five demo runs, frozen hashes every time ----
  const demoHashes = [];
  for (let i = 0; i < 5; i++) {
    const demo = await runCommand("node", ["dist/viewportshift.mjs", "demo"]);
    const result = demo.out.match(/resultSha256=([0-9a-f]+)/)?.[1] ?? null;
    const report = demo.out.match(/reportSha256=([0-9a-f]+)/)?.[1] ?? null;
    const witness = demo.out.match(/witnessLength=(\d+)/)?.[1] ?? null;
    demoHashes.push({ result, report, witness });
    check(`demo run ${i + 1} exits 0 with frozen hashes + witnessLength 1`,
      demo.code === 0 && result === FROZEN_DEMO_RESULT_SHA256 && report === FROZEN_DEMO_REPORT_SHA256 && witness === "1",
      `result=${result} report=${report} witness=${witness}`);
  }
  check("all 5 demo runs produce identical hashes",
    new Set(demoHashes.map((d) => `${d.result}/${d.report}`)).size === 1);

  // ---- 3. 100x replay hash stability (in-process, frozen domain) ----
  const { scenario } = await loadUiDomain();
  const defaultScenario = scenario.buildScenario(scenario.DEFAULT_UI_PARAMS);
  const defaultSha = sha256Hex(scenario.canonicalScenarioJson(defaultScenario));
  const replayHashes = new Set();
  for (let i = 0; i < 100; i++) {
    const ev = scenario.replayScenario(defaultScenario, defaultSha);
    replayHashes.add(sha256Hex(scenario.canonicalScenarioJson(ev)));
  }
  check("100 replay runs yield exactly 1 canonical hash", replayHashes.size === 1, `unique=${replayHashes.size}`);
  const bfsHashes = new Set();
  for (let i = 0; i < 10; i++) {
    bfsHashes.add(sha256Hex(scenario.canonicalWitnessJson(scenario.runBfs(defaultScenario, defaultSha))));
  }
  check("10 BFS runs yield exactly 1 canonical witness hash", bfsHashes.size === 1, `unique=${bfsHashes.size}`);

  // ---- 4. three preview loads, identical on-screen scenario hash ----
  const chromeBin = findChrome();
  check("a real Chromium binary is available for CDP", chromeBin !== null);
  const screenHashes = [];
  if (chromeBin !== null) {
    const preview = await startPreview(PREVIEW_PORT);
    const browser = new CdpBrowser();
    try {
      await browser.launch(CDP_PORT, chromeBin);
      const base = `${preview.base}?template=chat-input&mode=resizes-visual&sequence=open`;
      for (let i = 0; i < 3; i++) {
        await browser.navigate(base);
        await browser.waitFor(
          `document.querySelector('[data-testid="scenario-id"]')?.textContent === 'UI-chat-input-resizes-visual'`,
          20000,
        );
        const hashText = await browser.evaluate(`[...document.querySelectorAll('.status-bar strong')].map(s => s.textContent).find(t => /^[0-9a-f]{64}$/.test(t)) ?? ''`);
        screenHashes.push(hashText);
      }
      check("3 preview loads show the same on-screen scenario hash",
        screenHashes.length === 3 && new Set(screenHashes).size === 1 && screenHashes[0].length === 64,
        JSON.stringify(screenHashes));
      check("on-screen scenario hash equals the Node-computed default hash",
        screenHashes[0] === defaultSha, `screen=${screenHashes[0]} node=${defaultSha}`);
    } finally {
      await browser.close();
      await preview.stop();
    }
  }

  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(path.join(EVIDENCE_DIR, "STRESS_TEST.json"),
    `${JSON.stringify({
      suite: "test:stress",
      seed: SEED,
      assertions: h.passed + h.failed,
      passed: h.passed,
      failed: h.failed,
      failures: h.failures,
      cleanRebuilds: { builds: 2, distFiles: builds[0].length, identical: manifestA === manifestB, manifest: builds[0] },
      demoRuns: { runs: 5, hashes: demoHashes, frozenResultSha256: FROZEN_DEMO_RESULT_SHA256, frozenReportSha256: FROZEN_DEMO_REPORT_SHA256 },
      replayHashStability: { runs: 100, uniqueHashes: replayHashes.size, hash: [...replayHashes][0] ?? null },
      bfsHashStability: { runs: 10, uniqueHashes: bfsHashes.size },
      previewLoads: { loads: 3, scenarioHashes: screenHashes },
      windowsTested: "NOT_TESTED",
    }, null, 2)}\n`,
    "utf8");

  if (!h.summary()) {
    process.exitCode = 1;
  } else {
    console.log("test:stress: PASS — rebuilds identical, demo stable x5, replay stable x100");
  }
}

main().catch((err) => {
  console.error(`test:stress: ERROR — ${err.message}`);
  process.exitCode = 1;
});
