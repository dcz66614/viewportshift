#!/usr/bin/env node
/**
 * T009 acceptance runner: `npm run test:ui`.
 *
 * Asserts (all real checks; no hard-coded exit 0 anywhere):
 * - template switching: all four templates build VALID scenarios with
 *   distinct surface rects (domain `surfaceRectFor`);
 * - mode switching: the same chat-input "open" scenario evaluates in
 *   all three modes; resizes-visual and overlays-content FAIL while
 *   resizes-content does not fail the same way (mode behaviour differs);
 * - event-click sync: `timelineRows` / `selectedRow` return exactly
 *   the evaluation's step state and metrics for every index, and the
 *   initial row returns the initial state;
 * - status text: all five analysis statuses have distinct text labels
 *   containing the status code; `deriveAnalysisStatus` maps a
 *   predicate-firing replay to FAIL, an event-free scenario to PASS,
 *   a zero-area surface to INVALID, and an unknown mode to UNKNOWN;
 * - formatting: milli-px / milli-px^2 / milli-ratio render as CSS px
 *   values with integer math only;
 * - determinism: repeated scenario builds, replays, and BFS runs hash
 *   identically (canonical JSON);
 * - BFS witness: the default scenario yields a FAIL witness whose
 *   events replay through `evaluateGeometry` to the same first failed
 *   predicates; `witnessBeforeAfter` returns non-null states;
 * - no forbidden tokens (wall clock / randomness / timers /
 *   float formatting) in src/ui/**, src/render/**, src/App.tsx, and
 *   the render layer imports its intersection from the domain;
 * - real render smoke: `vite preview` serves dist/, and the cached
 *   chromium headless shell dumps DOM containing the no-phone notice,
 *   the lab disclaimer, the text status label, the template name, the
 *   timeline, and the witness panel; screenshots are written to
 *   handoff/T009/screenshots/ (three templates + timeline/witness)
 *   and are non-trivial files; the fail-closed render
 *   (?keyboardHeight=800&layoutHeight=400) shows the fail-closed
 *   notice and timeline empty state with zero "计算中…";
 * - P1-1 fail-closed UNKNOWN: the UI scenario constructor builds the
 *   keyboard-800 / layout-400 case, which must derive UNKNOWN with
 *   reason keyboard_height_out_of_range, zero timeline rows, and a
 *   null selected row; the render sources must no longer contain the
 *   combined loading condition and must carry the fail-closed notice
 *   (profile + selected moment) and the timeline empty state.
 *
 * Requires `npm run build` first (dist/ must exist). Exits 0 only
 * when every check passes.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import ts from "typescript";
import { FORBIDDEN_TOKENS, ROOT } from "./s0-lib.mjs";

const execFileAsync = promisify(execFile);
const UI_SEED = "P021-VIEWPORTSHIFT-S0-2026-11-10";
const SHOT_DIR = path.join(ROOT, "handoff", "T009", "screenshots");
const EVIDENCE_PATH = path.join(ROOT, "evidence", "ui", "UI_TEST.json");
const PREVIEW_PORT = 4173;

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond, extra = "") {
  if (cond) {
    passed++;
  } else {
    failed++;
    failures.push(`${name}${extra ? ` — ${extra}` : ""}`);
    console.error(`FAIL: ${name}${extra ? ` — ${extra}` : ""}`);
  }
}
function deepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && deepEqual(a[k], b[k]));
}
function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Transpile the domain + the UI logic module in-memory (t008 pattern). */
async function loadUiDomain() {
  const files = [
    "src/domain/types.ts",
    "src/domain/validate.ts",
    "src/domain/viewport-state.ts",
    "src/domain/modes.ts",
    "src/domain/geometry.ts",
    "src/domain/geometry-eval.ts",
    "src/domain/events.ts",
    "src/domain/bfs.ts",
    "src/domain/analysis-status.ts",
    "src/ui/scenario.ts",
  ];
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "viewportshift-t009-"));
  try {
    for (const relPath of files) {
      const source = fs.readFileSync(path.join(ROOT, relPath), "utf8");
      const transpiled = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
        reportDiagnostics: true,
      });
      const errors = (transpiled.diagnostics ?? []).filter(
        (d) => d.category === ts.DiagnosticCategory.Error,
      );
      if (errors.length > 0) {
        throw new Error(
          `${relPath} transpile errors: ` +
            errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, " ")).join("; "),
        );
      }
      const outText = transpiled.outputText.replace(
        /from\s+"([^"]+)\.ts"/g,
        (_m, p) => `from "./${path.basename(p)}.mjs"`,
      );
      fs.writeFileSync(path.join(tmpDir, `${path.basename(relPath, ".ts")}.mjs`), outText);
    }
    const scenario = await import(pathToFileURL(path.join(tmpDir, "scenario.mjs")).href);
    const geometry = await import(pathToFileURL(path.join(tmpDir, "geometry.mjs")).href);
    const geometryEval = await import(pathToFileURL(path.join(tmpDir, "geometry-eval.mjs")).href);
    const bfs = await import(pathToFileURL(path.join(tmpDir, "bfs.mjs")).href);
    return { scenario, geometry, geometryEval, bfs };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function findHeadlessShell() {
  const candidates = [
    "chromium_headless_shell-1254",
    "chromium_headless_shell-1248",
  ];
  const cache = path.join(os.homedir(), ".cache", "ms-playwright");
  for (const dir of candidates) {
    const bin = path.join(cache, dir, "chrome-headless-shell-linux64", "chrome-headless-shell");
    if (fs.existsSync(bin)) return bin;
  }
  return null;
}

