#!/usr/bin/env node
/**
 * T012 shared E2E library: real-browser driver + domain loader.
 *
 * Browser automation WITHOUT a Playwright npm dependency (adding one
 * is prohibited: package.json dependencies must not change, and a
 * `npm ci` in T013 would wipe any `--no-save` install, breaking
 * `test:e2e` on a clean checkout). The Playwright *browser binaries*
 * are present in the VM cache (T001 recorded chromium_available:
 * true; `npx playwright --version` reports 1.65.0, but the driver
 * package itself is not installed in this repo). This library drives
 * the cached Chromium headless shell (fallback: /opt/meta-chromium/
 * chrome, then a chromium binary on PATH) directly over CDP with
 * Node 24's built-in WebSocket client — a real browser, real mouse
 * events (Input.dispatchMouseEvent) and real keyboard events
 * (Input.dispatchKeyEvent), not a DOM shim. Every check below is a
 * real assertion; nothing exits 0 unconditionally.
 *
 * Also contains the T008/T009 in-memory domain transpile loader
 * (scenario.ts + domain) so exported JSON can be re-canonicalized
 * and re-validated in Node with the frozen domain code.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SEED = "P021-VIEWPORTSHIFT-S0-2026-11-10";
export const FROZEN_DEMO_RESULT_SHA256 =
  "88f2153afd19cd19659d48587b7a98286621fff7ca9ae37cec0de6a4e50f6b60";
export const FROZEN_DEMO_REPORT_SHA256 =
  "f329e8144a234eb46e6eea71dc04fc222e63dec44f3f66192b6c0bf0128d90b8";

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function sha256File(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/** Minimal pass/fail harness: exits non-zero unless every check passes. */
export function makeHarness(name) {
  let passed = 0;
  let failed = 0;
  const failures = [];
  function check(label, cond, extra = "") {
    if (cond) {
      passed++;
    } else {
      failed++;
      failures.push(`${label}${extra ? ` — ${extra}` : ""}`);
      console.error(`FAIL: ${label}${extra ? ` — ${extra}` : ""}`);
    }
    return !!cond;
  }
  function summary() {
    console.log(`${name}: ${passed} passed, ${failed} failed`);
    return failed === 0;
  }
  return { check, summary, get passed() { return passed; }, get failed() { return failed; }, failures };
}

/** Transpile the domain + the UI logic module in-memory (T008 pattern). */
export async function loadUiDomain() {
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
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "viewportshift-t012-"));
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
            errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, " ")).join(";"),
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
    return { scenario, geometry };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** Locate a real Chromium binary: Playwright cache first, then system Chrome. */
export function findChrome() {
  const cache = path.join(os.homedir(), ".cache", "ms-playwright");
  const candidates = [
    path.join(cache, "chromium_headless_shell-1254", "chrome-headless-shell-linux64", "chrome-headless-shell"),
    path.join(cache, "chromium_headless_shell-1248", "chrome-headless-shell-linux64", "chrome-headless-shell"),
    path.join(cache, "chromium-1254", "chrome-linux64", "chrome"),
    path.join(cache, "chromium-1248", "chrome-linux64", "chrome"),
    "/opt/meta-chromium/chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
  ];
  for (const bin of candidates) {
    if (fs.existsSync(bin)) return bin;
  }
  return null;
}

/** Start `vite preview` on a fixed port; resolves once the root URL answers. */
export async function startPreview(port) {
  const preview = spawn(
    "node",
    ["node_modules/vite/bin/vite.js", "preview", "--port", String(port), "--strictPort", "--host", "127.0.0.1"],
    { cwd: ROOT, stdio: "ignore" },
  );
  let up = false;
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`);
      if (res.ok) { up = true; break; }
    } catch {
      // not up yet
    }
    await sleep(500);
  }
  if (!up) {
    preview.kill("SIGKILL");
    throw new Error(`vite preview did not come up on port ${port}`);
  }
  const stop = async () => {
    preview.kill("SIGTERM");
    await sleep(500);
    if (preview.exitCode === null) preview.kill("SIGKILL");
  };
  return { base: `http://127.0.0.1:${port}/`, stop };
}

/**
 * Minimal CDP driver over Node's built-in WebSocket.
 * One browser, one page target; records every network request URL.
 */
export class CdpBrowser {
  constructor() {
    this.proc = null;
    this.ws = null;
    this.sessionId = null;
    this.nextId = 0;
    this.pending = new Map();
    this.requests = [];
    this.profile = null;
    this.port = 0;
  }

