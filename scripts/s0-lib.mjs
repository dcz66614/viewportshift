#!/usr/bin/env node
/**
 * Shared helpers for the T003 S0 scripts (s0:geometry / s0:oracle /
 * s0:determinism / s0:gate). No acceptance logic lives here — only
 * fixture loading, domain loading, canonical hashing and the Python
 * Oracle invocation. Every script exits non-zero on any failure; there
 * is no hard-coded `exit 0` shortcut anywhere in this directory.
 *
 * Output uses relative paths only and contains no timestamps, absolute
 * machine paths, or random values.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const FIXTURE_DIR_REL = "tests/fixtures/s0";
export const SEED = "P021-VIEWPORTSHIFT-S0-2026-11-10";
export const ANALYSIS_VERSION = "s0-geometry/v1";
export const ORACLE_REL = "oracle/python/geometry_oracle.py";

export const FORBIDDEN_TOKENS = [
  "Date.now",
  "setTimeout",
  "setInterval",
  "setImmediate",
  "Math.random",
  "randomUUID",
  "new Date(",
  "performance.now",
  "parseFloat",
  "Number.EPSILON",
  "toFixed",
];

export function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function rel(p) {
  return path.relative(ROOT, p).split(path.sep).join("/");
}

/** Fixture files in deterministic order: 48 main + 5 edge cases. */
export function listFixtures() {
  const dir = path.join(ROOT, FIXTURE_DIR_REL);
  const main = fs
    .readdirSync(dir)
    .filter((f) => /^s0-geometry-\d+\.json$/.test(f))
    .sort()
    .map((f) => path.join(dir, f));
  const edge = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith("s0-edge-") && f.endsWith(".json"))
    .sort()
    .map((f) => path.join(dir, f));
  return { main, edge };
}

export function loadFixture(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/**
 * Transpile src/domain/*.ts in-memory (project's own TypeScript
 * devDependency; no new dependency, no network) and import the geometry
 * module. Import specifiers ending in `.ts` are rewritten to `.mjs` for
 * the temporary files. Returns { geometry, sources } where sources maps
 * relative path -> source text (for the forbidden-token scan).
 */
export async function loadDomain() {
  const files = ["src/domain/viewport-state.ts", "src/domain/geometry.ts"];
  const sources = {};
  for (const relPath of files) {
    sources[relPath] = fs.readFileSync(path.join(ROOT, relPath), "utf8");
  }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "viewportshift-s0-"));
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
        /from\s+"(\.[^"]+)\.ts"/g,
        (_m, p) => `from "${p}.mjs"`,
      );
      const base = path.basename(relPath, ".ts");
      fs.writeFileSync(path.join(tmpDir, `${base}.mjs`), outText);
    }
    const geometry = await import(
      pathToFileURL(path.join(tmpDir, "geometry.mjs")).href
    );
    return { geometry, sources };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Run the TypeScript analysis over fixtures (already parsed) and return
 * { core, analysisSha256 } where core = { results, seed, version }.
 * The scenario hash is sha256(canonical(fixture)) — the same definition
 * the Python Oracle uses internally.
 */
export function analyzeTs(geometry, fixtures) {
  const results = fixtures.map((fixture) => {
    const scenarioSha256 = sha256Hex(geometry.canonicalJson(fixture));
    return geometry.analyzeScenario(fixture, scenarioSha256);
  });
  const core = { results, seed: SEED, version: ANALYSIS_VERSION };
  return { core, analysisSha256: sha256Hex(geometry.canonicalJson(core)) };
}

/** Invoke the Python Oracle CLI. Returns { code, stdout, stderr, output }. */
export function runPythonOracle(files, outPath, repeat = 1) {
  const args = [
    ORACLE_REL,
    "--files",
    ...files.map((f) => rel(f)),
    "--out",
    rel(outPath),
    "--repeat",
    String(repeat),
  ];
  const proc = spawnSync("python3", args, {
    cwd: ROOT,
    encoding: "utf8",
  });
  let output = null;
  if (proc.status === 0 && fs.existsSync(outPath)) {
    output = JSON.parse(fs.readFileSync(outPath, "utf8"));
  }
  return {
    code: proc.status,
    stdout: (proc.stdout ?? "").trim(),
    stderr: (proc.stderr ?? "").trim(),
    output,
  };
}

export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/** Recursive field diff: returns dotted paths where a and b differ. */
export function diffPaths(a, b, prefix = "") {
  const diffs = [];
  if (a === b) return diffs;
  if (
    a === null ||
    b === null ||
    typeof a !== "object" ||
    typeof b !== "object"
  ) {
    diffs.push(`${prefix}: ts=${JSON.stringify(a)} py=${JSON.stringify(b)}`);
    return diffs;
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    diffs.push(`${prefix}: ts is ${Array.isArray(a) ? "array" : "object"}, py is ${Array.isArray(b) ? "array" : "object"}`);
    return diffs;
  }
  if (Array.isArray(a)) {
    if (a.length !== b.length) {
      diffs.push(`${prefix}.length: ts=${a.length} py=${b.length}`);
    }
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      diffs.push(...diffPaths(a[i], b[i], `${prefix}[${i}]`));
    }
    return diffs;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of [...keys].sort()) {
    const p = prefix ? `${prefix}.${key}` : key;
    if (!(key in a)) diffs.push(`${p}: missing in TS`);
    else if (!(key in b)) diffs.push(`${p}: missing in Python`);
    else diffs.push(...diffPaths(a[key], b[key], p));
  }
  return diffs;
}
