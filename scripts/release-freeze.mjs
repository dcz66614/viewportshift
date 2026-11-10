#!/usr/bin/env node
/**
 * T014 formal freeze: `npm run release:freeze`.
 *
 * Freezes the T013-PASS tree at a fixed commit into release/:
 *   release/source.zip          — all files tracked at HEAD (git ls-files),
 *                                 with contents read from the HEAD commit tree
 *                                 via `git archive HEAD` (T014修正，协调员选A),
 *                                 NEVER from the working-tree disk, so an
 *                                 uncommitted package.json edit cannot leak in
 *   release/dist.zip            — dist/ (4 files) + demo-output/ (3 files)
 *   release/RELEASE_MANIFEST.json — the single formal manifest (T012-P2-4:
 *                                 the rehearsal pair under
 *                                 evidence/release-rehearsal/ is superseded,
 *                                 not re-emitted here)
 *   release/SHA256SUMS.txt      — written LAST, after every acceptance run,
 *                                 then self-checked with `sha256sum -c`
 *                                 (T012-P2-1: performance evidence files are
 *                                 runtime-regenerated, so no frozen hash of
 *                                 them is asserted here)
 *
 * Determinism: each zip is built twice with
 * scripts/deterministic_zip.py (fixed 1980-01-01 timestamps, sorted
 * entries, fixed permissions) and the two passes must be byte-identical
 * before anything is published to release/.
 *
 * The script asserts HEAD is the T013-PASS commit and the working tree
 * is clean except for the freeze outputs themselves (release/,
 * handoff/T014/) and the T014 tooling (this script,
 * scripts/deterministic_zip.py, package.json). It does NOT commit,
 * push, touch GitHub/Drive, or add a LICENSE (PENDING_SAM_DECISION).
 *
 * Exit 0 only when every check passes.
 */
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FROZEN_DEMO_REPORT_SHA256, FROZEN_DEMO_RESULT_SHA256, ROOT, SEED } from "./e2e-lib.mjs";

const EXPECTED_HEAD = "e58411bf1f0f8e80bf29ca1af70fc005a09f0d5e";
const EXPECTED_GATE_SHA256 = "65b4b32f4a5298642fd3de5a64441ed7d214e2519d118b8b67a7871ba73aca26";
const RELEASE_DIR = path.join(ROOT, "release");
const ALLOWED_DIRTY = ["release/", "handoff/T014/", "scripts/deterministic_zip.py", "scripts/release-freeze.mjs", "scripts/release-verify.mjs", "package.json"];

let passed = 0;
let failed = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) { passed++; console.log(`freeze: PASS — ${name}`); }
  else { failed++; failures.push(name); console.log(`freeze: FAIL — ${name}${detail ? ` (${detail})` : ""}`); }
}

function run(cmd, args, cwd = ROOT) {
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

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function listFiles(rootDir, prefix) {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else files.push(p);
    }
  };
  walk(rootDir);
  files.sort();
  return files.map((f) => {
    const rel = path.relative(ROOT, f).split(path.sep).join("/");
    return { file: rel, size: fs.statSync(f).size, sha256: sha256File(f) };
  });
}

