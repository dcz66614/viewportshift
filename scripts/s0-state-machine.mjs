#!/usr/bin/env node
/**
 * T002 acceptance runner: `npm run s0:state-machine`.
 *
 * Loads the 8 deterministic state-machine PoC fixtures from
 * tests/fixtures/s0/state-machine-poc-*.json, replays each case through
 * src/domain/viewport-state.ts (transpiled in-memory via the project's own
 * TypeScript devDependency; no new dependency, no network), and asserts
 * every final-state field, the transition status/reason, and any pan
 * report. Each case is replayed twice and the canonical state JSON must
 * be identical (determinism). A static scan asserts the domain source
 * contains no wall-clock / timer / randomness dependency.
 *
 * Exits 0 only when every check passes; exits 1 otherwise. This script
 * never fabricates a pass: there is no hard-coded `exit 0` shortcut.
 *
 * Output uses relative paths only and contains no timestamps, absolute
 * machine paths, or random values.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DOMAIN_REL = "src/domain/viewport-state.ts";
const FIXTURE_DIR_REL = "tests/fixtures/s0";
const EXPECTED_POC_COUNT = 8;

const FORBIDDEN_TOKENS = [
  "Date.now",
  "setTimeout",
  "setInterval",
  "setImmediate",
  "Math.random",
  "randomUUID",
  "new Date(",
  "performance.now",
];

const failures = [];
const passes = [];

function check(name, ok, detail) {
  if (ok) {
    passes.push(name);
  } else {
    failures.push(detail ? `${name} — ${detail}` : name);
  }
  return ok;
}

function canonical(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
}

function fieldDiffs(actual, expected) {
  const diffs = [];
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    diffs.push(
      `state keys differ: actual=[${actualKeys.join(",")}] expected=[${expectedKeys.join(",")}]`,
    );
  }
  for (const key of expectedKeys) {
    const a = canonical(actual[key]);
    const e = canonical(expected[key]);
    if (a !== e) {
      diffs.push(`${key}: actual=${a} expected=${e}`);
    }
  }
  return diffs;
}

async function loadDomainModule() {
  const source = fs.readFileSync(path.join(ROOT, DOMAIN_REL), "utf8");
  for (const token of FORBIDDEN_TOKENS) {
    check(
      `no wall-clock/timer/random dependency (${token})`,
      !source.includes(token),
      `${DOMAIN_REL} contains forbidden token ${token}`,
    );
  }
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
    },
    reportDiagnostics: true,
  });
  const errors = (transpiled.diagnostics ?? []).filter(
    (d) => d.category === ts.DiagnosticCategory.Error,
  );
  check(
    "domain module transpiles without errors",
    errors.length === 0,
    errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, " ")).join("; "),
  );
  if (errors.length > 0) {
    return null;
  }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "viewportshift-s0-"));
  try {
    const tmpFile = path.join(tmpDir, "viewport-state.mjs");
    fs.writeFileSync(tmpFile, transpiled.outputText);
    return await import(pathToFileURL(tmpFile).href);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function main() {
  return loadDomainModule().then((domain) => {
    if (domain === null) {
      finish();
      return;
    }
    const { initialState, replay, canonicalStateJson } = domain;

    const fixtureFiles = fs
      .readdirSync(path.join(ROOT, FIXTURE_DIR_REL))
      .filter((f) => f.startsWith("state-machine-poc-") && f.endsWith(".json"))
      .sort();
    check(
      "exactly 8 PoC fixtures present",
      fixtureFiles.length === EXPECTED_POC_COUNT,
      `found ${fixtureFiles.length}: ${fixtureFiles.join(", ")}`,
    );

    const finalsById = new Map();
    let caseCount = 0;
    for (const file of fixtureFiles) {
      const rel = `${FIXTURE_DIR_REL}/${file}`;
      const fixture = JSON.parse(
        fs.readFileSync(path.join(ROOT, FIXTURE_DIR_REL, file), "utf8"),
      );
      for (const testCase of fixture.cases) {
        caseCount += 1;
        const label = `${fixture.id}/${testCase.name}`;
        const initial = initialState(
          fixture.initial.layoutWidth,
          fixture.initial.layoutHeight,
          fixture.mode,
        );
        const run1 = replay(initial, testCase.events, fixture.mode, testCase.profile);
        const run2 = replay(initial, testCase.events, fixture.mode, testCase.profile);
        check(
          `${label}: determinism (2 replays, 1 canonical state)`,
          canonicalStateJson(run1.state) === canonicalStateJson(run2.state),
          "replay 1 and replay 2 canonical states differ",
        );
        check(
          `${label}: status`,
          run1.status === testCase.expectedStatus,
          `status actual=${run1.status} expected=${testCase.expectedStatus}`,
        );
        check(
          `${label}: reason`,
          run1.reason === testCase.expectedReason,
          `reason actual=${JSON.stringify(run1.reason)} expected=${JSON.stringify(testCase.expectedReason)}`,
        );
        check(
          `${label}: failedEventId`,
          run1.failedEventId === testCase.expectedFailedEventId,
          `failedEventId actual=${JSON.stringify(run1.failedEventId)} expected=${JSON.stringify(testCase.expectedFailedEventId)}`,
        );
        const diffs = fieldDiffs(run1.state, testCase.expectedFinalState);
        check(
          `${label}: final state fields (${Object.keys(testCase.expectedFinalState).length} fields)`,
          diffs.length === 0,
          diffs.join(" | "),
        );
        const actualPan = run1.panReports.find((p) => p !== null) ?? null;
        check(
          `${label}: pan report`,
          canonical(actualPan) === canonical(testCase.expectedPanReport),
          `panReport actual=${JSON.stringify(actualPan)} expected=${JSON.stringify(testCase.expectedPanReport)}`,
        );
        finalsById.set(`${fixture.id}/${testCase.name}`, run1.state);
        console.log(
          `${label}: status=${run1.status} ` +
            `fields=${diffs.length === 0 ? "all-match" : "MISMATCH: " + diffs.join(" | ")} ` +
            `determinism=${canonicalStateJson(run1.state) === canonicalStateJson(run2.state) ? "identical" : "DIFFERS"}`,
        );
      }
      void rel;
    }

    // Cross-mode differentiation: the same open event must produce the
    // contracted three-way split (POC-01/02/03, same input trajectory).
    const rv = finalsById.get("POC-01-RV-OPEN/open-300");
    const rc = finalsById.get("POC-02-RC-OPEN/open-300");
    const oc = finalsById.get("POC-03-OC-OPEN/open-300");
    if (rv && rc && oc) {
      check(
        "three modes differ per contract (resizes-visual: layout 844000 / visual 544000)",
        rv.layoutHeight === 844000 && rv.visualHeight === 544000,
        `RV layoutHeight=${rv.layoutHeight} visualHeight=${rv.visualHeight}`,
      );
      check(
        "three modes differ per contract (resizes-content: layout 544000 / visual 544000)",
        rc.layoutHeight === 544000 && rc.visualHeight === 544000,
        `RC layoutHeight=${rc.layoutHeight} visualHeight=${rc.visualHeight}`,
      );
      check(
        "three modes differ per contract (overlays-content: layout 844000 / visual 844000)",
        oc.layoutHeight === 844000 && oc.visualHeight === 844000,
        `OC layoutHeight=${oc.layoutHeight} visualHeight=${oc.visualHeight}`,
      );
      check(
        "three modes differ per contract (keyboard rect identical across modes)",
        JSON.stringify(rv.keyboardRect) === JSON.stringify(rc.keyboardRect) &&
          JSON.stringify(rc.keyboardRect) === JSON.stringify(oc.keyboardRect),
        "keyboard rects differ across modes for the same open event",
      );
    } else {
      check("three-mode open PoCs available for differentiation check", false, "missing POC-01/02/03 finals");
    }

    console.log(
      `\nPoC fixtures: ${fixtureFiles.length}, cases: ${caseCount}, ` +
        `checks passed: ${passes.length}, checks failed: ${failures.length}`,
    );
    finish();
  });
}

function finish() {
  if (failures.length > 0) {
    console.log("\nFAILURES:");
    for (const f of failures) {
      console.log(`- ${f}`);
    }
    console.log("\nS0 state-machine: FAIL");
    process.exitCode = 1;
  } else {
    console.log("\nS0 state-machine: PASS");
    process.exitCode = 0;
  }
}

main().catch((err) => {
  console.error(`runner error: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
