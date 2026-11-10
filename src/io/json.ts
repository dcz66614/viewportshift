/**
 * P021 ViewportShift — JSON import / export (T010, S3).
 *
 * Contract: P021_PROJECT_BOOK.md §3.3, §5.2, §6.1–§6.3, §9 and
 * P021_IMPLEMENTATION_PLAN.md §5 (T010), §6.
 *
 * What this module is: the only import/export path for scenario and
 * result JSON. It reuses the frozen domain validator
 * (`validateScenario`) and the frozen canonical JSON function
 * (`canonicalJson` from geometry.ts) — it implements no validation,
 * geometry, state-machine, or search logic of its own, and it never
 * executes input: imported text is parsed as JSON data only, and a
 * string that looks like code (for example one containing a script
 * tag) is inert data that is escaped again on the report path.
 *
 * Fail-closed import rules (every rejection carries a stable code):
 * - non-string input, malformed JSON, a document larger than
 *   MAX_IMPORT_BYTES, nesting deeper than MAX_IMPORT_DEPTH, or more
 *   than MAX_IMPORT_NODES values: rejected, nothing is evaluated.
 * - a scenario that the frozen validator rejects (INVALID / UNKNOWN):
 *   rejected with the validator's own issue codes, in order.
 * - a result envelope whose embedded scenario is not VALID, whose
 *   `scenarioSha256` does not equal the supplied hash of the
 *   canonical scenario JSON, or whose evaluation / BFS blocks do not
 *   agree with the scenario on id / seed / mode: rejected.
 *
 * Round-trip guarantee: `exportScenarioJson` emits canonical JSON of
 * the validator-normalized scenario, so
 * export -> parse -> export is byte-identical, and the SHA-256 of the
 * canonical JSON is recomputable by any caller. The same holds for
 * result envelopes through `exportResultJson` / `parseResultJson`.
 *
 * Envelope integrity (T011, T010 P2-1): `exportResultJson` no longer
 * trusts a caller-supplied `scenarioSha256` — it recomputes the hash
 * of the canonical validated scenario with the pure-TypeScript
 * SHA-256 below and rejects the export (`import_hash_mismatch`) when
 * the supplied value disagrees. The hash function is implemented in
 * this file (no Node built-in import) so the module stays usable in
 * the browser bundle; it is verified against Node's crypto SHA-256
 * by the T011 coverage runner.
 *
 * Pure functions only: no wall clock, no timers, no randomness, no
 * I/O, no network, no date/time access. Hashing lives with the
 * caller (the CLI / scripts supply the hash function, WebCrypto in
 * the browser) and is injected where a hash must be checked
 * (`parseResultJson` takes a `sha256Hex` function), so this file
 * stays usable in the browser bundle.
 */

import type { BfsSearchResult } from "../domain/bfs.ts";
import { canonicalJson } from "../domain/geometry.ts";
import type { GeometryEvaluation } from "../domain/geometry-eval.ts";
import {
  SCHEMA_VERSION,
  SCHEMA_SPEC_VERSION,
} from "../domain/types.ts";
import type {
  AnalysisStatus,
  Scenario,
  ValidationIssue,
} from "../domain/types.ts";
import { validateScenario } from "../domain/validate.ts";

export const IO_VERSION = "io/v1";

/** Largest accepted import document, in UTF-8 bytes (1 MiB). */
export const MAX_IMPORT_BYTES = 1_048_576;
/** Largest accepted JSON nesting depth (root counts as depth 1). */
export const MAX_IMPORT_DEPTH = 32;
/** Largest accepted number of JSON values (objects, arrays, scalars). */
export const MAX_IMPORT_NODES = 10_000;

export type ImportIssueCode =
  | "invalid_type"
  | "malformed_json"
  | "import_too_large"
  | "import_too_deep"
  | "import_hash_mismatch"
  | "import_envelope_mismatch"
  | ValidationIssue["code"];

export interface ImportIssue {
  code: ImportIssueCode;
  path: string;
  message: string;
}

export type ScenarioImportResult =
  | { ok: true; scenario: Scenario; issues: [] }
  | { ok: false; scenario: null; issues: Array<ImportIssue> };

