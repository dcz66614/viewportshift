/**
 * P021 ViewportShift — CLI entry (T010, S3).
 *
 * Contract: P021_PROJECT_BOOK.md §3.3, §5.2, §9 and
 * P021_IMPLEMENTATION_PLAN.md §5 (T010), §6.
 *
 * Usage (built by `npm run build` into `dist/viewportshift.mjs`):
 *   node dist/viewportshift.mjs demo [--out <dir>]
 *   node dist/viewportshift.mjs --help
 *
 * The `demo` command runs one end-to-end demonstration using only
 * the built-in synthetic scenario and the frozen seed: it loads the
 * demo scenario, replays it, runs the bounded BFS witness search,
 * and writes a canonical result JSON and a self-contained offline
 * HTML report to a fixed output directory (default `demo-output/`),
 * plus a manifest carrying the recomputable SHA-256 digests. It
 * exits 0 only when every step succeeds; any failure prints a
 * message to stderr and exits non-zero.
 *
 * Runtime: zero network, zero LLM/API, zero telemetry, zero upload.
 * No wall clock, no randomness: output paths are fixed, file
 * contents are deterministic (no timestamps, no absolute paths, no
 * random values), so re-running the demo yields identical hashes.
 *
 * Note on types: this project ships no `@types/node` (no new
 * dependency). The Node built-in imports below are typed by the
 * minimal local declarations in `src/node-shims.d.ts` (T011: the
 * three former ignore-directive lines are removed; runtime resolution
 * is by the vite lib bundle, which marks `node:` specifiers
 * external), and `process` is declared minimally here. All domain /
 * io logic in this file is still fully type-checked.
 */

import { searchBfs } from "./domain/bfs.ts";
import { deriveAnalysisStatus } from "./domain/analysis-status.ts";
import { canonicalJson } from "./domain/geometry.ts";
import { evaluateGeometry } from "./domain/geometry-eval.ts";
import { buildDemoScenario, DEMO_SCENARIO_ID } from "./io/demo.ts";
import {
  buildResultEnvelope,
  exportResultJson,
  exportScenarioJson,
  parseScenarioJson,
} from "./io/json.ts";
import { buildReportHtml } from "./io/report.ts";

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

declare const process: {
  argv: Array<string>;
  cwd(): string;
  exitCode: number | undefined;
  stdout: { write(text: string): void };
  stderr: { write(text: string): void };
};

const CLI_VERSION = "cli/v1";
const DEFAULT_OUT_DIR = "demo-output";
const DEMO_JSON_NAME = "viewportshift-demo.json";
const DEMO_REPORT_NAME = "viewportshift-demo-report.html";
const DEMO_MANIFEST_NAME = "DEMO_MANIFEST.json";

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Derive the top-bar analysis status from a geometry evaluation —
 * the shared rule in `src/domain/analysis-status.ts` (T011: the
 * former CLI-local copy is removed; both call sites use the one
 * shared pure function, behaviour unchanged).
 */

function printHelp(): void {
  // Help and progress go to stdout; only errors go to stderr.
  const lines = [
    "ViewportShift CLI (T010)",
    "Usage:",
    "  node dist/viewportshift.mjs demo [--out <dir>]",
    "  node dist/viewportshift.mjs --help",
    "",
    "demo runs the built-in synthetic scenario (chat input,",
    "overlays-content, frozen seed), replays it, searches for the",
    "shortest failing sequence, and writes canonical result JSON,",
    "a self-contained offline HTML report, and a hash manifest to",
    "the output directory (default demo-output/).",
  ];
  for (const line of lines) {
    process.stdout.write(`${line}\n`);
  }
}

function fail(message: string): number {
  process.stderr.write(`viewportshift: ${message}\n`);
  return 1;
}

