#!/usr/bin/env node
/**
 * Shared helpers for the T011 acceptance runners (`npm run
 * test:golden`, `test:property`, `test:mutation`,
 * `oracle:diff:coverage`, `test:oracle`, `test:coverage`, `npm test`).
 * No acceptance logic lives here — only domain loading (the T008/T010
 * pattern: the domain modules transpiled in-memory with the project's
 * own TypeScript devDependency), fixture loading, canonical hashing,
 * an independent metric re-derivation, and the shared golden / BFS
 * fixture checkers used by the golden runner and the mutation runner
 * (so a mutant is judged by the same checks as the baseline).
 *
 * Every runner exits non-zero on any failure; there is no hard-coded
 * `exit 0` shortcut anywhere in this directory. Output uses relative
 * paths only and contains no timestamps, absolute machine paths, or
 * random values.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import { FORBIDDEN_TOKENS, ROOT, diffPaths } from "./s0-lib.mjs";

export { FORBIDDEN_TOKENS, ROOT, diffPaths };

export const SEED = "P021-VIEWPORTSHIFT-S0-2026-11-10";
export const BFS_VERSION = "bfs/v1";
export const GOLDEN_FIXTURE_DIR_REL = "tests/fixtures/golden";
export const BFS_FIXTURE_DIR_REL = "tests/fixtures/bfs";
export const MUTATION_FIXTURE_DIR_REL = "tests/fixtures/mutations";
export const PROPERTY_FIXTURE_DIR_REL = "tests/fixtures/properties";
export const BFS_ORACLE_REL = "oracle/python/bfs_oracle.py";
export const GEOMETRY_ORACLE_REL = "oracle/python/geometry_full_oracle.py";

export function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function rel(p) {
  return path.relative(ROOT, p).split(path.sep).join("/");
}

export function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, "utf8");
}

/** Deep equality for JSON values (objects, arrays, scalars). */
export function deepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") {
    return false;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    return (
      a.length === b.length && a.every((item, i) => deepEqual(item, b[i]))
    );
  }
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  return (
    aKeys.length === bKeys.length &&
    aKeys.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]))
  );
}

function listDirFiles(dirRel, prefix) {
  const dir = path.join(ROOT, dirRel);
  return fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(prefix) && f.endsWith(".json"))
    .sort()
    .map((f) => path.join(dir, f));
}

export function listGoldenFixtures() {
  return listDirFiles(GOLDEN_FIXTURE_DIR_REL, "golden-");
}

/** All BFS fixtures: the 11 T008 `bfs-*` files plus the T011 branch files. */
export function listAllBfsFixtures() {
  const dir = path.join(ROOT, BFS_FIXTURE_DIR_REL);
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => path.join(dir, f));
}

export function listMutationFixtures() {
  return listDirFiles(MUTATION_FIXTURE_DIR_REL, "M");
}

export function listPropertyFixtures() {
  return listDirFiles(PROPERTY_FIXTURE_DIR_REL, "prop-");
}

/**
 * Transpile the T011 domain set in-memory and import it. `overrides`
 * maps a relative source path to replacement source text (the
 * mutation runner's temp-copy mechanism: the real sources on disk are
 * never touched). Returns { geometryEval, geometry, events, bfs,
 * ioJson, sources }.
 */
