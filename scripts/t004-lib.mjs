#!/usr/bin/env node
/**
 * Shared helpers for the T004 acceptance runners (`npm run test:schema`,
 * `npm run test:validation`). No acceptance logic lives here — only
 * domain loading (the T004 modules transpiled in-memory with the
 * project's own TypeScript devDependency, same pattern as
 * scripts/s0-lib.mjs), fixture loading, and the forbidden-token list.
 *
 * Every runner exits non-zero on any failure; there is no hard-coded
 * `exit 0` shortcut anywhere in this directory. Output uses relative
 * paths only and contains no timestamps, absolute machine paths, or
 * random values.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import { FORBIDDEN_TOKENS, ROOT } from "./s0-lib.mjs";

export { FORBIDDEN_TOKENS, ROOT };

export const SCHEMA_FIXTURE_DIR_REL = "tests/fixtures/schema";
export const SCHEMA_EXPECTED_REL =
  "tests/fixtures/schema/EXPECTED.json";

/** Fixture files in deterministic order (EXPECTED.json excluded). */
export function listSchemaFixtures() {
  const dir = path.join(ROOT, SCHEMA_FIXTURE_DIR_REL);
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json") && f !== "EXPECTED.json")
    .sort()
    .map((f) => path.join(dir, f));
}

export function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function rel(p) {
  return path.relative(ROOT, p).split(path.sep).join("/");
}

/**
 * Transpile src/domain/types.ts + validate.ts in-memory and import the
 * validate module. Import specifiers ending in `.ts` are rewritten to
 * `.mjs` for the temporary files. Returns { validate, types, sources }
 * where sources maps relative path -> source text (for the
 * forbidden-token scan).
 */
export async function loadT004Domain() {
  const files = ["src/domain/types.ts", "src/domain/validate.ts"];
  const sources = {};
  for (const relPath of files) {
    sources[relPath] = fs.readFileSync(path.join(ROOT, relPath), "utf8");
  }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "viewportshift-t004-"));
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
    const validate = await import(
      pathToFileURL(path.join(tmpDir, "validate.mjs")).href
    );
    const types = await import(
      pathToFileURL(path.join(tmpDir, "types.mjs")).href
    );
    return { validate, types, sources };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
