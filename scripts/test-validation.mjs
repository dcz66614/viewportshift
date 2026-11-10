#!/usr/bin/env node
/**
 * T004 acceptance runner: `npm run test:validation`.
 *
 * S0 non-regression for the new schema validator:
 * - all 48 main S0 fixtures validate VALID with zero issues (their
 *   PASS/FAIL analysis outcomes are a T003 question; validation only
 *   says the inputs are well-formed and in-model);
 * - the 5 S0 edge fixtures classify exactly as their hand-authored
 *   expected_status, with the exact fail-closed code:
 *   clock regression -> event_clock_regression (UNKNOWN),
 *   keyboard too tall -> keyboard_height_out_of_range (UNKNOWN),
 *   scale 2 -> unsupported_scale (UNKNOWN),
 *   unknown mode -> unsupported_mode (UNKNOWN),
 *   zero-area surface -> zero_area_surface (INVALID);
 * - validation is deterministic (3 identical runs per fixture) and
 *   never mutates its input (JSON snapshot before/after identical);
 * - S0 fixtures normalize with the frozen defaults filled
 *   (maxDepth 8, maxNodes 10000, unit css-px-milli).
 *
 * This runner reads the S0 fixtures but never writes to them, the
 * Oracle, or evidence/s0/. Exits 0 only when every check passes.
 */
import path from "node:path";
import { listFixtures, loadFixture } from "./s0-lib.mjs";
import { loadT004Domain, rel } from "./t004-lib.mjs";

const EXPECTED_EDGE = {
  "S0-edge-clock-regression": {
    outcome: "UNKNOWN",
    codes: ["event_clock_regression"],
  },
  "S0-edge-keyboard-too-tall": {
    outcome: "UNKNOWN",
    codes: ["keyboard_height_out_of_range"],
  },
  "S0-edge-scale-2": {
    outcome: "UNKNOWN",
    codes: ["unsupported_scale"],
  },
  "S0-edge-unknown-mode": {
    outcome: "UNKNOWN",
    codes: ["unsupported_mode"],
  },
  "S0-edge-zero-area": {
    outcome: "INVALID",
    codes: ["zero_area_surface"],
  },
};

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
  const { validate } = await loadT004Domain();
  const { main, edge } = listFixtures();
  check("exactly 48 main S0 fixtures present", main.length === 48,
    `found ${main.length}`);
  check("exactly 5 edge S0 fixtures present", edge.length === 5,
    `found ${edge.length}: ${edge.map((f) => path.basename(f)).join(", ")}`);

  const mainFixtures = main.map(loadFixture);
  const edgeFixtures = edge.map(loadFixture);
  const allFixtures = [...mainFixtures, ...edgeFixtures];
  const allFiles = [...main, ...edge];

  let validMain = 0;
  for (let i = 0; i < allFixtures.length; i++) {
    const fixture = allFixtures[i];
    const file = allFiles[i];
    const label = fixture.scenario_id;
    const before = JSON.stringify(fixture);
    const first = validate.validateScenario(fixture);
    const second = validate.validateScenario(fixture);
    const third = validate.validateScenario(fixture);
    const codes = first.issues.map((issue) => issue.code);

    check(
      `${label}: validation deterministic across 3 runs`,
      sameJson(first, second) && sameJson(first, third),
      "runs differed",
    );
    check(
      `${label}: validator does not mutate its input`,
      JSON.stringify(fixture) === before,
      "input mutated",
    );

    if (i < mainFixtures.length) {
      check(
        `${label}: main S0 fixture validates VALID`,
        first.outcome === "VALID" && first.issues.length === 0,
        `outcome=${first.outcome} issues=${JSON.stringify(first.issues)}`,
      );
      check(
        `${label}: VALID yields a normalized scenario`,
        first.scenario !== null,
        "scenario is null",
      );
      if (first.scenario !== null) {
        validMain += 1;
        check(
          `${label}: normalized scenario fills frozen defaults`,
          first.scenario.unit === "css-px-milli" &&
            first.scenario.limits.maxDepth === 8 &&
            first.scenario.limits.maxNodes === 10000 &&
            first.scenario.limits.scale === 1 &&
            first.scenario.profile.scale === 1 &&
            first.scenario.limits.maxEvents === 8 &&
            first.scenario.limits.maxPanMilli === 500000,
          `unit=${String(first.scenario.unit)} limits=${JSON.stringify(first.scenario.limits)}`,
        );
      }
    } else {
      const want = EXPECTED_EDGE[label];
      check(
        `${label}: edge fixture outcome is ${want.outcome}`,
        first.outcome === want.outcome,
        `outcome=${first.outcome} issues=${JSON.stringify(first.issues)}`,
      );
      check(
        `${label}: edge fixture codes are [${want.codes.join(", ")}]`,
        sameJson(codes, want.codes),
        `codes=${JSON.stringify(codes)}`,
      );
      check(
        `${label}: edge outcome matches hand-authored expected_status`,
        first.outcome === fixture.expected_status,
        `outcome=${first.outcome} expected_status=${String(fixture.expected_status)}`,
      );
      check(
        `${label}: non-VALID edge yields null scenario`,
        first.scenario === null,
        "scenario is not null",
      );
    }
    console.log(
      `${rel(file)}: outcome=${first.outcome} codes=[${codes.join(", ")}]`,
    );
  }

  check("main S0 fixtures: 48/48 VALID", validMain === 48,
    `valid=${validMain}`);
  console.log(
    `\nchecks passed: ${passes.length}, checks failed: ${failures.length}`,
  );
  if (failures.length > 0) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(`- ${f}`);
    console.log("\ntest:validation: FAIL");
    process.exitCode = 1;
  } else {
    console.log("\ntest:validation: PASS");
    process.exitCode = 0;
  }
}

main().catch((err) => {
  console.error(`runner error: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