export async function loadT011Domain(overrides = {}) {
  const files = [
    "src/domain/types.ts",
    "src/domain/validate.ts",
    "src/domain/viewport-state.ts",
    "src/domain/modes.ts",
    "src/domain/geometry.ts",
    "src/domain/geometry-eval.ts",
    "src/domain/events.ts",
    "src/domain/bfs.ts",
    "src/domain/analysis-status.ts",
    "src/io/json.ts",
  ];
  const sources = {};
  for (const relPath of files) {
    sources[relPath] =
      relPath in overrides
        ? overrides[relPath]
        : fs.readFileSync(path.join(ROOT, relPath), "utf8");
  }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "viewportshift-t011-"));
  try {
    for (const relPath of files) {
      const transpiled = ts.transpileModule(sources[relPath], {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2020,
        },
        reportDiagnostics: true,
      });
      const errors = (transpiled.diagnostics ?? []).filter(
        (d) => d.category === ts.DiagnosticCategory.Error,
      );
      if (errors.length > 0) {
        throw new Error(
          `${relPath} transpile errors: ` +
            errors
              .map((d) => ts.flattenDiagnosticMessageText(d.messageText, " "))
              .join("; "),
        );
      }
      const outText = transpiled.outputText.replace(
        /from\s+"([^"]+)\.ts"/g,
        (_m, spec) => `from "./${path.basename(spec)}.mjs"`,
      );
      const base = path.basename(relPath, ".ts");
      fs.writeFileSync(path.join(tmpDir, `${base}.mjs`), outText);
    }
    const load = async (name) =>
      import(pathToFileURL(path.join(tmpDir, `${name}.mjs`)).href);
    const [geometryEval, geometry, events, bfs, ioJson] = await Promise.all([
      load("geometry-eval"),
      load("geometry"),
      load("events"),
      load("bfs"),
      load("json"),
    ]);
    return { geometryEval, geometry, events, bfs, ioJson, sources };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** Exact integer square root (floor) via BigInt Newton iteration. */
export function bigIsqrt(n) {
  let x = BigInt(n);
  if (x < 2n) return x;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + BigInt(n) / x) / 2n;
  }
  return x;
}

/**
 * Independent re-derivation of one metric set from its rects
 * (runner-side integer arithmetic, same pattern as the T008 runner).
 */
export function rederiveMetrics(surface, visual, keyboard, keyboardVisible, expectedAnchor) {
  const area = (r) => r.width * r.height;
  const inter = (a, b) => {
    const left = Math.max(a.x, b.x);
    const top = Math.max(a.y, b.y);
    const right = Math.min(a.x + a.width, b.x + b.width);
    const bottom = Math.min(a.y + a.height, b.y + b.height);
    if (right <= left || bottom <= top) return 0;
    return (right - left) * (bottom - top);
  };
  const triple = (a, b, c) => {
    const ab = {
      x: Math.max(a.x, b.x),
      y: Math.max(a.y, b.y),
      width: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
      height: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
    };
    if (ab.width <= 0 || ab.height <= 0) return 0;
    return inter(ab, c);
  };
  const surfaceArea = area(surface);
  const visibleIntersection = inter(surface, visual);
  const keyboardObscuredArea = keyboardVisible
    ? triple(surface, visual, keyboard)
    : 0;
  const visibleArea = visibleIntersection - keyboardObscuredArea;
  const viewportClippedArea = surfaceArea - visibleIntersection;
  const visibleRatio = Number(
    (BigInt(visibleArea) * 1000n) / BigInt(surfaceArea),
  );
  const bottomGap =
    visual.y + visual.height - (surface.y + surface.height);
  const dx = surface.x - expectedAnchor.x;
  const dy = surface.y - expectedAnchor.y;
  const magnitude = Number(bigIsqrt(dx * dx + dy * dy));
  return {
    surfaceArea,
    keyboardObscuredArea,
    viewportClippedArea,
    visibleArea,
    visibleRatio,
    bottomGap,
    anchorDrift: { dx, dy, magnitude },
  };
}

/** Witness event (type/id/atMs/params) as a comparable plain object. */
export function witnessEventOf(step) {
  const out = { type: step.eventType, id: step.eventId, atMs: step.atMs };
  for (const [k, v] of Object.entries(step.params ?? {})) out[k] = v;
  return out;
}

/** Expected witness event (fixture shape) normalised the same way. */
export function expectedWitnessEventOf(event) {
  const out = { type: event.type, id: event.id, atMs: event.atMs };
  for (const key of ["keyboardHeight", "dx", "dy"]) {
    if (key in event) out[key] = event[key];
  }
  return out;
}

/**
 * Check one golden fixture's TS results against its hand-authored
 * `expected` block. Returns an array of failure strings (empty when
 * the fixture passes). Used by `test:golden` and, identically, by
 * the mutation runner (a mutant is detected exactly when this
 * returns non-empty for a fixture it should change).
 */
