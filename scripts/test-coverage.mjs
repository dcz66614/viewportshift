#!/usr/bin/env node
/**
 * T011 aggregate runner: `npm run test:coverage`.
 *
 * Coverage-set aggregate entry point — Golden + Property + Oracle +
 * Mutation — and fails if any of them fails:
 * `test:golden`, `test:property --seed <frozen>`,
 * `test:oracle`, `test:mutation`.
 * Exits 0 only when all four exit 0. No hard-coded `exit 0`.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ROOT,
  SEED,
  deepEqual,
  diffPaths,
  listGoldenFixtures,
  loadJson,
  loadT011Domain,
  runNodeScript,
  runPythonBfsOracle,
  sha256Hex,
} from "./t011-lib.mjs";

/**
 * P2 verification preamble (T011 fixes with no other home):
 * - P2-2 fail-closed limits: legal limits preserved, illegal fields
 *   fall back per-field with the fallback reason recorded, and the
 *   Python BFS Oracle agrees field-by-field on the same raw inputs.
 * - P2-7 envelope integrity: `exportResultJson` recomputes
 *   scenarioSha256 and rejects a tampered hash; the pure-TS SHA-256
 *   matches Node's crypto SHA-256.
 * - P2-5 geometry-eval INVALID-step branch (observational): across
 *   the whole frozen corpus (geometry + golden fixtures) no scenario
 *   step ever takes the INVALID branch — see TASK_REPORT.md for the
 *   static argument; the branch is registered for T013, not deleted.
 * - P2-8/P2-9 wiring: one shared `deriveAnalysisStatus` (CLI + UI
 *   both use it; no local copy remains) and zero `// @ts-ignore`
 *   left in `src/cli.ts`.
 */