  async launch(port, chromeBin) {
    this.port = port;
    this.profile = fs.mkdtempSync(path.join(os.tmpdir(), "viewportshift-t012-chrome-"));
    this.proc = spawn(chromeBin, [
      "--headless",
      "--disable-gpu",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--hide-scrollbars",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${this.profile}`,
      "--window-size=1280,1000",
      "about:blank",
    ], { stdio: "ignore" });
    let version = null;
    for (let i = 0; i < 120; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json/version`);
        if (res.ok) { version = await res.json(); break; }
      } catch {
        // not up yet
      }
      await sleep(250);
    }
    if (version === null) throw new Error(`chrome did not expose CDP on port ${port}`);
    this.browserVersion = version.Browser;
    this.ws = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = (e) => reject(new Error(`CDP websocket error: ${e.message ?? "unknown"}`));
    });
    this.ws.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolve, reject, timer } = this.pending.get(msg.id);
        clearTimeout(timer);
        this.pending.delete(msg.id);
        if (msg.error !== undefined) reject(new Error(`CDP ${msg.error.message} (code ${msg.error.code})`));
        else resolve(msg.result ?? {});
      } else if (msg.method === "Network.requestWillBeSent") {
        this.requests.push({ url: msg.params.request.url, method: msg.params.request.method });
      }
    };
    const target = await this.send("Target.createTarget", { url: "about:blank" });
    const attached = await this.send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
    this.sessionId = attached.sessionId;
    await this.session("Page.enable");
    await this.session("Runtime.enable");
    await this.session("Network.enable");
    return this;
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP send timeout: ${method}`));
      }, 30000);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  session(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP session timeout: ${method}`));
      }, 30000);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, sessionId: this.sessionId, method, params }));
    });
  }

  async evaluate(expression) {
    const res = await this.session("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res.exceptionDetails !== undefined) {
      throw new Error(`page evaluate failed: ${JSON.stringify(res.exceptionDetails)}`);
    }
    return res.result?.value;
  }

  async navigate(url) {
    await this.session("Page.navigate", { url });
  }

  /** Poll an expression (must return a truthy value) until timeout. */
  async waitFor(expression, timeoutMs = 15000, intervalMs = 200) {
    const deadline = Date.now() + timeoutMs;
    let last;
    while (Date.now() < deadline) {
      last = await this.evaluate(expression);
      if (last) return last;
      await sleep(intervalMs);
    }
    throw new Error(`waitFor timed out after ${timeoutMs}ms: ${expression} (last=${JSON.stringify(last)})`);
  }

  /** Bounding rect of the first element matching a JS expression returning an element. */
  async elementRect(expr) {
    return this.evaluate(`(() => { const el = (${expr}); if (!el) return null; el.scrollIntoView({block:'center'}); const r = el.getBoundingClientRect(); return {x: r.x, y: r.y, width: r.width, height: r.height, cx: r.x + r.width/2, cy: r.y + r.height/2}; })()`);
  }

  async clickAt(x, y) {
    await this.session("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await this.session("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
    await sleep(150);
  }

  async clickElement(expr) {
    const rect = await this.elementRect(expr);
    if (rect === null) throw new Error(`clickElement: no element for ${expr}`);
    await this.clickAt(rect.cx, rect.cy);
    return rect;
  }

  /** Real key press (keydown + keyup) via CDP input events. */
  async pressKey(key, code, windowsVirtualKeyCode, text = undefined) {
    const base = { key, code, windowsVirtualKeyCode, nativeVirtualKeyCode: windowsVirtualKeyCode };
    const down = { type: "keyDown", ...base };
    // Enter activation of a focused button needs the key text
    // ("\r") on keydown; without it headless Chrome swallows the
    // default action (probed 2026-11-10: plain keyDown Enter = 0
    // clicks, keyDown with text "\r" = 1 click).
    if (text !== undefined) {
      down.text = text;
      down.unmodifiedText = text;
    }
    await this.session("Input.dispatchKeyEvent", down);
    await this.session("Input.dispatchKeyEvent", { type: "keyUp", ...base });
    await sleep(120);
  }

  async pressTab() {
    await this.pressKey("Tab", "Tab", 9);
  }

  async pressEnter() {
    await this.pressKey("Enter", "Enter", 13, "\r");
  }

  async pressArrowDown() {
    await this.pressKey("ArrowDown", "ArrowDown", 40);
  }

  async screenshot(file) {
    const res = await this.session("Page.captureScreenshot", { format: "png" });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(res.data, "base64"));
    return fs.statSync(file).size;
  }

  externalRequests(origin) {
    return this.requests.filter((r) => !r.url.startsWith(origin) && !r.url.startsWith("data:") && !r.url.startsWith("blob:"));
  }

  async close() {
    try {
      if (this.ws !== null) this.ws.close();
    } catch {
      // already closed
    }
    if (this.proc !== null) {
      this.proc.kill("SIGTERM");
      await sleep(300);
      if (this.proc.exitCode === null) this.proc.kill("SIGKILL");
    }
    if (this.profile !== null) fs.rmSync(this.profile, { recursive: true, force: true });
  }
}

/** Wait for a file to appear in a directory (download completion). */
export async function waitForDownload(dir, beforeNames, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const names = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
    const fresh = names.filter((n) => !beforeNames.includes(n) && !n.endsWith(".crdownload"));
    if (fresh.length > 0) {
      const file = path.join(dir, fresh[0]);
      // Wait for the file to stop growing (download finished).
      let prev = -1;
      for (let i = 0; i < 20; i++) {
        const size = fs.statSync(file).size;
        if (size === prev && size > 0) return file;
        prev = size;
        await sleep(200);
      }
      return file;
    }
    await sleep(200);
  }
  return null;
}
