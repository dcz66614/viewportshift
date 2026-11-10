#!/usr/bin/env node
/**
 * Shared helpers for the T010 acceptance runner (`npm run
 * test:export`). No acceptance logic lives here — only domain + UI +
 * io loading (the modules transpiled in-memory with the project's
 * own TypeScript devDependency, same pattern as scripts/t008-lib.mjs),
 * fixture loading, and canonical hashing.
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

export const SEED = "P021-VIEWPORTSHIFT-S0-2026-11-10";
export const DEMO_OUT_REL = "demo-output";
export const DEMO_JSON_REL = "demo-output/viewportshift-demo.json";
export const DEMO_REPORT_REL = "demo-output/viewportshift-demo-report.html";
export const DEMO_MANIFEST_REL = "demo-output/DEMO_MANIFEST.json";
export const EVIDENCE_REL = "evidence/io/EXPORT_TEST.json";

/** Tokens that must never appear in the io layer (T010 contract). */
export const IO_FORBIDDEN_TOKENS = [
  "Date.now",
  "Math.random",
  "setTimeout",
  "setInterval",
  "setImmediate",
  "fetch(",
  "XMLHttpRequest",
  "WebSocket",
  "eval(",
  "new Function",
  "http://",
  "https://",
  "node:",
];

export function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function rel(p) {
  return path.relative(ROOT, p).split(path.sep).join("/");
}

/** Transpile the T010 module set in-memory and import it. */
export async function loadT010() {
  const files = [
    "src/domain/types.ts",
    "src/domain/viewport-state.ts",
    "src/domain/validate.ts",
    "src/domain/modes.ts",
    "src/domain/events.ts",
    "src/domain/geometry.ts",
    "src/domain/geometry-eval.ts",
    "src/domain/bfs.ts",
    "src/domain/analysis-status.ts",
    "src/ui/scenario.ts",
    "src/io/json.ts",
    "src/io/report.ts",
    "src/io/demo.ts",
  ];
  const sources = {};
  for (const relPath of files) {
    sources[relPath] = fs.readFileSync(path.join(ROOT, relPath), "utf8");
  }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "viewportshift-t010-"));
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
      // All modules are flattened into one directory: every `.ts`
      // import specifier is rewritten to the flat `<basename>.mjs`.
      const outText = transpiled.outputText.replace(
        /from\s+"([^"]+)\.ts"/g,
        (_m, spec) => `from "./${path.basename(spec)}.mjs"`,
      );
      const base = path.basename(relPath, ".ts");
      fs.writeFileSync(path.join(tmpDir, `${base}.mjs`), outText);
    }
    const load = async (name) =>
      import(pathToFileURL(path.join(tmpDir, `${name}.mjs`)).href);
    const [geometry, geometryEval, bfs, scenario, ioJson, ioReport, ioDemo] =
      await Promise.all([
        load("geometry"),
        load("geometry-eval"),
        load("bfs"),
        load("scenario"),
        load("json"),
        load("report"),
        load("demo"),
      ]);
    return { geometry, geometryEval, bfs, scenario, ioJson, ioReport, ioDemo, sources };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** Write an object as sorted-key canonical JSON text (no hash field). */
export function canonicalStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalStringify).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonicalStringify(value[k])}`)
    .join(",")}}`;
}

/** Write a JSON object as canonical (sorted-key) text. */
export function writeJson(relPath, value) {
  const full = path.join(ROOT, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, `${canonicalStringify(value)}\n`, "utf8");
}