export function checkGoldenFixture(fixture, geometryResult, bfsResult) {
  const failures = [];
  const label = fixture.scenario_id;
  const expGeo = fixture.expected.geometry;
  const expBfs = fixture.expected.bfs;
  if (fixture.seed !== SEED) {
    failures.push(`${label}: seed mismatch (${fixture.seed})`);
  }
  if (geometryResult.status !== expGeo.status) {
    failures.push(
      `${label}: geometry status ${geometryResult.status}, expected ${expGeo.status}`,
    );
  }
  if ((geometryResult.reason ?? null) !== (expGeo.reason ?? null)) {
    failures.push(
      `${label}: geometry reason ${geometryResult.reason}, expected ${expGeo.reason ?? null}`,
    );
  }
  if (!deepEqual(geometryResult.finalMetrics ?? null, expGeo.finalMetrics ?? null)) {
    failures.push(
      `${label}: finalMetrics ${JSON.stringify(geometryResult.finalMetrics)}, expected ${JSON.stringify(expGeo.finalMetrics)}`,
    );
  }
  if (
    !deepEqual(
      geometryResult.finalFailedPredicates ?? [],
      expGeo.finalFailedPredicates ?? [],
    )
  ) {
    failures.push(
      `${label}: finalFailedPredicates ${JSON.stringify(geometryResult.finalFailedPredicates)}, expected ${JSON.stringify(expGeo.finalFailedPredicates)}`,
    );
  }
  if (geometryResult.steps.length !== expGeo.steps) {
    failures.push(
      `${label}: geometry steps ${geometryResult.steps.length}, expected ${expGeo.steps}`,
    );
  }
  // Independent re-derivation of the final step's metrics from rects.
  if (
    geometryResult.status === "OK" &&
    geometryResult.steps.length > 0
  ) {
    const last = geometryResult.steps[geometryResult.steps.length - 1];
    const visualRect = {
      x: last.state.visualOffsetLeft,
      y: last.state.visualOffsetTop,
      width: last.state.visualWidth,
      height: last.state.visualHeight,
    };
    const rederived = rederiveMetrics(
      last.surfaceRect,
      visualRect,
      last.state.keyboardRect,
      last.state.keyboardVisible,
      last.expectedAnchorRect,
    );
    if (!deepEqual(rederived, last.metrics)) {
      failures.push(
        `${label}: re-derived final metrics ${JSON.stringify(rederived)} != domain ${JSON.stringify(last.metrics)}`,
      );
    }
  }
  checkBfsExpected(label, bfsResult, expBfs, fixture, failures);
  return failures;
}

/**
 * Check a BFS result against an expected block (golden shape or the
 * T008 BFS-fixture shape). Appends failures to `failures`.
 */