export type ScenarioExportResult =
  | { ok: true; json: string; issues: [] }
  | { ok: false; json: null; issues: Array<ImportIssue> };

/** Frozen result envelope (v1): the T009 UI export shape + io fields. */
export interface ResultEnvelope {
  schemaVersion: typeof SCHEMA_VERSION;
  specVersion: typeof SCHEMA_SPEC_VERSION;
  ioVersion: typeof IO_VERSION;
  scenario: Scenario;
  scenarioSha256: string;
  analysisStatus: AnalysisStatus;
  evaluation: GeometryEvaluation;
  bfs: BfsSearchResult;
}

export type ResultImportResult =
  | { ok: true; envelope: ResultEnvelope; issues: [] }
  | { ok: false; envelope: null; issues: Array<ImportIssue> };

export type ResultExportResult =
  | { ok: true; json: string; issues: [] }
  | { ok: false; json: null; issues: Array<ImportIssue> };

const ANALYSIS_STATUSES: ReadonlyArray<string> = [
  "PASS",
  "FAIL",
  "UNKNOWN",
  "BOUNDED_NO_WITNESS",
  "INVALID",
];

function failIssue(
  code: ImportIssueCode,
  path: string,
  message: string,
): ImportIssue {
  return { code, path, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Iteratively walk a parsed JSON value (explicit stack, so hostile
 * nesting cannot overflow the call stack): reject depth beyond
 * MAX_IMPORT_DEPTH or a node count beyond MAX_IMPORT_NODES.
 */
function checkImportShape(
  value: unknown,
): ImportIssue | null {
  let nodes = 0;
  const stack: Array<{ value: unknown; depth: number }> = [
    { value, depth: 1 },
  ];
  while (stack.length > 0) {
    const item = stack.pop();
    if (item === undefined) break;
    nodes += 1;
    if (nodes > MAX_IMPORT_NODES) {
      return failIssue(
        "import_too_large",
        "$",
        `import exceeds ${MAX_IMPORT_NODES} JSON values`,
      );
    }
    if (item.depth > MAX_IMPORT_DEPTH) {
      return failIssue(
        "import_too_deep",
        "$",
        `import nesting exceeds depth ${MAX_IMPORT_DEPTH}`,
      );
    }
    if (Array.isArray(item.value)) {
      for (let i = item.value.length - 1; i >= 0; i--) {
        stack.push({ value: item.value[i], depth: item.depth + 1 });
      }
    } else if (isRecord(item.value)) {
      const keys = Object.keys(item.value);
      for (let i = keys.length - 1; i >= 0; i--) {
        stack.push({
          value: item.value[keys[i]],
          depth: item.depth + 1,
        });
      }
    }
  }
  return null;
}

/** Parse JSON text with the fail-closed size / depth / node limits. */
function parseImportJson(
  text: unknown,
): { ok: true; value: unknown } | { ok: false; issues: Array<ImportIssue> } {
  if (typeof text !== "string") {
    return {
      ok: false,
      issues: [
        failIssue("invalid_type", "$", "imported document must be a string"),
      ],
    };
  }
  const byteLength = new TextEncoder().encode(text).length;
  if (byteLength > MAX_IMPORT_BYTES) {
    return {
      ok: false,
      issues: [
        failIssue(
          "import_too_large",
          "$",
          `import is ${byteLength} bytes, above the ${MAX_IMPORT_BYTES} byte limit`,
        ),
      ],
    };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return {
      ok: false,
      issues: [
        failIssue("malformed_json", "$", "imported document is not valid JSON"),
      ],
    };
  }
  const shapeIssue = checkImportShape(value);
  if (shapeIssue !== null) {
    return { ok: false, issues: [shapeIssue] };
  }
  return { ok: true, value };
}

/**
 * Import one scenario from JSON text. Returns the validator-
 * normalized scenario on success; on any failure the scenario is
 * null and nothing downstream may run on the input.
 */
export function parseScenarioJson(text: unknown): ScenarioImportResult {
  const parsed = parseImportJson(text);
  if (!parsed.ok) {
    return { ok: false, scenario: null, issues: parsed.issues };
  }
  const validated = validateScenario(parsed.value);
  if (validated.outcome !== "VALID" || validated.scenario === null) {
    return {
      ok: false,
      scenario: null,
      issues: validated.issues.map((issue) => ({
        code: issue.code,
        path: issue.path,
        message: issue.message,
      })),
    };
  }
  return { ok: true, scenario: validated.scenario, issues: [] };
}

/**
 * Export a scenario as canonical JSON. The input is validated first
 * and the normalized scenario is exported, so the output is stable
 * under re-import.
 */
export function exportScenarioJson(value: unknown): ScenarioExportResult {
  const validated = validateScenario(value);
  if (validated.outcome !== "VALID" || validated.scenario === null) {
    return {
      ok: false,
      json: null,
      issues: validated.issues.map((issue) => ({
        code: issue.code,
        path: issue.path,
        message: issue.message,
      })),
    };
  }
  return { ok: true, json: canonicalJson(validated.scenario), issues: [] };
}

/** Canonical JSON for any export value (frozen domain function). */
export function canonicalExportJson(value: unknown): string {
  return canonicalJson(value);
}

/**
 * Pure-TypeScript SHA-256 (FIPS 180-4), operating on the UTF-8
 * encoding of the input. No Node built-in / WebCrypto dependency, so this
 * module stays browser-usable; the T011 coverage runner checks it
 * against Node's `crypto` SHA-256 on the demo scenario and on
 * multi-byte inputs. Only used to verify a result envelope's
 * `scenarioSha256` at export time (T010 P2-1).
 */
export function sha256HexPure(text: string): string {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b,
    0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
    0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7,
    0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
    0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152,
    0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
    0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
    0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
    0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f,
    0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const rotr = (x: number, n: number): number =>
    (x >>> n) | (x << (32 - n));
  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const bytes = new TextEncoder().encode(text);
  const bitLen = bytes.length * 8;
  const paddedLength = (((bytes.length + 9 + 63) >> 6) << 6);
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 4, bitLen >>> 0, false);
  view.setUint32(paddedLength - 8, Math.floor(bitLen / 4294967296), false);
  const w = new Array<number>(64);
  for (let block = 0; block < paddedLength; block += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(block + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[i] + w[i]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }
    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
    h5 = (h5 + f) | 0;
    h6 = (h6 + g) | 0;
    h7 = (h7 + h) | 0;
  }
  const hex = (n: number): string => (n >>> 0).toString(16).padStart(8, "0");
  return hex(h0) + hex(h1) + hex(h2) + hex(h3) + hex(h4) + hex(h5) + hex(h6) + hex(h7);
}

/** Build the frozen result envelope for one analysed scenario. */
export function buildResultEnvelope(
  scenario: Scenario,
  scenarioSha256: string,
  analysisStatus: AnalysisStatus,
  evaluation: GeometryEvaluation,
  bfs: BfsSearchResult,
): ResultEnvelope {
  return {
    schemaVersion: SCHEMA_VERSION,
    specVersion: SCHEMA_SPEC_VERSION,
    ioVersion: IO_VERSION,
    scenario,
    scenarioSha256,
    analysisStatus,
    evaluation,
    bfs,
  };
}

function checkEvaluationBlock(
  value: unknown,
  scenario: Scenario,
  issues: Array<ImportIssue>,
): void {
  if (!isRecord(value)) {
    issues.push(
      failIssue("invalid_type", "evaluation", "evaluation must be an object"),
    );
    return;
  }
  if (value.scenarioId !== scenario.scenario_id) {
    issues.push(
      failIssue(
        "import_envelope_mismatch",
        "evaluation.scenarioId",
        "evaluation.scenarioId does not match scenario.scenario_id",
      ),
    );
  }
  if (value.seed !== scenario.seed) {
    issues.push(
      failIssue(
        "import_envelope_mismatch",
        "evaluation.seed",
        "evaluation.seed does not match scenario.seed",
      ),
    );
  }
  if (value.mode !== scenario.mode) {
    issues.push(
      failIssue(
        "import_envelope_mismatch",
        "evaluation.mode",
        "evaluation.mode does not match scenario.mode",
      ),
    );
  }
  if (
    value.status !== "OK" &&
    value.status !== "UNKNOWN" &&
    value.status !== "INVALID"
  ) {
    issues.push(
      failIssue(
        "invalid_value" as ImportIssueCode,
        "evaluation.status",
        "evaluation.status must be OK, UNKNOWN, or INVALID",
      ),
    );
  }
  if (!Array.isArray(value.steps)) {
    issues.push(
      failIssue("invalid_type", "evaluation.steps", "evaluation.steps must be an array"),
    );
  }
}

function checkBfsBlock(
  value: unknown,
  scenario: Scenario,
  issues: Array<ImportIssue>,
): void {
  if (!isRecord(value)) {
    issues.push(
      failIssue("invalid_type", "bfs", "bfs must be an object"),
    );
    return;
  }
  if (value.scenarioId !== scenario.scenario_id) {
    issues.push(
      failIssue(
        "import_envelope_mismatch",
        "bfs.scenarioId",
        "bfs.scenarioId does not match scenario.scenario_id",
      ),
    );
  }
  if (value.seed !== scenario.seed) {
    issues.push(
      failIssue(
        "import_envelope_mismatch",
        "bfs.seed",
        "bfs.seed does not match scenario.seed",
      ),
    );
  }
  if (value.mode !== scenario.mode) {
    issues.push(
      failIssue(
        "import_envelope_mismatch",
        "bfs.mode",
        "bfs.mode does not match scenario.mode",
      ),
    );
  }
  if (
    value.status !== "FAIL" &&
    value.status !== "BOUNDED_NO_WITNESS" &&
    value.status !== "UNKNOWN" &&
    value.status !== "INVALID"
  ) {
    issues.push(
      failIssue(
        "invalid_value" as ImportIssueCode,
        "bfs.status",
        "bfs.status must be FAIL, BOUNDED_NO_WITNESS, UNKNOWN, or INVALID",
      ),
    );
  }
  if (value.witness !== null && !Array.isArray(value.witness)) {
    issues.push(
      failIssue(
        "invalid_type",
        "bfs.witness",
        "bfs.witness must be an array or null",
      ),
    );
  }
  if (typeof value.nodesVisited !== "number") {
    issues.push(
      failIssue(
        "invalid_type",
        "bfs.nodesVisited",
        "bfs.nodesVisited must be a number",
      ),
    );
  }
  if (!isRecord(value.limits)) {
    issues.push(
      failIssue("invalid_type", "bfs.limits", "bfs.limits must be an object"),
    );
  }
}

/**
 * Import one result envelope from JSON text. `sha256Hex` is the
 * caller's hash function (supplied by the CLI / scripts); the
 * envelope is accepted only when its `scenarioSha256` equals the hash
 * of the canonical JSON of its embedded scenario. Returns the
 * normalized envelope (rebuilt from the validated scenario, so
 * export -> parse -> export is byte-identical).
 */
export function parseResultJson(
  text: unknown,
  sha256Hex: (text: string) => string,
): ResultImportResult {
  const parsed = parseImportJson(text);
  if (!parsed.ok) {
    return { ok: false, envelope: null, issues: parsed.issues };
  }
  const issues: Array<ImportIssue> = [];
  if (!isRecord(parsed.value)) {
    return {
      ok: false,
      envelope: null,
      issues: [
        failIssue("invalid_type", "$", "result envelope must be an object"),
      ],
    };
  }
  const root = parsed.value;
  if (root.schemaVersion !== SCHEMA_VERSION) {
    issues.push(
      failIssue(
        "import_envelope_mismatch",
        "schemaVersion",
        `schemaVersion must be ${SCHEMA_VERSION}`,
      ),
    );
  }
  if (root.ioVersion !== IO_VERSION) {
    issues.push(
      failIssue(
        "import_envelope_mismatch",
        "ioVersion",
        `ioVersion must be ${IO_VERSION}`,
      ),
    );
  }
  if (
    typeof root.analysisStatus !== "string" ||
    !ANALYSIS_STATUSES.includes(root.analysisStatus)
  ) {
    issues.push(
      failIssue(
        "invalid_value" as ImportIssueCode,
        "analysisStatus",
        `analysisStatus must be one of: ${ANALYSIS_STATUSES.join(", ")}`,
      ),
    );
  }
  if (
    typeof root.scenarioSha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(root.scenarioSha256)
  ) {
    issues.push(
      failIssue(
        "invalid_value" as ImportIssueCode,
        "scenarioSha256",
        "scenarioSha256 must be a 64-character lowercase hex digest",
      ),
    );
  }
  const validated = validateScenario(root.scenario);
  if (validated.outcome !== "VALID" || validated.scenario === null) {
    for (const issue of validated.issues) {
      issues.push({
        code: issue.code,
        path: `scenario.${issue.path}`,
        message: issue.message,
      });
    }
    return { ok: false, envelope: null, issues };
  }
  const scenario = validated.scenario;
  if (
    typeof root.scenarioSha256 === "string" &&
    /^[0-9a-f]{64}$/.test(root.scenarioSha256) &&
    sha256Hex(canonicalJson(scenario)) !== root.scenarioSha256
  ) {
    issues.push(
      failIssue(
        "import_hash_mismatch",
        "scenarioSha256",
        "scenarioSha256 does not match the hash of the canonical scenario JSON",
      ),
    );
  }
  checkEvaluationBlock(root.evaluation, scenario, issues);
  checkBfsBlock(root.bfs, scenario, issues);
  if (issues.length > 0) {
    return { ok: false, envelope: null, issues };
  }
  const envelope = buildResultEnvelope(
    scenario,
    root.scenarioSha256 as string,
    root.analysisStatus as AnalysisStatus,
    root.evaluation as GeometryEvaluation,
    root.bfs as BfsSearchResult,
  );
  return { ok: true, envelope, issues: [] };
}

/**
 * Export a result envelope as canonical JSON. The embedded scenario
 * is validated and normalized first; the evaluation / BFS blocks pass
 * through unchanged, so a parsed envelope re-exports identically.
 * Envelope integrity (T011, T010 P2-1): the `scenarioSha256` is
 * recomputed from the canonical validated scenario with the
 * pure-TypeScript SHA-256 above and compared with the supplied
 * value — a mismatch rejects the export with
 * `import_hash_mismatch` instead of trusting the caller.
 */
export function exportResultJson(value: unknown): ResultExportResult {
  if (!isRecord(value)) {
    return {
      ok: false,
      json: null,
      issues: [
        failIssue("invalid_type", "$", "result envelope must be an object"),
      ],
    };
  }
  const validated = validateScenario(value.scenario);
  if (validated.outcome !== "VALID" || validated.scenario === null) {
    return {
      ok: false,
      json: null,
      issues: validated.issues.map((issue) => ({
        code: issue.code,
        path: `scenario.${issue.path}`,
        message: issue.message,
      })),
    };
  }
  const recomputedSha256 = sha256HexPure(canonicalJson(validated.scenario));
  if (
    typeof value.scenarioSha256 !== "string" ||
    value.scenarioSha256 !== recomputedSha256
  ) {
    return {
      ok: false,
      json: null,
      issues: [
        failIssue(
          "import_hash_mismatch",
          "scenarioSha256",
          "scenarioSha256 does not match the hash of the canonical scenario JSON",
        ),
      ],
    };
  }
  const envelope: ResultEnvelope = {
    schemaVersion: SCHEMA_VERSION,
    specVersion: SCHEMA_SPEC_VERSION,
    ioVersion: IO_VERSION,
    scenario: validated.scenario,
    scenarioSha256: value.scenarioSha256 as string,
    analysisStatus: value.analysisStatus as AnalysisStatus,
    evaluation: value.evaluation as GeometryEvaluation,
    bfs: value.bfs as BfsSearchResult,
  };
  return { ok: true, json: canonicalJson(envelope), issues: [] };
}
