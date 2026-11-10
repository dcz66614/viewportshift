#!/usr/bin/env node
/**
 * T012 acceptance runner: `npm run release:verify`.
 *
 * Release REHEARSAL verification (not the T014 formal freeze — no
 * files are written under release/, and the rehearsal manifest is
 * explicitly marked as such):
 *  1. Two clean builds; every dist file's SHA-256 must match.
 *  2. dist manifest completeness: index.html, the CLI bundle
 *     viewportshift.mjs, and at least one JS + one CSS asset must
 *     exist; the full file list (with sizes + hashes) is recorded.
 *  3. Demo output hashes are re-computed: two demo runs must print
 *     the frozen resultSha256 / reportSha256 with witnessLength 1,
 *     and demo-output/DEMO_MANIFEST.json must agree with stdout.
 *  4. dist/index.html must contain no external resource references.
 *
 * Exits 0 only when every check passes. Writes
 * evidence/release-rehearsal/RELEASE_REHEARSAL.json,
 * RELEASE_MANIFEST.json and SHA256SUMS.txt (rehearsal artefacts).
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  FROZEN_DEMO_REPORT_SHA256,
  FROZEN_DEMO_RESULT_SHA256,
  ROOT,
  SEED,
  makeHarness,
  sha256File,
} from "./e2e-lib.mjs";

const EVIDENCE_DIR = path.join(ROOT, "evidence", "release-rehearsal");

const h = makeHarness("release:verify");
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
  // T014修正（协调员选A）：正式冻结创建 release/ 后，旧断言“release/ 不存在”
  // 按设计必然失败。改为行为断言：预演开始前快照 release/ 是否存在，
  // 结束时断言其存在性未变——预演既不创建也不删除 release/。
  const releaseExistedBefore = fs.existsSync(path.join(ROOT, "release"));
  const manifests = [];
  for (let i = 1; i <= 2; i++) {
    fs.rmSync(path.join(ROOT, "dist"), { recursive: true, force: true });
    const build = await runCommand("npm", ["run", "build"]);
    check(`rehearsal build ${i} exits 0`, build.code === 0, build.err.slice(-300));
    if (build.code !== 0) {
      process.exitCode = 1;
      return;
    }
    manifests.push(distManifest());
  }
  check("two rehearsal builds produce identical dist hashes",
    JSON.stringify(manifests[0]) === JSON.stringify(manifests[1]));
  const names = manifests[0].map((f) => f.file);
  check("dist manifest includes index.html", names.includes("index.html"));
  check("dist manifest includes the CLI bundle viewportshift.mjs", names.includes("viewportshift.mjs"));
  check("dist manifest includes at least one JS asset", names.some((n) => n.startsWith("assets/") && n.endsWith(".js")));
  check("dist manifest includes at least one CSS asset", names.some((n) => n.startsWith("assets/") && n.endsWith(".css")));
  check("dist manifest is non-empty", names.length >= 4, `files=${names.length}`);
  console.log(`release:verify: dist manifest (${names.length} files): ${names.join(", ")}`);

  const indexHtml = fs.readFileSync(path.join(ROOT, "dist", "index.html"), "utf8");
  check("dist/index.html has no external src/href references",
    !/(?:src|href)\s*=\s*"https?:\/\//i.test(indexHtml));

  const demoRuns = [];
  for (let i = 0; i < 2; i++) {
    const demo = await runCommand("node", ["dist/viewportshift.mjs", "demo"]);
    const result = demo.out.match(/resultSha256=([0-9a-f]+)/)?.[1] ?? null;
    const report = demo.out.match(/reportSha256=([0-9a-f]+)/)?.[1] ?? null;
    const witness = demo.out.match(/witnessLength=(\d+)/)?.[1] ?? null;
    demoRuns.push({ result, report, witness });
    check(`demo run ${i + 1} exits 0 with frozen hashes + witnessLength 1`,
      demo.code === 0 && result === FROZEN_DEMO_RESULT_SHA256 && report === FROZEN_DEMO_REPORT_SHA256 && witness === "1",
      `result=${result} report=${report} witness=${witness}`);
  }
  check("two demo runs agree with each other",
    demoRuns[0].result === demoRuns[1].result && demoRuns[0].report === demoRuns[1].report);
  const demoManifestPath = path.join(ROOT, "demo-output", "DEMO_MANIFEST.json");
  check("demo-output/DEMO_MANIFEST.json exists", fs.existsSync(demoManifestPath));
  if (fs.existsSync(demoManifestPath)) {
    const demoManifest = JSON.parse(fs.readFileSync(demoManifestPath, "utf8"));
    const manifestText = JSON.stringify(demoManifest);
    check("DEMO_MANIFEST.json agrees with demo stdout hashes",
      manifestText.includes(FROZEN_DEMO_RESULT_SHA256) && manifestText.includes(FROZEN_DEMO_REPORT_SHA256),
      `keys=${Object.keys(demoManifest).join(",")}`);
  }

  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  // T014修正的行为断言（与 main() 开头的快照配对）：本次预演没有创建/删除 release/。
  check("rehearsal did not create or delete release/ (existence unchanged)",
    fs.existsSync(path.join(ROOT, "release")) === releaseExistedBefore,
    `before=${releaseExistedBefore} after=${fs.existsSync(path.join(ROOT, "release"))}`);
  const manifest = {
    kind: "P021 ViewportShift release REHEARSAL manifest (NOT the T014 formal freeze)",
    seed: SEED,
    builds: 2,
    buildsIdentical: JSON.stringify(manifests[0]) === JSON.stringify(manifests[1]),
    dist: manifests[0],
    demo: {
      runs: 2,
      resultSha256: demoRuns[0].result,
      reportSha256: demoRuns[0].report,
      witnessLength: demoRuns[0].witness,
      frozenResultSha256: FROZEN_DEMO_RESULT_SHA256,
      frozenReportSha256: FROZEN_DEMO_REPORT_SHA256,
    },
    assertions: h.passed + h.failed,
    passed: h.passed,
    failed: h.failed,
    failures: h.failures,
    windowsTested: "NOT_TESTED",
  };
  fs.writeFileSync(path.join(EVIDENCE_DIR, "RELEASE_MANIFEST.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(EVIDENCE_DIR, "RELEASE_REHEARSAL.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(EVIDENCE_DIR, "SHA256SUMS.txt"),
    manifests[0].map((f) => `${f.sha256}  dist/${f.file}\n`).join(""), "utf8");

  if (!h.summary()) {
    process.exitCode = 1;
  } else {
    console.log("release:verify: PASS — rehearsal builds identical, dist manifest complete, demo hashes re-computed");
  }
}

main().catch((err) => {
  console.error(`release:verify: ERROR — ${err.message}`);
  process.exitCode = 1;
});