export function checkBfsExpected(label, result, exp, fixture, failures) {
  if (result.status !== exp.status) {
    failures.push(`${label}: bfs status ${result.status}, expected ${exp.status}`);
  }
  if ((result.reason ?? null) !== (exp.reason ?? null)) {
    failures.push(
      `${label}: bfs reason ${result.reason}, expected ${exp.reason ?? null}`,
    );
  }
  if (
    "witnessLength" in exp &&
    (result.witnessLength ?? null) !== (exp.witnessLength ?? null)
  ) {
    failures.push(
      `${label}: bfs witnessLength ${result.witnessLength}, expected ${exp.witnessLength ?? null}`,
    );
  }
  const expWitness = exp.witness ?? null;
  if (expWitness === null) {
    if (result.witness !== null) {
      failures.push(`${label}: bfs witness expected null, got length ${result.witness.length}`);
    }
  } else {
    if (result.witness === null) {
      failures.push(`${label}: bfs witness expected length ${expWitness.length}, got null`);
    } else {
      const got = result.witness.map(witnessEventOf);
      const want = expWitness.map(expectedWitnessEventOf);
      if (!deepEqual(got, want)) {
        failures.push(
          `${label}: bfs witness ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`,
        );
      }
    }
  }
  if (!deepEqual(result.failedPredicates ?? [], exp.failedPredicates ?? [])) {
    failures.push(
      `${label}: bfs failedPredicates ${JSON.stringify(result.failedPredicates)}, expected ${JSON.stringify(exp.failedPredicates)}`,
    );
  }
  if ((result.limitReached ?? null) !== (exp.limitReached ?? null)) {
    failures.push(
      `${label}: bfs limitReached ${result.limitReached}, expected ${exp.limitReached ?? null}`,
    );
  }
  if (
    "firstFailedStepIndex" in exp &&
    (result.firstFailedStepIndex ?? null) !== (exp.firstFailedStepIndex ?? null)
  ) {
    failures.push(
      `${label}: bfs firstFailedStepIndex ${result.firstFailedStepIndex}, expected ${exp.firstFailedStepIndex ?? null}`,
    );
  }
  if ("nodesVisited" in exp && result.nodesVisited !== exp.nodesVisited) {
    failures.push(
      `${label}: bfs nodesVisited ${result.nodesVisited}, expected ${exp.nodesVisited}`,
    );
  }
  if ("nodesEnqueued" in exp && result.nodesEnqueued !== exp.nodesEnqueued) {
    failures.push(
      `${label}: bfs nodesEnqueued ${result.nodesEnqueued}, expected ${exp.nodesEnqueued}`,
    );
  }
  // Fail-closed limits (T011 P2-2): the result limits must equal the
  // fixture's own limits whenever they are legal, and the fallback
  // reason must match the expectation (null for all frozen fixtures).
  if (fixture.limits !== undefined) {
    const wantLimits = {
      maxDepth: fixture.limits.maxDepth,
      maxNodes: fixture.limits.maxNodes,
    };
    if (!deepEqual(result.limits, wantLimits)) {
      failures.push(
        `${label}: bfs limits ${JSON.stringify(result.limits)}, expected ${JSON.stringify(wantLimits)}`,
      );
    }
  }
  if (
    "limitsFallbackReason" in exp &&
    (result.limitsFallbackReason ?? null) !== (exp.limitsFallbackReason ?? null)
  ) {
    failures.push(
      `${label}: bfs limitsFallbackReason ${JSON.stringify(result.limitsFallbackReason ?? null)}, expected ${JSON.stringify(exp.limitsFallbackReason ?? null)}`,
    );
  }
}

/** Run the Python BFS Oracle over fixture files; returns spawnSync result + parsed output. */
export function runPythonBfsOracle(files, outPath, repeat = 1) {
  const run = spawnSync(
    "python3",
    [
      path.join(ROOT, BFS_ORACLE_REL),
      "--files",
      ...files,
      "--out",
      outPath,
      "--repeat",
      String(repeat),
    ],
    { cwd: ROOT, encoding: "utf8" },
  );
  let output = null;
  try {
    output = JSON.parse(fs.readFileSync(outPath, "utf8"));
  } catch {
    output = null;
  }
  return { code: run.status, stdout: run.stdout ?? "", stderr: run.stderr ?? "", output };
}

/** Run the Python Geometry Oracle over fixture files; returns spawnSync result + parsed output. */
export function runPythonGeometryOracle(files, outPath, repeat = 1) {
  const run = spawnSync(
    "python3",
    [
      path.join(ROOT, GEOMETRY_ORACLE_REL),
      "--files",
      ...files,
      "--out",
      outPath,
      "--repeat",
      String(repeat),
    ],
    { cwd: ROOT, encoding: "utf8" },
  );
  let output = null;
  try {
    output = JSON.parse(fs.readFileSync(outPath, "utf8"));
  } catch {
    output = null;
  }
  return { code: run.status, stdout: run.stdout ?? "", stderr: run.stderr ?? "", output };
}

/** Run a repo script (node scripts/<name>) and return its spawnSync result. */
export function runNodeScript(name, args = []) {
  return spawnSync("node", [path.join(ROOT, "scripts", name), ...args], {
    cwd: ROOT,
    encoding: "utf8",
  });
}