async function main() {
  // 1. HEAD must be the T013-PASS commit.
  const head = (await run("git", ["rev-parse", "HEAD"])).out.trim();
  check("HEAD is the T013-PASS commit e58411b", head === EXPECTED_HEAD, `HEAD=${head}`);

  // 2. Working tree clean except freeze outputs + T014 tooling.
  const status = await run("git", ["status", "--porcelain"]);
  const dirty = status.out.split("\n").filter(Boolean).map((l) => l.slice(3).replace(/^"(.*)"$/, "$1"));
  const unexpected = dirty.filter((p) => !ALLOWED_DIRTY.some((a) => p === a || p.startsWith(a)));
  check("working tree clean except release/, handoff/T014/ and T014 tooling",
    status.code === 0 && unexpected.length === 0, unexpected.join(", ") || dirty.join(", "));

  // 3. No LICENSE added without Sam's decision.
  const licenseHits = (await run("git", ["ls-files"])).out.split("\n").filter((f) => /(^|\/)LICENSE/i.test(f));
  check("no LICENSE in the frozen tree (PENDING_SAM_DECISION)", licenseHits.length === 0, licenseHits.join(", "));

  // 4. S0 gate hash unchanged.
  const gate = JSON.parse(fs.readFileSync(path.join(ROOT, "evidence", "s0", "S0_GATE.json"), "utf8"));
  check("S0 gateSha256 unchanged", gate.gateSha256 === EXPECTED_GATE_SHA256, gate.gateSha256);

  // 5. Clean build; dist manifest (same calibre as release:verify).
  fs.rmSync(path.join(ROOT, "dist"), { recursive: true, force: true });
  const build = await run("npm", ["run", "build"]);
  check("clean build exits 0", build.code === 0, build.err.slice(-300));
  if (build.code !== 0) { console.log(`freeze: FAIL — ${failures.length} failure(s)`); process.exitCode = 1; return; }
  const distFiles = listFiles(path.join(ROOT, "dist"), "dist");
  const distNames = distFiles.map((f) => f.file.replace(/^dist\//, ""));
  check("dist manifest includes index.html", distNames.includes("index.html"));
  check("dist manifest includes the CLI bundle viewportshift.mjs", distNames.includes("viewportshift.mjs"));
  check("dist manifest includes at least one JS asset", distNames.some((n) => n.startsWith("assets/") && n.endsWith(".js")));
  check("dist manifest includes at least one CSS asset", distNames.some((n) => n.startsWith("assets/") && n.endsWith(".css")));
  check("dist manifest is exactly 4 files", distFiles.length === 4, `files=${distFiles.length}`);

  // 6. Demo twice; frozen hashes + witnessLength 1.
  const demoRuns = [];
  for (let i = 0; i < 2; i++) {
    const demo = await run("node", ["dist/viewportshift.mjs", "demo"]);
    demoRuns.push({
      result: demo.out.match(/resultSha256=([0-9a-f]+)/)?.[1] ?? null,
      report: demo.out.match(/reportSha256=([0-9a-f]+)/)?.[1] ?? null,
      witness: demo.out.match(/witnessLength=(\d+)/)?.[1] ?? null,
    });
    check(`demo run ${i + 1} exits 0 with frozen hashes + witnessLength 1`,
      demo.code === 0 && demoRuns[i].result === FROZEN_DEMO_RESULT_SHA256 &&
      demoRuns[i].report === FROZEN_DEMO_REPORT_SHA256 && demoRuns[i].witness === "1",
      `result=${demoRuns[i].result} report=${demoRuns[i].report} witness=${demoRuns[i].witness}`);
  }
  check("two demo runs agree", demoRuns[0].result === demoRuns[1].result && demoRuns[0].report === demoRuns[1].report);
  const demoFiles = listFiles(path.join(ROOT, "demo-output"), "demo-output");
  check("demo-output is exactly 3 files", demoFiles.length === 3, `files=${demoFiles.length}`);

  // 7. Source file list = files tracked at HEAD (excludes node_modules/,
  //    dist/, .git/, release/ and untracked freeze outputs by construction).
  //    T014修正（协调员选A）：源内容严格取自提交树（git archive HEAD 解到
  //    临时目录），不读工作树磁盘——工作树可能含有未提交的 T014 工具改动
  //    （如 package.json 新增的 "release:freeze" 入口），旧版按磁盘读取会
  //    把它们漏进 source.zip（旧冻结 4dcaa21e… 即因此混入工作树 package.json）。
  //    哈希、清单与打包均以解出的提交树为准；dist.zip 仍从磁盘构建产物取。
  const tracked = (await run("git", ["ls-files"])).out.split("\n").filter(Boolean);
  check("source file list is non-empty", tracked.length > 0, `files=${tracked.length}`);
  const archiveTmp = fs.mkdtempSync(path.join(os.tmpdir(), "p021-freeze-archive-"));
  const archiveTar = path.join(archiveTmp, "head.tar");
  const archiveOut = await run("git", ["archive", "HEAD", "-o", archiveTar]);
  check("git archive HEAD exits 0", archiveOut.code === 0, archiveOut.err.slice(-300));
  if (archiveOut.code !== 0) { fs.rmSync(archiveTmp, { recursive: true, force: true }); process.exitCode = 1; return; }
  const archiveRoot = path.join(archiveTmp, "tree");
  fs.mkdirSync(archiveRoot, { recursive: true });
  const untar = await run("tar", ["-xf", archiveTar, "-C", archiveRoot]);
  check("git archive HEAD extracts cleanly", untar.code === 0, untar.err.slice(-300));
  if (untar.code !== 0) { fs.rmSync(archiveTmp, { recursive: true, force: true }); process.exitCode = 1; return; }
  const archiveFiles = [];
  {
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else archiveFiles.push(path.relative(archiveRoot, p).split(path.sep).join("/"));
      }
    };
    walk(archiveRoot);
  }
  archiveFiles.sort();
  check("git archive HEAD tree matches git ls-files exactly",
    JSON.stringify(archiveFiles) === JSON.stringify(tracked.slice().sort()),
    `archive=${archiveFiles.length} tracked=${tracked.length}`);
  const sourceFiles = tracked.map((rel) => {
    const f = path.join(archiveRoot, rel);
    return { file: rel, size: fs.statSync(f).size, sha256: sha256File(f) };
  });
  sourceFiles.sort((a, b) => (a.file < b.file ? -1 : 1));
  const sourceTotalBytes = sourceFiles.reduce((s, f) => s + f.size, 0);

  // 8. Build each zip twice; passes must be byte-identical.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "p021-freeze-"));
  try {
    const sourceList = path.join(tmp, "source.txt");
    const distList = path.join(tmp, "dist.txt");
    fs.writeFileSync(sourceList, `${tracked.slice().sort().join("\n")}\n`, "utf8");
    const distEntries = [...distFiles.map((f) => f.file), ...demoFiles.map((f) => f.file)].sort();
    fs.writeFileSync(distList, `${distEntries.join("\n")}\n`, "utf8");
    const hashes = {};
    for (const [name, list] of [["source", sourceList], ["dist", distList]]) {
      // T014修正：source.zip 从解出的提交树（archiveRoot）取数，dist.zip 仍从磁盘取。
      const zipRoot = name === "source" ? archiveRoot : ROOT;
      const passHashes = [];
      for (let i = 1; i <= 2; i++) {
        const out = path.join(tmp, `${name}-pass${i}.zip`);
        const r = await run("python3", ["scripts/deterministic_zip.py", "--create", "--root", zipRoot, "--list", list, "--output", out]);
        check(`deterministic_zip ${name} pass ${i} exits 0`, r.code === 0, r.err.slice(-300));
        if (r.code !== 0) { process.exitCode = 1; return; }
        passHashes.push(sha256File(out));
      }
      check(`two ${name}.zip passes are byte-identical`, passHashes[0] === passHashes[1], `${passHashes[0]} vs ${passHashes[1]}`);
      hashes[name] = { sha256: passHashes[0], pass1: passHashes[0], pass2: passHashes[1] };
      fs.copyFileSync(path.join(tmp, `${name}-pass1.zip`), path.join(RELEASE_DIR, `${name}.zip`));
    }
    const sourceZipSize = fs.statSync(path.join(RELEASE_DIR, "source.zip")).size;
    const distZipSize = fs.statSync(path.join(RELEASE_DIR, "dist.zip")).size;
    check("release/source.zip hash equals pass hashes",
      sha256File(path.join(RELEASE_DIR, "source.zip")) === hashes.source.sha256);
    check("release/dist.zip hash equals pass hashes",
      sha256File(path.join(RELEASE_DIR, "dist.zip")) === hashes.dist.sha256);

    // 9. Manifest (single formal manifest; rehearsal pair superseded).
    const reviewPath = path.join(ROOT, "handoff", "T013", "INDEPENDENT_REVIEW.md");
    const manifest = {
      kind: "P021 ViewportShift release FREEZE manifest (T014 formal freeze)",
      project: "P021 ViewportShift",
      task: "T014",
      seed: SEED,
      sourceCommit: { full: EXPECTED_HEAD, short: "e58411b" },
      s0: { status: "PASS", checks: "120/120", gateSha256: EXPECTED_GATE_SHA256 },
      demo: {
        resultSha256: FROZEN_DEMO_RESULT_SHA256,
        reportSha256: FROZEN_DEMO_REPORT_SHA256,
        witnessLength: 1,
        scenarioSha256: "b3bc29aa2e21970964eb26959848ebf76c2d0019dcb6c21aed65d27f113048e2",
      },
      t013Review: {
        verdict: "PASS",
        p0: 0,
        p1: 0,
        p2: 8,
        commit: "e58411b",
        reviewFile: "handoff/T013/INDEPENDENT_REVIEW.md",
        reviewSha256: sha256File(reviewPath),
      },
      source: {
        fileCount: sourceFiles.length,
        totalBytes: sourceTotalBytes,
        zip: { file: "source.zip", size: sourceZipSize, sha256: hashes.source.sha256 },
        files: sourceFiles,
      },
      dist: {
        zip: { file: "dist.zip", size: distZipSize, sha256: hashes.dist.sha256 },
        files: [...distFiles, ...demoFiles],
      },
      freeze: {
        passes: 2,
        byteIdentical: hashes.source.pass1 === hashes.source.pass2 && hashes.dist.pass1 === hashes.dist.pass2,
        tool: "scripts/deterministic_zip.py",
        fixedTimestamp: "1980-01-01T00:00:00Z",
        determinism: "sorted entries, fixed timestamps, fixed permissions, deflate level 9",
      },
      windowsTested: "NOT_TESTED",
      license: "PENDING_SAM_DECISION",
      rehearsalSuperseded: "T012-P2-4: evidence/release-rehearsal/RELEASE_MANIFEST.json and RELEASE_REHEARSAL.json are byte-identical pre-freeze rehearsal artefacts. The formal freeze emits exactly one manifest (release/RELEASE_MANIFEST.json); the rehearsal pair is superseded by it and is NOT re-emitted. It stays in the frozen source tree only because removing a tracked file would require a new commit + new T013 + new T014.",
      performanceEvidenceNote: "T012-P2-1: evidence/performance/PERFORMANCE_TEST.json and PERFORMANCE_REPORT.md are runtime-regenerated (measured values change every run; thresholds frozen). No frozen hash of them is asserted; release/SHA256SUMS.txt is generated as the last freeze step and self-checked immediately.",
      unresolvedP2Carried: [
        "T013-P2-1: timeline row status ignores GeometryStep.status",
        "T013-P2-2: result===null window top bar defaults to UNKNOWN",
        "T011-P2-1: golden expected.bfs lacks nodesVisited/nodesEnqueued",
        "T012-P2-2: e2e downloads keeps only the Enter-test export",
        "T012-P2-3: performance thresholds all floor-bound",
      ],
    };
    fs.mkdirSync(RELEASE_DIR, { recursive: true });
    fs.writeFileSync(path.join(RELEASE_DIR, "RELEASE_MANIFEST.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    // 10. SHA256SUMS.txt LAST, then self-check immediately.
    const sums = [
      `${hashes.source.sha256}  source.zip`,
      `${hashes.dist.sha256}  dist.zip`,
      `${sha256File(path.join(RELEASE_DIR, "RELEASE_MANIFEST.json"))}  RELEASE_MANIFEST.json`,
    ];
    fs.writeFileSync(path.join(RELEASE_DIR, "SHA256SUMS.txt"), `${sums.join("\n")}\n`, "utf8");
    const selfCheck = await run("sha256sum", ["-c", "SHA256SUMS.txt"], RELEASE_DIR);
    check("SHA256SUMS.txt self-check: all OK", selfCheck.code === 0 && /source\.zip: OK/.test(selfCheck.out) && /dist\.zip: OK/.test(selfCheck.out) && /RELEASE_MANIFEST\.json: OK/.test(selfCheck.out), selfCheck.out.trim());

    const releaseNames = fs.readdirSync(RELEASE_DIR).sort();
    check("release/ contains exactly the 4 freeze artefacts",
      JSON.stringify(releaseNames) === JSON.stringify(["RELEASE_MANIFEST.json", "SHA256SUMS.txt", "dist.zip", "source.zip"]),
      releaseNames.join(", "));

    console.log(`freeze: source.zip sha256=${hashes.source.sha256} size=${sourceZipSize} files=${sourceFiles.length}`);
    console.log(`freeze: dist.zip sha256=${hashes.dist.sha256} size=${distZipSize} files=${distFiles.length + demoFiles.length}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(archiveTmp, { recursive: true, force: true });
  }

  console.log(`freeze: ${passed} passed, ${failed} failed`);
  if (failed > 0) { console.log(`freeze: failures: ${failures.join("; ")}`); process.exitCode = 1; }
  else console.log("freeze: PASS — source.zip + dist.zip frozen, byte-identical across two passes, manifest + SHA256SUMS closed");
}

main().catch((err) => {
  console.error(`freeze: ERROR — ${err.message}`);
  process.exitCode = 1;
});