async function verifyP2() {
  const failures = [];
  const passes = [];
  const check = (name, ok, detail) => {
    if (ok) passes.push(name);
    else failures.push(detail ? `${name} — ${detail}` : name);
  };
  const { geometryEval, bfs, ioJson } = await loadT011Domain();
  const baseScenario = loadJson(
    path.join(ROOT, "tests/fixtures/golden/golden-rv-chat-open.json"),
  );

  // ---- P2-2: fail-closed limits. ----
  const rawCases = [
    {
      label: "legal limits preserved",
      mutate: (s) => { s.mode = "pinch-zoom"; s.limits = { ...s.limits, maxDepth: 2, maxNodes: 500 }; },
      wantStatus: "UNKNOWN",
      wantLimits: { maxDepth: 2, maxNodes: 500 },
      wantFallback: null,
    },
    {
      label: "illegal maxDepth falls back",
      mutate: (s) => { s.mode = "pinch-zoom"; s.limits = { ...s.limits, maxDepth: 0, maxNodes: 10000 }; },
      wantStatus: "INVALID",
      wantLimits: { maxDepth: 8, maxNodes: 10000 },
      wantFallback: "limits.maxDepth invalid, using default 8",
    },
    {
      label: "non-numeric maxNodes falls back",
      mutate: (s) => { s.mode = "pinch-zoom"; s.limits = { ...s.limits, maxDepth: 3, maxNodes: "x" }; },
      wantStatus: "INVALID",
      wantLimits: { maxDepth: 3, maxNodes: 10000 },
      wantFallback: "limits.maxNodes invalid, using default 10000",
    },
    {
      label: "missing limits falls back for both",
      mutate: (s) => { s.mode = "pinch-zoom"; delete s.limits; },
      wantStatus: "INVALID",
      wantLimits: { maxDepth: 8, maxNodes: 10000 },
      wantFallback: "limits.maxDepth invalid, using default 8; limits.maxNodes invalid, using default 10000",
    },
  ];
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "viewportshift-p2-"));
  try {
    const files = [];
    for (let i = 0; i < rawCases.length; i++) {
      const scenario = JSON.parse(JSON.stringify(baseScenario));
      delete scenario.expected;
      rawCases[i].mutate(scenario);
      const file = path.join(tmpDir, `p2-limits-${i}.json`);
      fs.writeFileSync(file, `${JSON.stringify(scenario, null, 2)}\n`, "utf8");
      files.push(file);
      const result = bfs.searchBfs(scenario, sha256Hex(bfs.canonicalBfsJson(scenario)));
      check(
        `p2-2 ${rawCases[i].label}: status ${rawCases[i].wantStatus}`,
        result.status === rawCases[i].wantStatus,
        `status=${result.status}`,
      );
      check(
        `p2-2 ${rawCases[i].label}: limits preserved/fell back`,
        deepEqual(result.limits, rawCases[i].wantLimits),
        `limits=${JSON.stringify(result.limits)}`,
      );
      check(
        `p2-2 ${rawCases[i].label}: fallback reason recorded`,
        (result.limitsFallbackReason ?? null) === rawCases[i].wantFallback,
        `reason=${JSON.stringify(result.limitsFallbackReason ?? null)}`,
      );
      check(
        `p2-2 ${rawCases[i].label}: validationIssues record the cause`,
        result.validationIssues.some(
          (issue) =>
            issue.code === "invalid_limits" ||
            issue.path === "limits" ||
            String(issue.path ?? "").startsWith("limits."),
        ) || rawCases[i].wantFallback === null,
        JSON.stringify(result.validationIssues.map((issue) => `${issue.path}:${issue.code}`)),
      );
    }
    // The Python BFS Oracle must agree on the same raw inputs.
    const pyOut = path.join(tmpDir, "PY.json");
    const run = runPythonBfsOracle(files, pyOut, 1);
    check("p2-2: python BFS oracle exits 0", run.code === 0, `exit=${run.code}`);
    if (run.output !== null) {
      for (let i = 0; i < rawCases.length; i++) {
        const scenario = JSON.parse(fs.readFileSync(files[i], "utf8"));
        const ts = bfs.searchBfs(scenario, sha256Hex(bfs.canonicalBfsJson(scenario)));
        const diffs = diffPaths(ts, run.output.results[i], `p2-limits-${i}`);
        check(`p2-2 ${rawCases[i].label}: TS/Python agree`, diffs.length === 0,
          diffs.slice(0, 3).join("; "));
      }
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  // ---- P2-7: envelope integrity. ----
  {
    const fixture = loadJson(
      path.join(ROOT, "tests/fixtures/golden/golden-oc-chat-open.json"),
    );
    // Normalise first (the CLI flow does the same): the envelope hash
    // is over the validator-normalised scenario, not the raw fixture
    // (which carries the test-only `expected` block).
    const scenExport = ioJson.exportScenarioJson(fixture);
    check("p2-7: fixture scenario exports", scenExport.ok === true);
    const normalized = ioJson.parseScenarioJson(scenExport.json).scenario;
    const sha = sha256Hex(scenExport.json);
    const evaluation = geometryEval.evaluateGeometry(normalized, sha);
    const found = bfs.searchBfs(normalized, sha);
    const envelope = ioJson.buildResultEnvelope(
      normalized, sha, "FAIL", evaluation, found,
    );
    const exported = ioJson.exportResultJson(envelope);
    check("p2-7: correct envelope exports", exported.ok === true,
      JSON.stringify(exported.issues ?? []));
    check(
      "p2-7: pure-TS SHA-256 matches Node crypto on the scenario",
      ioJson.sha256HexPure(ioJson.canonicalExportJson(fixture)) === sha256Hex(ioJson.canonicalExportJson(fixture)),
      "hash mismatch",
    );
    check(
      "p2-7: pure-TS SHA-256 matches Node crypto on multibyte text",
      ioJson.sha256HexPure("中文测试😀") === sha256Hex("中文测试😀"),
      "hash mismatch",
    );
    const tamperedHash = JSON.parse(JSON.stringify(envelope));
    tamperedHash.scenarioSha256 = "0".repeat(64);
    const rejectedHash = ioJson.exportResultJson(tamperedHash);
    check(
      "p2-7: tampered scenarioSha256 is rejected at export",
      rejectedHash.ok === false &&
        rejectedHash.issues.some((issue) => issue.code === "import_hash_mismatch"),
      JSON.stringify(rejectedHash.issues ?? []),
    );
    const tamperedMode = JSON.parse(JSON.stringify(envelope));
    tamperedMode.scenario = { ...tamperedMode.scenario, mode: "resizes-visual" };
    const rejectedMode = ioJson.exportResultJson(tamperedMode);
    check(
      "p2-7: tampered scenario mode is rejected at export",
      rejectedMode.ok === false,
      JSON.stringify(rejectedMode.issues ?? []),
    );
  }

  // ---- P2-5: INVALID-step branch, observational. ----
  {
    const geoDir = path.join(ROOT, "tests/fixtures/geometry");
    const files = fs.readdirSync(geoDir)
      .filter((f) => f.startsWith("geometry-") && f.endsWith(".json"))
      .map((f) => path.join(geoDir, f));
    const goldenFiles = listGoldenFixtures();
    let steps = 0;
    let invalidSteps = 0;
    for (const file of [...files, ...goldenFiles]) {
      const fixture = loadJson(file);
      const sha = sha256Hex(bfs.canonicalBfsJson(fixture));
      const result = fixture.kind === "direct"
        ? geometryEval.evaluateDirectGeometry(fixture, sha)
        : geometryEval.evaluateGeometry(fixture, sha);
      for (const step of result.steps ?? []) {
        steps += 1;
        if (step.status === "INVALID") invalidSteps += 1;
      }
    }
    check(
      "p2-5: no scenario step takes the INVALID branch in the frozen corpus",
      invalidSteps === 0,
      `INVALID steps=${invalidSteps} of ${steps}`,
    );
  }

  // ---- P2-8 / P2-9 wiring. ----
  {
    const cliSource = fs.readFileSync(path.join(ROOT, "src/cli.ts"), "utf8");
    const uiSource = fs.readFileSync(path.join(ROOT, "src/ui/scenario.ts"), "utf8");
    const domainSource = fs.readFileSync(
      path.join(ROOT, "src/domain/analysis-status.ts"),
      "utf8",
    );
    check("p2-8: single shared deriveAnalysisStatus exists",
      domainSource.includes("export function deriveAnalysisStatus"));
    check("p2-8: CLI uses the shared function, no local copy",
      cliSource.includes('from "./domain/analysis-status.ts"') &&
        !/function deriveAnalysisStatus/.test(cliSource));
    check("p2-8: UI re-exports the shared function, no local copy",
      uiSource.includes('export { deriveAnalysisStatus } from "../domain/analysis-status.ts"') &&
        !/export function deriveAnalysisStatus/.test(uiSource));
    check("p2-9: no // @ts-ignore remains in src/cli.ts",
      !cliSource.includes("@ts-ignore"));
    check("p2-9: minimal node type declarations exist",
      fs.existsSync(path.join(ROOT, "src/node-shims.d.ts")));
  }

  return { passes, failures };
}

const steps = [
  { name: "test:golden", script: "test-golden.mjs", args: [] },
  { name: "test:property", script: "test-property.mjs", args: ["--seed", SEED] },
  { name: "test:oracle", script: "test-oracle.mjs", args: [] },
  { name: "test:mutation", script: "test-mutation.mjs", args: [] },
];

const p2 = await verifyP2();
console.log(`test:coverage P2 verification — passed: ${p2.passes.length}, failed: ${p2.failures.length}`);
for (const failure of p2.failures) console.log(`FAIL: ${failure}`);
let failed = p2.failures.length > 0;
for (const step of steps) {
  const run = runNodeScript(step.script, step.args);
  if (run.stdout) process.stdout.write(run.stdout);
  if (run.stderr) process.stdout.write(run.stderr);
  if (run.status !== 0) {
    console.log(`test:coverage — ${step.name} FAILED (exit ${run.status})`);
    failed = true;
  } else {
    console.log(`test:coverage — ${step.name} PASS`);
  }
}
if (failed) {
  process.exitCode = 1;
} else {
  console.log("test:coverage: PASS — Golden + Property + Oracle + Mutation");
}
