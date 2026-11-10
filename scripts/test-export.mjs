#!/usr/bin/env node
/**
 * T010 acceptance runner: `npm run test:export`.
 *
 * Asserts (all real checks; no hard-coded exit 0 anywhere):
 * - JSON round-trip: the demo scenario and all 12 UI combinations
 *   (4 templates x 3 modes) satisfy export -> parse -> export
 *   byte-identical canonical JSON with identical SHA-256.
 * - Result round-trip: a replay + BFS envelope satisfies export ->
 *   parse -> export byte-identical; a tampered scenarioSha256 is
 *   rejected with import_hash_mismatch and a tampered mode is
 *   rejected.
 * - Fail-closed import: malformed JSON, non-object roots, oversize
 *   documents, over-deep nesting, over-large node counts, duplicate
 *   event ids, over-limit event counts, and unit-suffixed strings
 *   are all rejected; a document padded to exactly the byte limit
 *   still imports.
 * - Hostile strings are data, never code: a scenario id containing
 *   a script tag and a seed containing eval / Function text import
 *   as inert data, and the report renders them escaped (no
 *   `<script` in the document, `&lt;script&gt;` present).
 * - Offline HTML report: the demo report contains the scenario id,
 *   mode, seed, text status, SVG viewport profile, timeline rows,
 *   witness, shortest failing sequence, and key numbers (21840 CSS
 *   px^2 obscured, 0% visible); `findExternalReferences` returns []
 *   and the document contains no script / link / img element and no
 *   remote reference.
 * - Demo artifacts: `node dist/viewportshift.mjs demo` exits 0 twice
 *   with identical hashes; the manifest hashes equal independently
 *   recomputed SHA-256 digests of the files; the result JSON file is
 *   canonical and re-imports cleanly.
 * - Forbidden tokens: src/io/** contains no Date.now / Math.random /
 *   timers / fetch / network tokens.
 *
 * Writes evidence/io/EXPORT_TEST.json (canonical core + hash).
 * Exits 0 only when every check passes.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  DEMO_JSON_REL,
  DEMO_MANIFEST_REL,
  DEMO_REPORT_REL,
  EVIDENCE_REL,
  IO_FORBIDDEN_TOKENS,
  ROOT,
  loadT010,
  rel,
  sha256Hex,
  writeJson,
} from "./t010-lib.mjs";

const failures = [];
const passes = [];
let checks = 0;

function check(name, condition, detail = "") {
  checks += 1;
  if (condition) {
    passes.push(name);
  } else {
    failures.push(`${name}${detail === "" ? "" : ` — ${detail}`}`);
  }
}

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

// The loader is async; keep the runner in one async function.
async function run() {
  const { geometry, geometryEval, bfs, scenario, ioJson, ioReport, ioDemo, sources } =
    await loadT010();

  // ---- 1. Scenario round-trip: demo + 12 UI combinations. ----
  const demoScenario = ioDemo.buildDemoScenario();
  const demoExport = ioJson.exportScenarioJson(demoScenario);
  check("roundtrip: demo scenario exports", demoExport.ok === true);
  if (demoExport.ok) {
    const reparsed = ioJson.parseScenarioJson(demoExport.json);
    check("roundtrip: demo scenario re-imports", reparsed.ok === true);
    if (reparsed.ok) {
      const reexported = ioJson.exportScenarioJson(reparsed.scenario);
      check(
        "roundtrip: demo scenario export->parse->export identical",
        reexported.ok === true && reexported.json === demoExport.json,
      );
      check(
        "roundtrip: demo scenario hash stable",
        sha256Hex(demoExport.json) ===
          sha256Hex(reexported.ok ? reexported.json : ""),
      );
    }
  }

  let combos = 0;
  for (const template of scenario.TEST_SET_TEMPLATES) {
    for (const mode of ["resizes-visual", "resizes-content", "overlays-content"]) {
      const built = scenario.buildScenario({
        ...scenario.DEFAULT_UI_PARAMS,
        template,
        mode,
      });
      const first = ioJson.exportScenarioJson(built);
      check(`roundtrip: ${template}/${mode} exports`, first.ok === true);
      if (!first.ok) continue;
      const parsed = ioJson.parseScenarioJson(first.json);
      check(`roundtrip: ${template}/${mode} re-imports`, parsed.ok === true);
      if (!parsed.ok) continue;
      const second = ioJson.exportScenarioJson(parsed.scenario);
      check(
        `roundtrip: ${template}/${mode} export->parse->export identical`,
        second.ok === true && second.json === first.json,
      );
      combos += 1;
    }
  }
  check("roundtrip: 12 UI combinations covered", combos === 12);

  // ---- 2. Result round-trip + tamper rejection. ----
  const scenarioSha256 = sha256Hex(demoExport.json);
  const evaluation = geometryEval.evaluateGeometry(demoScenario, scenarioSha256);
  const bfsResult = bfs.searchBfs(demoScenario, scenarioSha256);
  const status = scenario.deriveAnalysisStatus(evaluation);
  check("result: demo replay status is FAIL", status === "FAIL");
  const envelope = ioJson.buildResultEnvelope(
    ioJson.parseScenarioJson(demoExport.json).scenario,
    scenarioSha256,
    status,
    evaluation,
    bfsResult,
  );
  const resultExport = ioJson.exportResultJson(envelope);
  check("result: envelope exports", resultExport.ok === true);
  if (resultExport.ok) {
    const reparsed = ioJson.parseResultJson(resultExport.json, sha256Hex);
    check("result: envelope re-imports", reparsed.ok === true);
    if (reparsed.ok) {
      const reexported = ioJson.exportResultJson(reparsed.envelope);
      check(
        "result: envelope export->parse->export identical",
        reexported.ok === true && reexported.json === resultExport.json,
      );
    }
    const tamperedObj = JSON.parse(resultExport.json);
    tamperedObj.scenarioSha256 = "0".repeat(64);
    const tamperedHash = ioJson.canonicalExportJson(tamperedObj);
    const tamperedHashParsed = ioJson.parseResultJson(tamperedHash, sha256Hex);
    check(
      "result: tampered scenarioSha256 is rejected",
      tamperedHashParsed.ok === false &&
        tamperedHashParsed.issues.some((i) => i.code === "import_hash_mismatch"),
    );
    const tamperedModeObj = JSON.parse(resultExport.json);
    tamperedModeObj.scenario.mode = "resizes-visual";
    const tamperedMode = ioJson.canonicalExportJson(tamperedModeObj);
    check(
      "result: tampered mode is rejected",
      ioJson.parseResultJson(tamperedMode, sha256Hex).ok === false,
    );
  }

  // ---- 3. Fail-closed imports. ----
  const expectFail = (name, text) => {
    const r = ioJson.parseScenarioJson(text);
    check(name, r.ok === false && r.scenario === null);
    return r;
  };
  expectFail("failclosed: malformed JSON rejected", "{not json");
  expectFail("failclosed: empty string rejected", "");
  expectFail("failclosed: array root rejected", "[1,2,3]");
  expectFail("failclosed: string root rejected", '"hello"');
  expectFail("failclosed: number root rejected", "42");
  expectFail("failclosed: null root rejected", "null");
  const oversize = expectFail(
    "failclosed: oversize document rejected",
    " ".repeat(1_048_577),
  );
  check(
    "failclosed: oversize code is import_too_large",
    oversize.issues.some((i) => i.code === "import_too_large"),
  );
  const tooDeep = expectFail(
    "failclosed: over-deep nesting rejected",
    "[".repeat(40) + "]".repeat(40),
  );
  check(
    "failclosed: over-deep code is import_too_deep",
    tooDeep.issues.some((i) => i.code === "import_too_deep"),
  );
  const tooMany = expectFail(
    "failclosed: over-large node count rejected",
    `[${"0,".repeat(10001)}0]`,
  );
  check(
    "failclosed: over-large code is import_too_large",
    tooMany.issues.some((i) => i.code === "import_too_large"),
  );
  const dupIds = JSON.parse(JSON.stringify(demoScenario));
  dupIds.events.push({ ...dupIds.events[0] });
  const dupResult = ioJson.parseScenarioJson(JSON.stringify(dupIds));
  check(
    "failclosed: duplicate event id rejected",
    dupResult.ok === false &&
      dupResult.issues.some((i) => i.code === "duplicate_event_id"),
  );
  const tooManyEvents = JSON.parse(JSON.stringify(demoScenario));
  tooManyEvents.events = [];
  for (let i = 0; i < 9; i++) {
    tooManyEvents.events.push({
      type: "KEYBOARD_OPEN",
      id: `demo-x${i}`,
      atMs: 100 + i * 100,
      keyboardHeight: 300000,
    });
  }
  const limitResult = ioJson.parseScenarioJson(JSON.stringify(tooManyEvents));
  check(
    "failclosed: over-limit event count rejected",
    limitResult.ok === false &&
      limitResult.issues.some((i) => i.code === "event_limit_exceeded"),
  );
  const unitString = JSON.parse(JSON.stringify(demoScenario));
  unitString.viewport.layoutWidth = "390px";
  const unitResult = ioJson.parseScenarioJson(JSON.stringify(unitString));
  check(
    "failclosed: unit-suffixed string rejected",
    unitResult.ok === false &&
      unitResult.issues.some((i) => i.code === "illegal_unit"),
  );
  const badExport = ioJson.exportScenarioJson({ scenario_id: "x" });
  check("failclosed: export of invalid scenario fails", badExport.ok === false);

  // A document padded with whitespace to exactly the byte limit imports.
  const padded = demoExport.json + " ".repeat(1_048_576 - demoExport.json.length);
  check(
    "failclosed: document at exactly the byte limit imports",
    Buffer.byteLength(padded, "utf8") === 1_048_576 &&
      ioJson.parseScenarioJson(padded).ok === true,
  );

  // ---- 4. Hostile strings are data, never code. ----
  const hostile = JSON.parse(JSON.stringify(demoScenario));
  hostile.scenario_id = "<script>alert(1)</script>";
  hostile.seed = "eval(Function('x'))";
  const hostileImport = ioJson.parseScenarioJson(JSON.stringify(hostile));
  check("hostile: script-tag scenario id imports as data", hostileImport.ok === true);
  if (hostileImport.ok) {
    const hostileSha = sha256Hex(
      ioJson.exportScenarioJson(hostileImport.scenario).json,
    );
    const hostileEval = geometryEval.evaluateGeometry(
      hostileImport.scenario,
      hostileSha,
    );
    const hostileBfs = bfs.searchBfs(hostileImport.scenario, hostileSha);
    const hostileReport = ioReport.buildReportHtml({
      scenario: hostileImport.scenario,
      scenarioSha256: hostileSha,
      analysisStatus: scenario.deriveAnalysisStatus(hostileEval),
      evaluation: hostileEval,
      bfs: hostileBfs,
    });
    check(
      "hostile: report contains no script element",
      !/<\s*script/i.test(hostileReport),
    );
    check(
      "hostile: report escapes the script tag as text",
      hostileReport.includes("&lt;script&gt;alert(1)&lt;/script&gt;"),
    );
    check(
      "hostile: report external-reference scan is empty",
      ioReport.findExternalReferences(hostileReport).length === 0,
    );
  }

  // ---- 5. Offline HTML report for the demo analysis. ----
  const report = ioReport.buildReportHtml({
    scenario: ioJson.parseScenarioJson(demoExport.json).scenario,
    scenarioSha256,
    analysisStatus: status,
    evaluation,
    bfs: bfsResult,
  });
  check(
    "report: external-reference scan is empty",
    ioReport.findExternalReferences(report).length === 0,
  );
  check("report: no script element", !/<\s*script/i.test(report));
  check("report: no link element", !/<\s*link/i.test(report));
  check("report: no image element", !/<\s*img/i.test(report));
  check("report: no remote reference", !/https?:\/\//i.test(report));
  for (const needle of [
    "DEMO-chat-input-overlays-content",
    "overlays-content",
    "P021-VIEWPORTSHIFT-S0-2026-11-10",
    "FAIL",
    "21840",
    "0%",
    "KEYBOARD_OPEN",
    "demo-e1",
    "视口剖面",
    "事件时间轴",
    "最短失败序列",
    scenarioSha256,
  ]) {
    check(`report: contains ${needle}`, report.includes(needle));
  }
  check("report: contains inline SVG profile", report.includes("<svg"));

  // ---- 6. Demo artifacts: run twice, hashes identical + recomputable. ----
  const cliPath = path.join(ROOT, "dist", "viewportshift.mjs");
  check("demo: built CLI exists", fs.existsSync(cliPath));
  const runDemo = () =>
    execFileSync(process.execPath, [cliPath, "demo"], {
      cwd: ROOT,
      encoding: "utf8",
    });
  let firstRun = "";
  let secondRun = "";
  try {
    firstRun = runDemo();
    secondRun = runDemo();
    check("demo: first run exits 0", true);
    check("demo: second run exits 0", true);
  } catch {
    check("demo: runs exit 0", false, "spawn failed");
  }
  check(
    "demo: two runs print identical output",
    firstRun === secondRun && firstRun.includes("status=FAIL"),
  );
  const manifest = JSON.parse(read(DEMO_MANIFEST_REL));
  const resultText = read(DEMO_JSON_REL);
  const resultBody = resultText.endsWith("\n")
    ? resultText.slice(0, -1)
    : resultText;
  const reportText = read(DEMO_REPORT_REL);
  check(
    "demo: manifest scenarioSha256 recomputes",
    manifest.scenarioSha256 ===
      sha256Hex(ioJson.canonicalExportJson(JSON.parse(resultBody).scenario)),
  );
  check(
    "demo: manifest resultSha256 recomputes",
    manifest.resultSha256 === sha256Hex(resultBody),
  );
  check(
    "demo: manifest reportSha256 recomputes",
    manifest.reportSha256 === sha256Hex(reportText),
  );
  check(
    "demo: manifest lists all three files",
    JSON.stringify(manifest.files) ===
      JSON.stringify([
        "viewportshift-demo.json",
        "viewportshift-demo-report.html",
        "DEMO_MANIFEST.json",
      ]),
  );
  check(
    "demo: result JSON file is canonical",
    ioJson.canonicalExportJson(JSON.parse(resultBody)) === resultBody,
  );
  const artifactResult = ioJson.parseResultJson(resultBody, sha256Hex);
  check("demo: result JSON file re-imports", artifactResult.ok === true);
  check(
    "demo: report file external-reference scan is empty",
    ioReport.findExternalReferences(reportText).length === 0,
  );

  // ---- 7. Forbidden tokens in the io layer. ----
  for (const [relPath, source] of Object.entries(sources)) {
    if (!relPath.startsWith("src/io/")) continue;
    for (const token of IO_FORBIDDEN_TOKENS) {
      check(
        `forbidden: ${relPath} has no ${JSON.stringify(token)}`,
        !source.includes(token),
      );
    }
  }

  // ---- Evidence + verdict. ----
  const evidence = {
    ioVersion: "io/v1",
    checks,
    passed: passes.length,
    failed: failures.length,
    demoScenarioId: ioDemo.DEMO_SCENARIO_ID,
    demoScenarioSha256: scenarioSha256,
    demoResultSha256: manifest.resultSha256,
    demoReportSha256: manifest.reportSha256,
    demoAnalysisStatus: status,
    demoWitnessLength: bfsResult.witnessLength,
  };
  writeJson(EVIDENCE_REL, evidence);
  for (const name of passes) {
    process.stdout.write(`PASS ${name}\n`);
  }
  for (const name of failures) {
    process.stdout.write(`FAIL ${name}\n`);
  }
  process.stdout.write(
    `test:export: ${passes.length}/${checks} checks passed; evidence ${rel(path.join(ROOT, EVIDENCE_REL))}\n`,
  );
  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  process.stderr.write(`test:export: ERROR ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
