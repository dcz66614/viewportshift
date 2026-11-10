#!/usr/bin/env node
/**
 * Shared helpers for the T006 acceptance runners (`npm run test:events`,
 * `npm run test:event-order`, `npm run oracle:diff:events`). No
 * acceptance logic lives here — only domain loading (the T006 modules
 * transpiled in-memory with the project's own TypeScript devDependency,
 * same pattern as scripts/s0-lib.mjs, scripts/t004-lib.mjs and
 * scripts/t005-lib.mjs), fixture loading, the Python Events Oracle
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

export const EVENTS_FIXTURE_DIR_REL = "tests/fixtures/events";
export const EVENTS_ORACLE_REL = "oracle/python/events_oracle.py";
export const SEED = "P021-VIEWPORTSHIFT-S0-2026-11-10";
export const EVENTS_VERSION = "events/v1";

/** Event fixture files in deterministic order (sorted by file name). */
export function listEventsFixtures() {
  const dir = path.join(ROOT, EVENTS_FIXTURE_DIR_REL);
  return fs
    .readdirSync(dir)
    .filter((f) => f.startsWith("events-") && f.endsWith(".json"))
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
 * modes.ts + events.ts in-memory and import the events module. Import
 * specifiers ending in `.ts` are rewritten to `.mjs` for the temporary
 * files. Returns { events, sources } where sources maps relative path
 * -> source text (for the forbidden-token scan).
 */
export async function loadT006Domain() {
  const files = [
    "src/domain/types.ts",
    "src/domain/validate.ts",
    "src/domain/viewport-state.ts",
    "src/domain/modes.ts",
    "src/domain/events.ts",
  ];
  const sources = {};
  for (const relPath of files) {
    sources[relPath] = fs.readFileSync(path.join(ROOT, relPath), "utf8");
  }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "viewportshift-t006-"));
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
    const events = await import(
      pathToFileURL(path.join(tmpDir, "events.mjs")).href
    );
    return { events, sources };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Run the TypeScript events evaluation over fixtures (already parsed)
 * and return { core, analysisSha256 } where core =
 * { results, seed, version }. The scenario hash is
 * sha256(canonicalEventJson(fixture)) — the same definition the Python
 * Events Oracle uses internally.
 */
export function evaluateTs(events, fixtures) {
  const results = fixtures.map((fixture) => {
    const scenarioSha256 = sha256Hex(events.canonicalEventJson(fixture));
    return events.evaluateEvents(fixture, scenarioSha256);
  });
  const core = { results, seed: SEED, version: EVENTS_VERSION };
  return { core, analysisSha256: sha256Hex(events.canonicalEventJson(core)) };
}

/** Invoke the Python Events Oracle CLI. Returns { code, stdout, stderr, output }. */
export function runPythonEventsOracle(files, outPath, repeat = 1) {
  const args = [
    EVENTS_ORACLE_REL,
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
