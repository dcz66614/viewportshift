#!/usr/bin/env node
/**
 * T004 acceptance runner: `npm run test:schema`.
 *
 * Asserts the frozen `viewportshift.scenario/v1` contract:
 * - the frozen constants / enum sets / default limits in
 *   src/domain/types.ts match the spec exactly;
 * - the 50 schema fixtures under tests/fixtures/schema/ validate to
 *   exactly their EXPECTED.json outcome and error-code sequence;
 * - error codes are stable: validating the same input twice yields
 *   byte-identical issue lists;
 * - VALID fixtures normalize to a typed scenario with the frozen
 *   defaults filled; INVALID / UNKNOWN fixtures yield null scenario;
 * - the T004 domain sources contain no wall-clock / timer /
 *   randomness / float-comparison dependency.
 *
 * Exits 0 only when every check passes.
 */
import path from "node:path";
import {
  FORBIDDEN_TOKENS,
  ROOT,
  SCHEMA_EXPECTED_REL,
  loadJson,
  loadT004Domain,
  listSchemaFixtures,
  rel,
} from "./t004-lib.mjs";

const EXPECTED_FIXTURE_COUNT = 50;

const failures = [];
const passes = [];

function check(name, ok, detail) {
  if (ok) passes.push(name);
  else failures.push(detail ? `${name} — ${detail}` : name);
  return ok;
}

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function main() {
  const { validate, types, sources } = await loadT004Domain();
  for (const [relPath, source] of Object.entries(sources)) {
    for (const token of FORBIDDEN_TOKENS) {
      check(
        `no forbidden token in ${relPath} (${token})`,
        !source.includes(token),
        `${relPath} contains forbidden token ${token}`,
      );
    }
  }
  check(
    "validate module exports validateScenario",
    typeof validate.validateScenario === "function",
    "missing export",
  );

  // ---- Frozen constants (spec §6.1, §4.1, §4.5) ----
  check("SCHEMA_VERSION is viewportshift.scenario/v1",
    types.SCHEMA_VERSION === "viewportshift.scenario/v1",
    `got ${String(types.SCHEMA_VERSION)}`);
  check("SCHEMA_SPEC_VERSION is 1.0.0",
    types.SCHEMA_SPEC_VERSION === "1.0.0",
    `got ${String(types.SCHEMA_SPEC_VERSION)}`);
  check("SCHEMA_UNIT is css-px-milli",
    types.SCHEMA_UNIT === "css-px-milli",
    `got ${String(types.SCHEMA_UNIT)}`);
  check("VIEWPORT_MODES frozen (3 modes)",
    sameJson(types.VIEWPORT_MODES, [
      "resizes-visual",
      "resizes-content",
      "overlays-content",
    ]),
    `got ${JSON.stringify(types.VIEWPORT_MODES)}`);
  check("EVENT_TYPES frozen (5 types)",
    sameJson(types.EVENT_TYPES, [
      "KEYBOARD_OPEN",
      "KEYBOARD_CLOSE",
      "SCROLL",
      "DELAYED_VISUAL_PAN",
      "VIEWPORT_SETTLED",
    ]),
    `got ${JSON.stringify(types.EVENT_TYPES)}`);
  check("LAYOUT_TEMPLATES frozen (4 templates)",
    sameJson(types.LAYOUT_TEMPLATES, [
      "chat-input",
      "bottom-sheet",
      "fixed-cta",
      "search-bar",
    ]),
    `got ${JSON.stringify(types.LAYOUT_TEMPLATES)}`);
  check("DEFAULT_LIMITS frozen",
    sameJson(types.DEFAULT_LIMITS, {
      maxEvents: 8,
      maxPanMilli: 500000,
      maxDepth: 8,
      maxNodes: 10000,
      scale: 1,
    }),
    `got ${JSON.stringify(types.DEFAULT_LIMITS)}`);
  check("PREDICATE_FIELDS frozen (4 fields)",
    sameJson(types.PREDICATE_FIELDS, [
      "visibleRatio",
      "keyboardObscuredArea",
      "bottomGap",
      "anchorDriftMagnitude",
    ]),
    `got ${JSON.stringify(types.PREDICATE_FIELDS)}`);
  check("PREDICATE_OPS frozen (5 ops)",
    sameJson(types.PREDICATE_OPS, ["<", ">", "<=", ">=", "=="]),
    `got ${JSON.stringify(types.PREDICATE_OPS)}`);
  check("numeric bounds frozen",
    types.MAX_DIMENSION_MILLI === 10_000_000 &&
      types.MAX_AT_MS === 2_147_483_647 &&
      types.MAX_EVENTS_LIMIT === 64 &&
      types.MAX_DEPTH_LIMIT === 16 &&
      types.MAX_NODES_LIMIT === 1_000_000,
    "bound constant mismatch");

  // ---- Schema fixtures vs EXPECTED.json ----
  const files = listSchemaFixtures();
  check(
    `exactly ${EXPECTED_FIXTURE_COUNT} schema fixtures present`,
    files.length === EXPECTED_FIXTURE_COUNT,
    `found ${files.length}`,
  );
  const expected = loadJson(path.join(ROOT, SCHEMA_EXPECTED_REL));
  const expectedNames = Object.keys(expected).sort();
  const fileNames = files.map((f) => path.basename(f)).sort();
  check(
    "EXPECTED.json covers exactly the fixture files present",
    sameJson(expectedNames, fileNames),
    `manifest=${expectedNames.join(",")} files=${fileNames.join(",")}`,
  );

  for (const file of files) {
    const name = path.basename(file);
    const fixture = loadJson(file);
    const want = expected[name];
    const first = validate.validateScenario(fixture);
    const second = validate.validateScenario(fixture);
    const codes = first.issues.map((i) => i.code);
    check(
      `${name}: outcome is ${want.outcome}`,
      first.outcome === want.outcome,
      `outcome=${first.outcome} issues=${JSON.stringify(first.issues)}`,
    );
    check(
      `${name}: error codes are [${want.codes.join(", ")}] in order`,
      sameJson(codes, want.codes),
      `codes=${JSON.stringify(codes)}`,
    );
    check(
      `${name}: error codes stable across two runs`,
      sameJson(first.issues, second.issues) && first.outcome === second.outcome,
      "second run differed",
    );
    if (want.outcome === "VALID") {
      check(
        `${name}: VALID yields a normalized scenario`,
        first.scenario !== null,
        "scenario is null",
      );
      if (first.scenario !== null) {
        const s = first.scenario;
        check(
          `${name}: normalized scenario carries frozen unit + defaults`,
          s.unit === "css-px-milli" &&
            s.limits.maxDepth === 8 &&
            s.limits.maxNodes === 10000 &&
            s.limits.scale === 1 &&
            s.profile.scale === 1,
          `unit=${String(s.unit)} limits=${JSON.stringify(s.limits)} profile=${JSON.stringify(s.profile)}`,
        );
        check(
          `${name}: normalized scenario keeps scenario_id + seed`,
          s.scenario_id === fixture.scenario_id && s.seed === fixture.seed,
          "id/seed mismatch after normalization",
        );
      }
    } else {
      check(
        `${name}: ${want.outcome} yields null scenario`,
        first.scenario === null,
        "scenario is not null",
      );
    }
    console.log(
      `${rel(file)}: outcome=${first.outcome} codes=[${codes.join(", ")}]`,
    );
  }

  console.log(
    `\nchecks passed: ${passes.length}, checks failed: ${failures.length}`,
  );
  if (failures.length > 0) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(`- ${f}`);
    console.log("\ntest:schema: FAIL");
    process.exitCode = 1;
  } else {
    console.log("\ntest:schema: PASS");
    process.exitCode = 0;
  }
}

main().catch((err) => {
  console.error(`runner error: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
