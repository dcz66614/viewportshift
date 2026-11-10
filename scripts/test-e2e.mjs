#!/usr/bin/env node
/**
 * T012 acceptance runner: `npm run test:e2e`.
 *
 * Real-browser end-to-end over CDP (see scripts/e2e-lib.mjs for why
 * CDP is used instead of a Playwright npm package). Walks the full
 * UI chain — select layout → select mode → select sequence → replay
 * → timeline click → export — in a real Chromium, with real mouse
 * clicks and real keyboard events. Also closes the three mandatory
 * T009 leftovers: (1) a screenshot of the keyboard-visible SVG state
 * AFTER clicking a timeline step (with the red occlusion hot zone),
 * (2) automated click verification of the JSON export button (real
 * Blob download, canonical JSON re-verified in Node), (3) a real Tab
 * traversal assertion (focus order, Enter activation, ArrowDown in
 * the mode radio group).
 *
 * Requires `npm run build` first (dist/ must exist). Exits 0 only
 * when every check passes. Writes evidence/e2e/E2E_TEST.json and
 * screenshots to evidence/e2e/ (+ copies in handoff/T012/screenshots/).
 */
import fs from "node:fs";
import path from "node:path";
import {
  CdpBrowser,
  FROZEN_DEMO_RESULT_SHA256,
  ROOT,
  SEED,
  findChrome,
  loadUiDomain,
  makeHarness,
  sha256File,
  sha256Hex,
  sleep,
  startPreview,
  waitForDownload,
} from "./e2e-lib.mjs";

const PREVIEW_PORT = 4174;
const CDP_PORT = 9334;
const EVIDENCE_DIR = path.join(ROOT, "evidence", "e2e");
const SHOT_DIR = path.join(ROOT, "handoff", "T012", "screenshots");
const DOWNLOAD_DIR = path.join(EVIDENCE_DIR, "downloads");

const h = makeHarness("test:e2e");
const { check } = h;

function shotPath(name) {
  return path.join(EVIDENCE_DIR, name);
}

