#!/usr/bin/env node
/**
 * Shared helpers for the T008 acceptance runners (`npm run
 * test:bfs`, `npm run test:bfs:determinism`). No acceptance logic
 * lives here — only domain loading (the T008 module transpiled
 * in-memory with the project's own TypeScript devDependency, same
 * pattern as scripts/t007-lib.mjs), fixture loading, and canonical
 * hashing.
 *
 * Every runner exits non-zero on any failure; there is no hard-coded
 * `exit 0` shortcut anywhere in this directory. Output uses relative
 * paths only and contains no timestamps, absolute machine paths, or
 * random values.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import { FORBIDDEN_TOKENS, ROOT } from "./s0-lib.mjs";

export { FORBIDDEN_TOKENS, ROOT };

export const BFS_FIXTURE_DIR_REL = "tests/fixtures/bfs";
export const SEED = "P021-VIEWPORTSHIFT-S0-2026-11-10";
export const BFS_VERSION = "bfs/v1";

/** BFS fixture files in deterministic order (sorted by file name). */
export function listBfsFixtures() {
  const dir = path.join(ROOT, BFS_FIXTURE_DIR_REL);
  return fs
    .readdirSync(dir)
    .filter((f) => f.startsWith("bfs-") && f.endsWith(".json"))
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
 * Transpile the T008 domain in-memory and import the BFS module.
 * Import specifiers ending in `.ts` are rewritten to `.mjs` for the
 * temporary files. Returns { bfs, geometryEval, geometry, events,
 * sources } where sources maps relative path -> source text (for the
 * forbidden-token scan).
 */
export async function loadT008Domain() {
  const files = [
    "src/domain/types.ts",
    "src/domain/validate.ts",
    "src/domain/viewport-state.ts",
    "src/domain/modes.ts",
    "src/domain/geometry.ts",
    "src/domain/geometry-eval.ts",
    "src/domain/events.ts",
    "src/domain/bfs.ts",
  ];
  const sources = {};
  for (const relPath of files) {
    sources[relPath] = fs.readFileSync(path.join(ROOT, relPath), "utf8");
  }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "viewportshift-t008-"));
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
    const bfs = await import(
      pathToFileURL(path.join(tmpDir, "bfs.mjs")).href
    );
    const geometryEval = await import(
      pathToFileURL(path.join(tmpDir, "geometry-eval.mjs")).href
    );
    const geometry = await import(
      pathToFileURL(path.join(tmpDir, "geometry.mjs")).href
    );
    const events = await import(
      pathToFileURL(path.join(tmpDir, "events.mjs")).href
    );
    return { bfs, geometryEval, geometry, events, sources };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Run the TypeScript BFS over fixtures (already parsed) and return
 * { core, analysisSha256 } where core = { results, seed, version }.
 * The fixture hash is sha256(canonicalBfsJson(fixture)) — the same
 * definition the geometry evaluator uses for scenario hashes.
 */
export function evaluateTsBfs(bfs, fixtures) {
  const results = fixtures.map((fixture) => {
    const scenarioSha256 = sha256Hex(bfs.canonicalBfsJson(fixture));
    return bfs.searchBfs(fixture, scenarioSha256);
  });
  const core = { results, seed: SEED, version: BFS_VERSION };
  return { core, analysisSha256: sha256Hex(bfs.canonicalBfsJson(core)) };
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
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  const keysA = Object.keys(a).sort();
  const keysB = Object.keys(b).sort();
  return (
    keysA.length === keysB.length &&
    keysA.every((k, i) => k === keysB[i] && deepEqual(a[k], b[k]))
  );
}