async function main() {
  const { scenario: ui, geometry, geometryEval, bfs } = await loadUiDomain();

  // ---- 1. template switching -------------------------------------------
  const surfaceRects = new Map();
  for (const template of ui.TEST_SET_TEMPLATES) {
    const params = { ...ui.DEFAULT_UI_PARAMS, template };
    const built = ui.buildScenario(params);
    const validated = ui.validateUiScenario(built);
    check(`template ${template} validates VALID`, validated.outcome === "VALID",
      JSON.stringify(validated.issues));
    check(`template ${template} carries frozen seed`, built.seed === UI_SEED);
    check(`template ${template} carries schema unit`, built.unit === "css-px-milli");
    const ev = ui.replayScenario(built, sha256Hex(ui.canonicalScenarioJson(built)));
    check(`template ${template} replays`, ev.initialState !== null);
    if (ev.initialState !== null) {
      const surface = geometry.surfaceRectFor(built.layout, ev.initialState);
      surfaceRects.set(template, JSON.stringify(surface));
    }
  }
  check("four templates have distinct surface rects", new Set(surfaceRects.values()).size === 4);
  check("three synthetic UI templates are the first three of the test set",
    JSON.stringify(ui.UI_TEMPLATES) === JSON.stringify(["chat-input", "bottom-sheet", "fixed-cta"]));

  // ---- 2. mode switching -------------------------------------------------
  const modeStatuses = {};
  const modeVisualHeights = {};
  for (const mode of ["resizes-visual", "resizes-content", "overlays-content"]) {
    const params = { ...ui.DEFAULT_UI_PARAMS, mode };
    const built = ui.buildScenario(params);
    const ev = ui.replayScenario(built, sha256Hex(ui.canonicalScenarioJson(built)));
    check(`mode ${mode} replays OK`, ev.status === "OK" && ev.steps.length === 1);
    modeStatuses[mode] = ui.deriveAnalysisStatus(ev);
    if (ev.steps.length === 1) {
      modeVisualHeights[mode] = ev.steps[0].state.visualHeight;
    }
  }
  check("resizes-visual chat-input open FAILs (matches S0 fixture)",
    modeStatuses["resizes-visual"] === "FAIL", JSON.stringify(modeStatuses));
  check("overlays-content chat-input open FAILs (keyboard covers the input)",
    modeStatuses["overlays-content"] === "FAIL", JSON.stringify(modeStatuses));
  check("resizes-content differs from resizes-visual (mode behaviour differs)",
    modeStatuses["resizes-content"] !== modeStatuses["resizes-visual"], JSON.stringify(modeStatuses));
  check("visual height differs across modes (544000 vs 844000 milli-px)",
    modeVisualHeights["resizes-visual"] === 544000 &&
      modeVisualHeights["overlays-content"] === 844000,
    JSON.stringify(modeVisualHeights));

  // ---- 3. event-click sync ------------------------------------------------
  const defaultScenario = ui.buildScenario(ui.DEFAULT_UI_PARAMS);
  const defaultSha = sha256Hex(ui.canonicalScenarioJson(defaultScenario));
  const ev0 = ui.replayScenario(defaultScenario, defaultSha);
  const rows = ui.timelineRows(ev0, defaultScenario);
  check("timeline has initial row + one row per step", rows.length === ev0.steps.length + 1);
  const initialRow = ui.selectedRow(rows, -1);
  check("initial row returns the initial state",
    initialRow !== null && deepEqual(initialRow.state, ev0.initialState));
  check("initial row metrics are computed by the domain",
    initialRow !== null && initialRow.metrics !== null && initialRow.metrics.visibleRatio === 1000);
  for (let i = 0; i < ev0.steps.length; i++) {
    const row = ui.selectedRow(rows, i);
    check(`click step ${i} syncs state`,
      row !== null && deepEqual(row.state, ev0.steps[i].state));
    check(`click step ${i} syncs metrics`,
      row !== null && deepEqual(row.metrics, ev0.steps[i].metrics));
    check(`click step ${i} syncs failed predicates`,
      row !== null && deepEqual(row.failedPredicates, ev0.steps[i].failedPredicates));
  }
  check("selecting an unknown index falls back to the first row",
    ui.selectedRow(rows, 99) !== null && ui.selectedRow(rows, 99).index === -1);

  // ---- 4. status text ------------------------------------------------------
  const labels = Object.values(ui.STATUS_LABELS);
  check("five status labels exist", labels.length === 5);
  check("status labels are distinct", new Set(labels).size === 5);
  for (const [code, label] of Object.entries(ui.STATUS_LABELS)) {
    check(`status label for ${code} contains the code`, label.includes(code));
  }
  check("predicate-firing replay derives FAIL",
    ui.deriveAnalysisStatus(ev0) === "FAIL");
  const noEventScenario = ui.buildScenario({ ...ui.DEFAULT_UI_PARAMS, sequenceId: "open" });
  noEventScenario.events = [];
  const evEmpty = ui.replayScenario(noEventScenario, sha256Hex(ui.canonicalScenarioJson(noEventScenario)));
  check("event-free scenario derives PASS", ui.deriveAnalysisStatus(evEmpty) === "PASS");
  const zeroArea = ui.buildScenario(ui.DEFAULT_UI_PARAMS);
  zeroArea.layout = { ...zeroArea.layout, heightMilli: 0 };
  const evZero = ui.replayScenario(zeroArea, sha256Hex(ui.canonicalScenarioJson(zeroArea)));
  check("zero-area surface derives INVALID", ui.deriveAnalysisStatus(evZero) === "INVALID");
  const badMode = ui.buildScenario(ui.DEFAULT_UI_PARAMS);
  badMode.mode = "not-a-mode";
  const evBadMode = ui.replayScenario(badMode, sha256Hex(ui.canonicalScenarioJson(badMode)));
  check("unknown mode derives UNKNOWN", ui.deriveAnalysisStatus(evBadMode) === "UNKNOWN");

  // ---- 5. formatting -------------------------------------------------------
  check("formatCssPx 390500 -> 390.5", ui.formatCssPx(390500) === "390.5");
  check("formatCssPx 390000 -> 390", ui.formatCssPx(390000) === "390");
  check("formatCssPx -1500 -> -1.5", ui.formatCssPx(-1500) === "-1.5");
  check("formatCssPx 0 -> 0", ui.formatCssPx(0) === "0");
  check("formatAreaCssPx2 21840000000 -> 21840", ui.formatAreaCssPx2(21840000000) === "21840");
  check("formatAreaCssPx2 1500500000 -> 1500.5", ui.formatAreaCssPx2(1500500000) === "1500.5");
  check("formatRatioPercent 1000 -> 100%", ui.formatRatioPercent(1000) === "100%");
  check("formatRatioPercent 500 -> 50%", ui.formatRatioPercent(500) === "50%");
  check("formatRatioPercent 625 -> 62.5%", ui.formatRatioPercent(625) === "62.5%");

  // ---- 6. determinism -------------------------------------------------------
  const builtA = ui.canonicalScenarioJson(ui.buildScenario(ui.DEFAULT_UI_PARAMS));
  const builtB = ui.canonicalScenarioJson(ui.buildScenario(ui.DEFAULT_UI_PARAMS));
  check("repeated scenario builds hash identically", sha256Hex(builtA) === sha256Hex(builtB));
  const replayA = sha256Hex(ui.canonicalScenarioJson(ui.replayScenario(defaultScenario, defaultSha)));
  const replayB = sha256Hex(ui.canonicalScenarioJson(ui.replayScenario(defaultScenario, defaultSha)));
  check("repeated replays hash identically", replayA === replayB);
  const bfsA = bfs.canonicalBfsJson(ui.runBfs(defaultScenario, defaultSha));
  const bfsB = bfs.canonicalBfsJson(ui.runBfs(defaultScenario, defaultSha));
  check("repeated BFS runs hash identically", sha256Hex(bfsA) === sha256Hex(bfsB));

  // ---- 7. BFS witness --------------------------------------------------------
  const bfsResult = ui.runBfs(defaultScenario, defaultSha);
  check("default scenario BFS status is FAIL", bfsResult.status === "FAIL",
    JSON.stringify({ status: bfsResult.status, reason: bfsResult.reason }));
  check("default BFS witness has length 1",
    bfsResult.witnessLength === 1 && bfsResult.witness !== null && bfsResult.witness.length === 1);
  check("default BFS witness starts with KEYBOARD_OPEN",
    bfsResult.witness !== null && bfsResult.witness[0].eventType === "KEYBOARD_OPEN");
  if (bfsResult.witness !== null) {
    const witnessScenario = ui.buildScenario(ui.DEFAULT_UI_PARAMS);
    witnessScenario.events = bfsResult.witness.map((step) => {
      const event = { type: step.eventType, id: step.eventId, atMs: step.atMs };
      if (step.params.keyboardHeight !== undefined) event.keyboardHeight = step.params.keyboardHeight;
      if (step.params.dx !== undefined) event.dx = step.params.dx;
      if (step.params.dy !== undefined) event.dy = step.params.dy;
      return event;
    });
    const witnessEval = ui.replayScenario(
      witnessScenario,
      sha256Hex(ui.canonicalScenarioJson(witnessScenario)),
    );
    const firstFailed = witnessEval.steps[bfsResult.firstFailedStepIndex ?? 0];
    check("replaying the witness reproduces the first failed predicates",
      firstFailed !== undefined &&
        deepEqual(firstFailed.failedPredicates, bfsResult.failedPredicates),
      JSON.stringify(firstFailed?.failedPredicates));
    const { before, after } = ui.witnessBeforeAfter(bfsResult);
    check("witness before/after states are non-null", before !== null && after !== null);
  }
  const invalidBfs = ui.runBfs(zeroArea, sha256Hex(ui.canonicalScenarioJson(zeroArea)));
  check("BFS on an invalid scenario returns INVALID with no witness",
    invalidBfs.status === "INVALID" && invalidBfs.witness === null);
  // Sweep: every template x mode search returns a defined status; any
  // BOUNDED_NO_WITNESS result must carry no witness.
  let boundedSeen = 0;
  for (const template of ui.TEST_SET_TEMPLATES) {
    for (const mode of ["resizes-visual", "resizes-content", "overlays-content"]) {
      const s = ui.buildScenario({ ...ui.DEFAULT_UI_PARAMS, template, mode });
      const r = ui.runBfs(s, sha256Hex(ui.canonicalScenarioJson(s)));
      check(`BFS ${template}/${mode} returns a defined status`,
        ["FAIL", "BOUNDED_NO_WITNESS", "UNKNOWN", "INVALID"].includes(r.status));
      if (r.status === "BOUNDED_NO_WITNESS") {
        boundedSeen++;
        check(`BOUNDED_NO_WITNESS ${template}/${mode} carries no witness`, r.witness === null);
      }
      if (r.status === "FAIL") {
        check(`FAIL ${template}/${mode} carries a witness`,
          r.witness !== null && r.witnessLength !== null && r.witnessLength >= 1);
      }
    }
  }
  check("sweep found at least one BOUNDED_NO_WITNESS case", boundedSeen >= 1,
    `boundedSeen=${boundedSeen}`);

  // ---- 8. forbidden tokens + no second algorithm -----------------------------
  const uiFiles = [
    "src/ui/scenario.ts",
    "src/ui/App.tsx",
    "src/ui/WitnessPanel.tsx",
    "src/ui/styles.css",
    "src/render/viewportSvg.tsx",
    "src/render/timeline.tsx",
    "src/App.tsx",
  ];
  for (const rel of uiFiles) {
    const text = fs.readFileSync(path.join(ROOT, rel), "utf8");
    for (const token of FORBIDDEN_TOKENS) {
      check(`no forbidden token ${token} in ${rel}`, !text.includes(token));
    }
  }
  const svgSource = fs.readFileSync(path.join(ROOT, "src/render/viewportSvg.tsx"), "utf8");
  check("SVG hot zone uses the domain rectIntersection",
    svgSource.includes("rectIntersection") && svgSource.includes("../domain/geometry"));
  const scenarioSource = fs.readFileSync(path.join(ROOT, "src/ui/scenario.ts"), "utf8");
  check("UI logic layer implements no geometry/state/search of its own",
    !scenarioSource.includes("function computeGeometry") &&
      !scenarioSource.includes("function transition") &&
      !scenarioSource.includes("function searchBfs"));

  // ---- 9. real render smoke (vite preview + cached headless shell) ----------
  check("dist/index.html exists (run npm run build first)",
    fs.existsSync(path.join(ROOT, "dist", "index.html")));
  const shell = findHeadlessShell();
  check("cached chromium headless shell is available", shell !== null);
  if (shell !== null && fs.existsSync(path.join(ROOT, "dist", "index.html"))) {
    const { spawn } = await import("node:child_process");
    const preview = spawn(
      "node",
      ["node_modules/vite/bin/vite.js", "preview", "--port", String(PREVIEW_PORT), "--strictPort", "--host", "127.0.0.1"],
      { cwd: ROOT, stdio: "ignore" },
    );
    try {
      let up = false;
      for (let i = 0; i < 60; i++) {
        try {
          const res = await fetch(`http://127.0.0.1:${PREVIEW_PORT}/`);
          if (res.ok) { up = true; break; }
        } catch {
          // not up yet
        }
        await sleep(500);
      }
      check("vite preview serves the built app", up);
      if (up) {
        const base = `http://127.0.0.1:${PREVIEW_PORT}/`;
        const { stdout: domDefault } = await execFileAsync(shell, [
          "--headless", "--disable-gpu", "--no-sandbox",
          "--dump-dom", "--virtual-time-budget=10000", base,
        ], { timeout: 60000, maxBuffer: 16 * 1024 * 1024 });
        for (const needle of [
          "不需要手机",
          "行为模型实验室，不是真实设备兼容性认证",
          "状态",
          "FAIL",
          "聊天输入框",
          "事件时间轴",
          "最短失败见证",
          "SVG 视口剖面",
          "CSS px",
          "UI-chat-input-resizes-visual",
          "P021-VIEWPORTSHIFT-S0-2026-11-10",
        ]) {
          check(`rendered DOM contains ${needle}`, domDefault.includes(needle));
        }
        const sheetUrl = `${base}?template=bottom-sheet&mode=overlays-content`;
        const { stdout: domSheet } = await execFileAsync(shell, [
          "--headless", "--disable-gpu", "--no-sandbox",
          "--dump-dom", "--virtual-time-budget=10000", sheetUrl,
        ], { timeout: 60000, maxBuffer: 16 * 1024 * 1024 });
        check("rendered DOM switches template via URL (?template=bottom-sheet)",
          domSheet.includes("UI-bottom-sheet-overlays-content") && domSheet.includes("底部面板"));

        // P1-1 fail-closed render smoke: keyboard 800 > layout height 400.
        // The evaluation is complete (UNKNOWN / keyboard_height_out_of_range),
        // so the DOM must show the fail-closed notice and the timeline empty
        // state, and must contain zero "计算中…" (no step buttons either).
        const failClosedUrl = `${base}?keyboardHeight=800&layoutHeight=400`;
        const { stdout: domFailClosed } = await execFileAsync(shell, [
          "--headless", "--disable-gpu", "--no-sandbox",
          "--dump-dom", "--virtual-time-budget=10000", failClosedUrl,
        ], { timeout: 60000, maxBuffer: 16 * 1024 * 1024 });
        for (const needle of [
          "UNKNOWN",
          "keyboard_height_out_of_range",
          "评估已完成，该场景超出模型范围，无法绘制视口剖面",
          "评估已完成",
          "无重放步骤",
          "时间轴为空",
        ]) {
          check(`fail-closed render contains ${needle}`, domFailClosed.includes(needle));
        }
        const computingCount = domFailClosed.split("计算中…").length - 1;
        check("fail-closed render contains zero “计算中…”",
          computingCount === 0, `count=${computingCount}`);
        check("fail-closed render has no timeline step buttons",
          !domFailClosed.includes("timeline-step-"));
        check("fail-closed render shows the fail-closed notice twice (profile + selected moment)",
          domFailClosed.split("fail-closed-notice").length - 1 >= 2,
          `occurrences=${domFailClosed.split("fail-closed-notice").length - 1}`);

        fs.mkdirSync(SHOT_DIR, { recursive: true });
        const shots = [
          { name: "template-chat-input.png", url: `${base}?template=chat-input&mode=resizes-visual`, size: "1280,1000" },
          { name: "template-bottom-sheet.png", url: `${base}?template=bottom-sheet&mode=overlays-content`, size: "1280,1000" },
          { name: "template-fixed-cta.png", url: `${base}?template=fixed-cta&mode=resizes-content`, size: "1280,1000" },
          { name: "timeline-witness.png", url: `${base}?template=chat-input&mode=resizes-visual&sequence=open-pan-settled`, size: "1280,1900" },
        ];
        const shotHashes = {};
        for (const shot of shots) {
          const out = path.join(SHOT_DIR, shot.name);
          await execFileAsync(shell, [
            "--headless", "--disable-gpu", "--no-sandbox",
            `--screenshot=${out}`, `--window-size=${shot.size}`,
            "--virtual-time-budget=10000", "--hide-scrollbars", shot.url,
          ], { timeout: 60000, maxBuffer: 16 * 1024 * 1024 });
          const stat = fs.existsSync(out) ? fs.statSync(out) : null;
          check(`screenshot ${shot.name} is a non-trivial file`,
            stat !== null && stat.size > 10000, stat === null ? "missing" : `size=${stat.size}`);
          if (stat !== null) shotHashes[shot.name] = sha256Hex(fs.readFileSync(out));
        }
        fs.mkdirSync(path.dirname(EVIDENCE_PATH), { recursive: true });
        fs.writeFileSync(
          EVIDENCE_PATH,
          `${JSON.stringify({ assertions: passed + failed, passed, failed, screenshots: shotHashes }, null, 2)}\n`,
          "utf8",
        );
      }
    } finally {
      preview.kill("SIGTERM");
      await sleep(500);
      if (preview.exitCode === null) preview.kill("SIGKILL");
    }
  }

  // ---- 10. P1-1 fail-closed UNKNOWN (keyboard 800 > layout height 400) --
  // The UI scenario constructor builds the exact review-reproduction case:
  // keyboard height 800 CSS px against a 400 CSS px layout viewport.
  const failClosedParams = {
    ...ui.DEFAULT_UI_PARAMS,
    keyboardHeightCssPx: 800,
    layoutHeightCssPx: 400,
  };
  const failClosedScenario = ui.buildScenario(failClosedParams);
  const failClosedSha = sha256Hex(ui.canonicalScenarioJson(failClosedScenario));
  const failClosedEval = ui.replayScenario(failClosedScenario, failClosedSha);
  check("fail-closed keyboard 800 / layout 400 derives UNKNOWN",
    ui.deriveAnalysisStatus(failClosedEval) === "UNKNOWN",
    JSON.stringify({ status: failClosedEval.status, reason: failClosedEval.reason }));
  check("fail-closed evaluation carries reason keyboard_height_out_of_range",
    failClosedEval.reason === "keyboard_height_out_of_range",
    String(failClosedEval.reason));
  check("fail-closed evaluation has no initial state and no steps",
    failClosedEval.initialState === null && failClosedEval.steps.length === 0);
  const failClosedRows = ui.timelineRows(failClosedEval, failClosedScenario);
  check("fail-closed timeline has zero rows", failClosedRows.length === 0);
  check("fail-closed selected row is null (the exact condition the UI branches on)",
    ui.selectedRow(failClosedRows, -1) === null);
  // Render-logic checks: the P1-1 bug was the combined loading condition
  // `result === null || row === null || row.state === null`, which showed
  // "计算中…" for a completed fail-closed evaluation. The loading text must
  // now be gated on `result === null` only, and the fail-closed notice /
  // timeline empty state must exist in the render sources.
  const appSource = fs.readFileSync(path.join(ROOT, "src/ui/App.tsx"), "utf8");
  check("P1-1 bug pattern is gone (no combined result/row/state loading condition)",
    !appSource.includes("result === null || row === null || row.state === null"));
  check("SVG profile shows the fail-closed notice with status, reason and the completed-evaluation sentence",
    appSource.includes("评估已完成，该场景超出模型范围，无法绘制视口剖面") &&
      appSource.includes("fail-closed-notice") &&
      appSource.includes("result.evaluation.reason"));
  check("fail-closed notice is rendered in both the profile and the selected-moment sections",
    (appSource.match(/<FailClosedNotice/g) ?? []).length === 2);
  const timelineSource = fs.readFileSync(path.join(ROOT, "src/render/timeline.tsx"), "utf8");
  check("timeline renders an explicit empty state when rows are empty",
    timelineSource.includes("timeline-empty-state") &&
      timelineSource.includes("评估已完成") &&
      timelineSource.includes("因 fail-closed") &&
      timelineSource.includes("无重放步骤"));

  console.log(`test:ui — ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error("Failures:");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`test:ui crashed: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  process.exit(1);
});