async function main() {
  check("dist/index.html exists (run npm run build first)",
    fs.existsSync(path.join(ROOT, "dist", "index.html")));

  // Playwright driver package is intentionally NOT a project
  // dependency (package.json must not change); verify that fact so
  // the report states the driver choice honestly.
  let playwrightInstalled = false;
  try {
    await import("playwright");
    playwrightInstalled = true;
  } catch {
    playwrightInstalled = false;
  }
  check("Playwright npm package is NOT installed (CDP driver is the honest fallback, not a silent substitution)",
    playwrightInstalled === false);

  const chromeBin = findChrome();
  check("a real Chromium binary is available for CDP", chromeBin !== null,
    chromeBin ?? "none found");
  if (chromeBin === null) {
    console.error("test:e2e: no Chromium binary found; cannot run E2E");
    process.exitCode = 1;
    return;
  }

  const { scenario } = await loadUiDomain();
  check("UI domain module loads (frozen seed)", scenario.UI_SEED === SEED);

  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
  for (const f of fs.readdirSync(DOWNLOAD_DIR)) fs.rmSync(path.join(DOWNLOAD_DIR, f), { force: true });

  const preview = await startPreview(PREVIEW_PORT);
  const origin = preview.base.slice(0, -1); // no trailing slash
  const browser = new CdpBrowser();
  let exportMethod = null;
  let exportFile = null;
  let exportText = null;
  let tabChain = [];
  try {
    await browser.launch(CDP_PORT, chromeBin);
    check("CDP browser reports a Chromium version", typeof browser.browserVersion === "string" && browser.browserVersion.length > 0, browser.browserVersion ?? "");

    const base = `${preview.base}?template=chat-input&mode=resizes-visual&sequence=open`;
    await browser.navigate(base);
    await browser.waitFor(
      `document.querySelector('[data-testid="scenario-id"]')?.textContent === 'UI-chat-input-resizes-visual' && document.querySelector('[data-testid="analysis-status"]')?.textContent.includes('FAIL')`,
      20000,
    );
    check("page loads: scenario id is UI-chat-input-resizes-visual",
      (await browser.evaluate(`document.querySelector('[data-testid="scenario-id"]').textContent`)) === "UI-chat-input-resizes-visual");
    check("page loads: default chat-input/resizes-visual/open derives FAIL",
      (await browser.evaluate(`document.querySelector('[data-testid="analysis-status"]').textContent`)).includes("FAIL"));
    check("no-phone notice is rendered", (await browser.evaluate(`document.body.innerText.includes('不需要手机')`)) === true);
    check("lab disclaimer is rendered (not a real-device certification)",
      (await browser.evaluate(`document.body.innerText.includes('行为模型实验室，不是真实设备兼容性认证')`)) === true);
    check("seed is the frozen seed",
      (await browser.evaluate(`document.body.innerText.includes('${SEED}')`)) === true);

    const shot1 = await browser.screenshot(shotPath("e2e-main-flow.png"));
    check("screenshot e2e-main-flow.png is non-trivial", shot1 > 10000, `size=${shot1}`);

    // ---- layout switch (real mouse click on a test-set button) ----
    await browser.clickElement(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '底部面板')`);
    await browser.waitFor(`document.querySelector('[data-testid="scenario-id"]')?.textContent === 'UI-bottom-sheet-resizes-visual'`, 10000);
    check("clicking test-set button switches layout to bottom-sheet",
      (await browser.evaluate(`document.querySelector('[data-testid="scenario-id"]').textContent`)) === "UI-bottom-sheet-resizes-visual");
    await browser.clickElement(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '聊天输入框')`);
    await browser.waitFor(`document.querySelector('[data-testid="scenario-id"]')?.textContent === 'UI-chat-input-resizes-visual'`, 10000);
    check("clicking test-set button switches layout back to chat-input",
      (await browser.evaluate(`document.querySelector('[data-testid="scenario-id"]').textContent`)) === "UI-chat-input-resizes-visual");

    // ---- mode switch (real mouse click on a mode radio) ----
    await browser.clickElement(`document.querySelector('input[name="mode"][value="overlays-content"]')`);
    await browser.waitFor(`document.body.innerText.includes('UI-chat-input-overlays-content')`, 10000);
    check("clicking the overlays-content radio switches mode",
      (await browser.evaluate(`document.querySelector('[data-testid="scenario-id"]').textContent`)) === "UI-chat-input-overlays-content");
    check("overlays-content chat-input open still derives FAIL",
      (await browser.evaluate(`document.querySelector('[data-testid="analysis-status"]').textContent`)).includes("FAIL"));
    await browser.clickElement(`document.querySelector('input[name="mode"][value="resizes-visual"]')`);
    await browser.waitFor(`document.querySelector('[data-testid="scenario-id"]')?.textContent === 'UI-chat-input-resizes-visual'`, 10000);
    check("clicking the resizes-visual radio switches mode back",
      (await browser.evaluate(`document.querySelector('[data-testid="scenario-id"]').textContent`)) === "UI-chat-input-resizes-visual");

    // ---- sequence switch (real keyboard: focus select, ArrowDown x2) ----
    await browser.evaluate(`document.querySelector('section[aria-label="事件序列"] select').focus()`);
    await browser.pressArrowDown();
    await browser.pressArrowDown();
    const seqValue = await browser.evaluate(`document.querySelector('section[aria-label="事件序列"] select').value`);
    check("ArrowDown x2 on the focused sequence select picks open-pan-settled",
      seqValue === "open-pan-settled", `value=${seqValue}`);
    const rowCount = await browser.evaluate(`document.querySelectorAll('[data-testid^="timeline-step-"]').length`);
    check("open-pan-settled timeline has initial row + 3 steps", rowCount === 4, `rows=${rowCount}`);

    // ---- timeline click: keyboard-visible SVG state (T009 leftover 1) ----
    // In resizes-visual the keyboard rect is drawn, but the red hot
    // zone is correctly ABSENT: the shrunken visual viewport
    // (0..544) no longer contains the bottom-anchored surface, so
    // surface ∩ keyboard ∩ visual is empty and the obscured area is
    // 0 (domain-verified: obscured=0, hotZone=null). The hot zone
    // renders in overlays-content, where the visual viewport stays
    // full height — so the click evidence is captured there.
    await browser.clickElement(`document.querySelector('[data-testid="timeline-step-0"]')`);
    await browser.waitFor(`document.querySelector('section[aria-label="选中时刻状态"] h2')?.textContent.includes('步骤 1')`, 10000);
    check("clicking timeline step 1 selects that moment",
      (await browser.evaluate(`document.querySelector('section[aria-label="选中时刻状态"] h2').textContent`)).includes("步骤 1"));
    const svgLabelRv = await browser.evaluate(`document.querySelector('[data-testid="viewport-svg"]').getAttribute('aria-label')`);
    check("SVG aria-label reports the keyboard as visible after the click (resizes-visual)",
      svgLabelRv !== null && svgLabelRv.includes("键盘可见"), svgLabelRv ?? "no svg");
    const svgRectsRv = await browser.evaluate(`(() => { const svg = document.querySelector('[data-testid="viewport-svg"]'); const rects = [...svg.querySelectorAll('rect')].map(r => r.getAttribute('fill')); return { keyboard: rects.includes('#475569'), hotZone: rects.includes('#dc2626'), count: rects.length }; })()`);
    check("SVG draws the keyboard rect (#475569) after the click (resizes-visual)", svgRectsRv.keyboard === true, JSON.stringify(svgRectsRv));
    const obscuredRv = await browser.evaluate(`(() => { const rows = [...document.querySelectorAll('section[aria-label="选中时刻状态"] table tbody tr')].map(tr => [...tr.children].map(td => td.textContent)); const row = rows.find(r => r[0] === '键盘遮挡面积'); return row ? row[1] : null; })()`);
    check("resizes-visual step 1 reports obscured area 0 (surface is outside the shrunken visual viewport — correct domain geometry)",
      obscuredRv === "0 CSS px²", `value=${obscuredRv}`);

    // Overlays-content: the visual viewport stays full height, so
    // the surface under the keyboard is inside it and the red
    // occlusion hot zone must render.
    await browser.clickElement(`document.querySelector('input[name="mode"][value="overlays-content"]')`);
    await browser.waitFor(`document.querySelector('[data-testid="scenario-id"]')?.textContent === 'UI-chat-input-overlays-content'`, 10000);
    await browser.clickElement(`document.querySelector('[data-testid="timeline-step-0"]')`);
    await browser.waitFor(`document.querySelector('section[aria-label="选中时刻状态"] h2')?.textContent.includes('步骤 1')`, 10000);
    const svgLabel = await browser.evaluate(`document.querySelector('[data-testid="viewport-svg"]').getAttribute('aria-label')`);
    check("SVG aria-label reports the keyboard as visible after the click (overlays-content)",
      svgLabel !== null && svgLabel.includes("键盘可见"), svgLabel ?? "no svg");
    const svgRects = await browser.evaluate(`(() => { const svg = document.querySelector('[data-testid="viewport-svg"]'); const rects = [...svg.querySelectorAll('rect')].map(r => r.getAttribute('fill')); return { keyboard: rects.includes('#475569'), hotZone: rects.includes('#dc2626'), count: rects.length }; })()`);
    check("SVG draws the keyboard rect (#475569) after the click (overlays-content)", svgRects.keyboard === true, JSON.stringify(svgRects));
    check("SVG draws the red occlusion hot zone (#dc2626) after the click (overlays-content)", svgRects.hotZone === true, JSON.stringify(svgRects));
    const momentText = await browser.evaluate(`document.querySelector('section[aria-label="选中时刻状态"]').innerText`);
    const obscuredOc = await browser.evaluate(`(() => { const rows = [...document.querySelectorAll('section[aria-label="选中时刻状态"] table tbody tr')].map(tr => [...tr.children].map(td => td.textContent)); const row = rows.find(r => r[0] === '键盘遮挡面积'); return row ? row[1] : null; })()`);
    check("selected-moment panel reports keyboard visible with obscured area 21840 CSS px² (overlays-content)",
      momentText.includes("键盘：可见") && obscuredOc === "21840 CSS px²",
      `obscured=${obscuredOc}`);
    const shot2 = await (async () => {
      // Scroll the SVG profile into view first: clicking the
      // timeline button scrolled the page down, so a plain screenshot
      // would show the timeline instead of the SVG with the hot zone.
      await browser.evaluate(`document.querySelector('[data-testid="viewport-svg"]').scrollIntoView({block:'start'})`);
      await sleep(300);
      return browser.screenshot(shotPath("e2e-keyboard-visible.png"));
    })();
    check("screenshot e2e-keyboard-visible.png is non-trivial", shot2 > 10000, `size=${shot2}`);
    // Back to resizes-visual for the compare table, witness and export.
    await browser.clickElement(`document.querySelector('input[name="mode"][value="resizes-visual"]')`);
    await browser.waitFor(`document.querySelector('[data-testid="scenario-id"]')?.textContent === 'UI-chat-input-resizes-visual'`, 10000);
    check("mode switched back to resizes-visual for export",
      (await browser.evaluate(`document.querySelector('[data-testid="scenario-id"]').textContent`)) === "UI-chat-input-resizes-visual");

    // ---- compare table + witness panel ----
    const compareRows = await browser.evaluate(`[...document.querySelectorAll('section[aria-label="四布局对比"] table tbody tr')].map(tr => tr.innerText)`);
    check("four-layout compare table has 4 rows in the current mode", compareRows.length === 4, JSON.stringify(compareRows));
    check("compare table covers all four test-set layouts",
      ["chat-input", "bottom-sheet", "fixed-cta", "search-bar"].every((t) => compareRows.some((r) => r.includes(t))));
    const bfsStatus = await browser.evaluate(`document.querySelector('[data-testid="bfs-status"]')?.textContent ?? ''`);
    check("witness panel reports the BFS status", bfsStatus.includes("FAIL"), bfsStatus);
    check("witness panel shows witness length 1",
      (await browser.evaluate(`document.body.innerText.includes('见证长度：1 个事件')`)) === true);

    // ---- export: real download (T009 leftover 2) ----
    await browser.session("Page.setDownloadBehavior", { behavior: "allow", downloadPath: DOWNLOAD_DIR });
    const beforeNames = fs.readdirSync(DOWNLOAD_DIR);
    await browser.clickElement(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('导出 JSON'))`);
    exportFile = await waitForDownload(DOWNLOAD_DIR, beforeNames, 10000);
    if (exportFile !== null) {
      exportMethod = "real-blob-download";
      exportText = fs.readFileSync(exportFile, "utf8");
    } else {
      // Fallback: intercept the Blob at creation (the real button
      // handler and real Blob construction still run; only the
      // download sink is captured). Recorded as such in evidence.
      exportMethod = "blob-capture-hook";
      await browser.evaluate(`(() => { window.__t012Export = null; const orig = URL.createObjectURL.bind(URL); URL.createObjectURL = (blob) => { blob.text().then(t => { window.__t012Export = t; }); return orig(blob); }; })()`);
      await browser.clickElement(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('导出 JSON'))`);
      await browser.waitFor(`window.__t012Export !== null && window.__t012Export.length > 100`, 10000);
      exportText = await browser.evaluate(`window.__t012Export`);
    }
    check("export produces downloadable content", exportText !== null && exportText.length > 100, `method=${exportMethod}`);
    let exported = null;
    try {
      exported = JSON.parse(exportText);
    } catch (e) {
      check("exported file parses as JSON", false, e.message);
    }
    if (exported !== null) {
      check("export envelope schemaVersion is viewportshift.scenario/v1",
        exported.schemaVersion === "viewportshift.scenario/v1");
      check("export scenarioSha256 recomputes from the canonical scenario JSON",
        exported.scenarioSha256 === sha256Hex(scenario.canonicalScenarioJson(exported.scenario)),
        `exported=${exported.scenarioSha256}`);
      check("export text is exactly the canonical export JSON (round-trip)",
        exportText === scenario.canonicalExportJson(exported));
      check("exported scenario validates VALID",
        scenario.validateUiScenario(exported.scenario).outcome === "VALID",
        JSON.stringify(scenario.validateUiScenario(exported.scenario).issues));
      check("export evaluation status is OK", exported.evaluation?.status === "OK");
      check("export BFS status is FAIL with witness length 1",
        exported.bfs?.status === "FAIL" && exported.bfs?.witnessLength === 1);
      check("export scenario id matches the on-screen scenario",
        exported.scenario?.scenario_id === "UI-chat-input-resizes-visual");
    }

    // ---- real Tab traversal (T009 leftover 3) ----
    await browser.navigate(base);
    await browser.waitFor(
      `document.querySelector('[data-testid="scenario-id"]')?.textContent === 'UI-chat-input-resizes-visual' && document.querySelector('[data-testid="analysis-status"]')?.textContent.includes('FAIL')`,
      20000,
    );
    const focusableExpr = `[...document.querySelectorAll('button,input,select')].filter(el => !el.disabled && el.getClientRects().length > 0)`;
    tabChain = [];
    let prevIndex = -1;
    let monotonic = true;
    let wrapped = false;
    // Walk the whole focus order (do NOT stop at the export button:
    // the timeline step buttons come after it in DOM order, and the
    // traversal must prove they are reachable by Tab too). Stop only
    // when focus wraps back to an earlier stop.
    for (let i = 0; i < 80; i++) {
      await browser.pressTab();
      const info = await browser.evaluate(`(() => { const el = document.activeElement; if (!el || el === document.body) return null; const list = ${focusableExpr}; const idx = list.indexOf(el); return { idx, tag: el.tagName, testid: el.getAttribute('data-testid') || '', name: el.getAttribute('name') || '', text: (el.textContent || el.value || '').trim().slice(0, 30) }; })()`);
      if (info === null) break;
      if (tabChain.length > 0 && info.idx <= prevIndex) {
        const sawExport = tabChain.some((f) => f.tag === "BUTTON" && f.text.includes("导出 JSON"));
        const sawTimeline = tabChain.some((f) => f.testid.startsWith("timeline-step-"));
        if (sawExport && sawTimeline) { wrapped = true; }
        else { monotonic = false; }
        break;
      }
      tabChain.push(info);
      prevIndex = info.idx;
    }
    const visited = {
      templateRadio: tabChain.some((f) => f.tag === "INPUT" && f.name === "template"),
      testSetButton: tabChain.some((f) => f.tag === "BUTTON" && ["聊天输入框", "底部面板", "固定 CTA", "搜索栏"].includes(f.text)),
      modeRadio: tabChain.some((f) => f.tag === "INPUT" && f.name === "mode"),
      numberInput: tabChain.some((f) => f.tag === "INPUT" && f.name === ""),
      sequenceSelect: tabChain.some((f) => f.tag === "SELECT"),
      timelineStep: tabChain.some((f) => f.testid.startsWith("timeline-step-")),
      exportButton: tabChain.some((f) => f.tag === "BUTTON" && f.text.includes("导出 JSON")),
    };
    check("Tab traversal visits a template radio", visited.templateRadio, JSON.stringify(tabChain.map((f) => f.text)));
    check("Tab traversal visits a test-set layout button", visited.testSetButton);
    check("Tab traversal visits a mode radio", visited.modeRadio);
    check("Tab traversal visits a number input", visited.numberInput);
    check("Tab traversal visits the sequence select", visited.sequenceSelect);
    check("Tab traversal visits a timeline step button", visited.timelineStep);
    check("Tab traversal reaches the export button", visited.exportButton, `tabs=${tabChain.length}`);
    check("Tab focus order follows document order (no backward jump before wrap)", monotonic && (wrapped || tabChain.length > 0));
    check("Tab traversal covered at least 10 focusable stops", tabChain.length >= 10, `stops=${tabChain.length}`);

    // ArrowDown inside the mode radio group moves selection.
    await browser.evaluate(`document.querySelector('input[name="mode"][value="resizes-visual"]').focus()`);
    await browser.pressArrowDown();
    const checkedMode = await browser.evaluate(`document.querySelector('input[name="mode"]:checked')?.value`);
    check("ArrowDown on the focused mode radio moves selection to resizes-content",
      checkedMode === "resizes-content", `checked=${checkedMode}`);
    // And Enter on the focused export button activates the download.
    for (const f of fs.readdirSync(DOWNLOAD_DIR)) fs.rmSync(path.join(DOWNLOAD_DIR, f), { force: true });
    await browser.evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('导出 JSON')).focus()`);
    const focusedIsExport = await browser.evaluate(`document.activeElement?.textContent.includes('导出 JSON')`);
    check("export button can receive keyboard focus", focusedIsExport === true);
    const beforeEnter = fs.readdirSync(DOWNLOAD_DIR);
    await browser.pressEnter();
    const enterFile = await waitForDownload(DOWNLOAD_DIR, beforeEnter, 10000);
    check("Enter on the focused export button triggers the JSON download", enterFile !== null);
    const shot3 = await browser.screenshot(shotPath("e2e-tab-focus-export.png"));
    check("screenshot e2e-tab-focus-export.png is non-trivial", shot3 > 10000, `size=${shot3}`);

    // ---- network: zero external requests across the whole session ----
    const external = browser.externalRequests(origin);
    check("external network requests during the whole E2E session: 0",
      external.length === 0, JSON.stringify(external));
    check("local requests did happen (page + assets loaded)",
      browser.requests.length >= 3, `total=${browser.requests.length}`);

    const shotHashes = {};
    for (const name of ["e2e-main-flow.png", "e2e-keyboard-visible.png", "e2e-tab-focus-export.png"]) {
      const p = shotPath(name);
      if (fs.existsSync(p)) {
        shotHashes[name] = sha256File(p);
        fs.copyFileSync(p, path.join(SHOT_DIR, name));
      }
    }
    const evidence = {
      suite: "test:e2e",
      seed: SEED,
      driver: {
        method: "CDP (Input.dispatchMouseEvent / Input.dispatchKeyEvent) on cached Chromium headless shell",
        playwrightPackageInstalled: playwrightInstalled,
        browser: browser.browserVersion ?? null,
        chromeBinary: chromeBin,
      },
      assertions: h.passed + h.failed,
      passed: h.passed,
      failed: h.failed,
      failures: h.failures,
      screenshots: shotHashes,
      network: {
        totalRequests: browser.requests.length,
        externalRequests: external.length,
        externalUrls: external.map((r) => r.url),
        requestUrls: browser.requests.map((r) => r.url),
      },
      export: {
        method: exportMethod,
        file: exportFile !== null ? path.basename(exportFile) : null,
        scenarioSha256: exported !== null ? exported.scenarioSha256 : null,
        expectedScenarioSha256: exported !== null ? sha256Hex(scenario.canonicalScenarioJson(exported.scenario)) : null,
        canonicalRoundTrip: exportText !== null && exported !== null ? exportText === scenario.canonicalExportJson(exported) : false,
      },
      tabTraversal: {
        stops: tabChain.length,
        wrapped,
        visited,
        chain: tabChain,
      },
      t009Leftovers: {
        keyboardVisibleScreenshot: "e2e-keyboard-visible.png (after real click on timeline-step-0)",
        exportClickVerified: exportMethod,
        tabTraversal: `${tabChain.length} stops, document-order monotonic`,
      },
      windowsTested: "NOT_TESTED",
    };
    fs.writeFileSync(path.join(EVIDENCE_DIR, "E2E_TEST.json"), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  } finally {
    await browser.close();
    await preview.stop();
  }

  if (!h.summary()) {
    process.exitCode = 1;
  } else {
    console.log("test:e2e: PASS — full UI chain in a real browser, 0 external requests");
    console.log(`test:e2e: export via ${exportMethod}; Tab traversal ${tabChain.length} stops`);
  }
}

main().catch((err) => {
  console.error(`test:e2e: ERROR — ${err.message}`);
  process.exitCode = 1;
});
