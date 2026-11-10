#!/usr/bin/env node
/**
 * Shared helpers for the T007 acceptance runners (`npm run
 * test:geometry`, `npm run oracle:diff:geometry`). No acceptance
 * logic lives here — only domain loading (the T007 modules transpiled
 * in-memory with the project's own TypeScript devDependency, same
 * pattern as scripts/s0-lib.mjs, scripts/t005-lib.mjs and
 * scripts/t006-lib.mjs), fixture loading, the Python Geometry Oracle
 * invocation, and canonical hashing.
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
import { FORBIDDEN_TOKENS, ROOT } from "./s0-lib.mjs";

export { FORBIDDEN_TOKENS, ROOT };

export const GEOMETRY_FIXTURE_DIR_REL = "tests/fixtures/geometry";
export const GEOMETRY_ORACLE_REL = "oracle/python/geometry_full_oracle.py";
export const SEED = "P021-VIEWPORTSHIFT-S0-2026-11-10";
export const GEOMETRY_VERSION = "geometry/v1";

/** Geometry fixture files in deterministic order (sorted by file name). */
export function listGeometryFixtures() {
  const dir = path.join(ROOT, GEOMETRY_FIXTURE_DIR_REL);
  return fs
    .readdirSync(dir)
    .filter((f) => f.startsWith("geometry-") && f.endsWith(".json"))
    .sort()
    .map((f) => path.join(dir, f));
}

export function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function rel(p) {
  return path.relative(ROOT, p).split(path.sep).join("/");
}

export function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Transpile src/domain/types.ts + validate.ts + viewport-state.ts +
 * modes.ts + geometry.ts + geometry-eval.ts in-memory and import the
 * geometry-eval module. Import specifiers ending in `.ts` are
 * rewritten to `.mjs` for the temporary files. Returns
 * { geometryEval, geometry, sources } where sources maps relative
 * path -> source text (for the forbidden-token scan).
 */
export async function loadT007Domain() {
  const files = [
    "src/domain/types.ts",
    "src/domain/validate.ts",
    "src/domain/viewport-state.ts",
    "src/domain/modes.ts",
    "src/domain/geometry.ts",
    "src/domain/geometry-eval.ts",
  ];
  const sources = {};
  for (const relPath of files) {
    sources[relPath] = fs.readFileSync(path.join(ROOT, relPath), "utf8");
  }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "viewportshift-t007-"));
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
    const geometryEval = await import(
      pathToFileURL(path.join(tmpDir, "geometry-eval.mjs")).href
    );
    const geometry = await import(
      pathToFileURL(path.join(tmpDir, "geometry.mjs")).href
    );
    return { geometryEval, geometry, sources };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Run the TypeScript geometry evaluation over fixtures (already
 * parsed) and return { core, analysisSha256 } where core =
 * { results, seed, version }. Direct (`kind: "direct"`) fixtures go
 * through the rect-level evaluator; scenario fixtures go through the
 * schema-first scenario evaluator. The fixture hash is
 * sha256(canonicalGeometryJson(fixture)) — the same definition the
 * Python Geometry Oracle uses internally.
 */
export function evaluateTs(geometryEval, fixtures) {
  const results = fixtures.map((fixture) => {
    const scenarioSha256 = sha256Hex(
      geometryEval.canonicalGeometryJson(fixture),
    );
    if (fixture.kind === "direct") {
      return geometryEval.evaluateDirectGeometry(fixture, scenarioSha256);
    }
    return geometryEval.evaluateGeometry(fixture, scenarioSha256);
  });
  const core = { results, seed: SEED, version: GEOMETRY_VERSION };
  return { core, analysisSha256: sha256Hex(geometryEval.canonicalGeometryJson(core)) };
}

/** Invoke the Python Geometry Oracle CLI. Returns { code, stdout, stderr, output }. */
export function runPythonGeometryOracle(files, outPath, repeat = 1) {
  const args = [
    GEOMETRY_ORACLE_REL,
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

/** Deep equality for JSON values (objects, arrays, scalars). */
export function deepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") {
    return false;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  const keysA = Object.keys(a).sort();
  const keysB = Object.keys(b).sort();
  return (
    keysA.length === keysB.length &&
    keysA.every((k, i) => k === keysB[i] && deepEqual(a[k], b[k]))
  );
}