function runDemo(args: Array<string>): number {
  let outDir = DEFAULT_OUT_DIR;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--out") {
      if (i + 1 >= args.length || args[i + 1].startsWith("--")) {
        return fail("--out requires a directory argument");
      }
      outDir = args[i + 1];
      i += 1;
    } else {
      return fail(`unknown demo argument: ${args[i]}`);
    }
  }

  const scenario = buildDemoScenario();
  const exportedScenario = exportScenarioJson(scenario);
  if (!exportedScenario.ok || exportedScenario.json === null) {
    return fail(
      `demo scenario failed validation: ${exportedScenario.issues.map((i) => i.code).join(", ")}`,
    );
  }
  // Re-import the canonical JSON: the demo itself exercises the
  // export -> import round-trip, and the normalized scenario is what
  // the domain runs and the envelope carries.
  const parsedScenario = parseScenarioJson(exportedScenario.json);
  if (!parsedScenario.ok || parsedScenario.scenario === null) {
    return fail(
      `demo scenario failed re-import: ${parsedScenario.issues.map((i) => i.code).join(", ")}`,
    );
  }
  const normalizedScenario = parsedScenario.scenario;
  const scenarioSha256 = sha256Hex(exportedScenario.json);
  const evaluation = evaluateGeometry(normalizedScenario, scenarioSha256);
  const bfs = searchBfs(normalizedScenario, scenarioSha256);
  const analysisStatus = deriveAnalysisStatus(evaluation);
  const envelope = buildResultEnvelope(
    normalizedScenario,
    scenarioSha256,
    analysisStatus,
    evaluation,
    bfs,
  );
  const exportedResult = exportResultJson(envelope);
  if (!exportedResult.ok || exportedResult.json === null) {
    return fail(
      `demo result failed export: ${exportedResult.issues.map((i) => i.code).join(", ")}`,
    );
  }
  const resultSha256 = sha256Hex(exportedResult.json);
  const reportHtml = buildReportHtml({
    scenario: normalizedScenario,
    scenarioSha256,
    analysisStatus,
    evaluation,
    bfs,
  });
  const reportSha256 = sha256Hex(reportHtml);
  const manifest = {
    cliVersion: CLI_VERSION,
    demo: "synthetic-only",
    scenarioId: DEMO_SCENARIO_ID,
    seed: "P021-VIEWPORTSHIFT-S0-2026-11-10",
    mode: "overlays-content",
    analysisStatus,
    scenarioSha256,
    resultSha256,
    reportSha256,
    files: [DEMO_JSON_NAME, DEMO_REPORT_NAME, DEMO_MANIFEST_NAME],
  };
  const manifestJson = canonicalJson(manifest);

  const outPath = path.resolve(process.cwd(), outDir);
  try {
    fs.mkdirSync(outPath, { recursive: true });
    fs.writeFileSync(path.join(outPath, DEMO_JSON_NAME), exportedResult.json + "\n", "utf8");
    fs.writeFileSync(path.join(outPath, DEMO_REPORT_NAME), reportHtml, "utf8");
    fs.writeFileSync(path.join(outPath, DEMO_MANIFEST_NAME), manifestJson + "\n", "utf8");
  } catch (error) {
    return fail(
      `could not write demo output: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }

  const lines = [
    `demo: scenario=${DEMO_SCENARIO_ID} status=${analysisStatus}`,
    `demo: scenarioSha256=${scenarioSha256}`,
    `demo: resultSha256=${resultSha256}`,
    `demo: reportSha256=${reportSha256}`,
    `demo: witnessLength=${bfs.witnessLength === null ? "none" : String(bfs.witnessLength)}`,
    `demo: wrote ${outDir}/${DEMO_JSON_NAME}`,
    `demo: wrote ${outDir}/${DEMO_REPORT_NAME}`,
    `demo: wrote ${outDir}/${DEMO_MANIFEST_NAME}`,
  ];
  for (const line of lines) {
    process.stdout.write(`${line}\n`);
  }
  return 0;
}

export function main(argv: Array<string>): number {
  const [command, ...rest] = argv;
  if (command === undefined || command === "--help" || command === "-h") {
    printHelp();
    return 0;
  }
  if (command === "demo") {
    return runDemo(rest);
  }
  return fail(`unknown command: ${command} (try --help)`);
}

process.exitCode = main(process.argv.slice(2));
