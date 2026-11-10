/**
 * P021 ViewportShift — self-contained offline HTML report (T010, S3).
 *
 * Contract: P021_PROJECT_BOOK.md §3.3, §5.2, §9 and
 * P021_IMPLEMENTATION_PLAN.md §5 (T010).
 *
 * What this module is: a pure function from an analysed scenario to
 * one self-contained HTML document. The report carries the scenario
 * id, mode, seed, text status, an inline SVG viewport profile, the
 * event timeline, the shortest-failure witness, and the key geometry
 * numbers — and nothing else: no remote resources of any kind (no
 * scripts, no style links, no images, no fonts, no remote references;
 * the only style is one inline `<style>` block and the only picture
 * is inline SVG built from domain integers).
 *
 * Text safety: every string that comes from input (scenario id, seed,
 * mode, event ids, predicate text, reasons, hashes) passes through
 * `escapeHtml` before it reaches the document. Input is never
 * concatenated into executable markup: a scenario id containing
 * markup is rendered as escaped text, never as an element.
 *
 * Pure functions only: no wall clock, no timers, no randomness, no
 * I/O, no network, no date/time access. All numbers shown are domain
 * integers formatted with integer math (milli-CSS-px to CSS px).
 */

import type { BfsSearchResult } from "../domain/bfs.ts";
import {
  computeMetrics,
  expectedAnchorRect,
  rectIntersection,
  surfaceRectFor,
} from "../domain/geometry.ts";
import type { GeometryEvaluation } from "../domain/geometry-eval.ts";
import type { AnalysisStatus, Scenario } from "../domain/types.ts";
import type { ViewportState } from "../domain/viewport-state.ts";
import { IO_VERSION } from "./json.ts";
import { SCHEMA_VERSION } from "../domain/types.ts";

export const REPORT_VERSION = "report/v1";

export interface ReportInput {
  scenario: Scenario;
  scenarioSha256: string;
  analysisStatus: AnalysisStatus;
  evaluation: GeometryEvaluation;
  bfs: BfsSearchResult;
}

const STATUS_LABELS: Record<AnalysisStatus, string> = {
  PASS: "PASS（通过）",
  FAIL: "FAIL（失败）",
  UNKNOWN: "UNKNOWN（未知）",
  BOUNDED_NO_WITNESS: "BOUNDED_NO_WITNESS（有界搜索未找到见证）",
  INVALID: "INVALID（无效输入）",
};

/** Escape text for safe inclusion in HTML text or attribute values. */
export function escapeHtml(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "&") out += "&amp;";
    else if (ch === "<") out += "&lt;";
    else if (ch === ">") out += "&gt;";
    else if (ch === '"') out += "&quot;";
    else if (ch === "'") out += "&#39;";
    else out += ch;
  }
  return out;
}

/** Format milli-CSS-px as CSS px with at most 3 decimals (integer math). */
export function formatCssPx(milli: number): string {
  const sign = milli < 0 ? "-" : "";
  const abs = milli < 0 ? -milli : milli;
  const whole = Math.trunc(abs / 1000);
  const frac = abs % 1000;
  if (frac === 0) return `${sign}${whole}`;
  let fracText = String(frac).padStart(3, "0");
  while (fracText.endsWith("0")) {
    fracText = fracText.slice(0, -1);
  }
  return `${sign}${whole}.${fracText}`;
}

/** Format a (milli-px)^2 area as CSS px^2 (integer math). */
export function formatAreaCssPx2(milliSq: number): string {
  const sign = milliSq < 0 ? "-" : "";
  const abs = milliSq < 0 ? -milliSq : milliSq;
  const whole = Math.trunc(abs / 1000000);
  const rem = abs % 1000000;
  const frac3 = Math.trunc(rem / 1000);
  if (frac3 === 0) return `${sign}${whole}`;
  let fracText = String(frac3).padStart(3, "0");
  while (fracText.endsWith("0")) {
    fracText = fracText.slice(0, -1);
  }
  return `${sign}${whole}.${fracText}`;
}

/** Format an integer milli-ratio (0..1000) as a percent. */
export function formatRatioPercent(milliRatio: number): string {
  const whole = Math.trunc(milliRatio / 10);
  const frac = milliRatio % 10;
  if (frac === 0) return `${whole}%`;
  return `${whole}.${frac}%`;
}

/** Milli-CSS-px to CSS px for SVG coordinates (display scaling only). */
function px(milli: number): number {
  return milli / 1000;
}

/**
 * Scan a report document for external-resource references. Returns
 * the names of the patterns found; an empty array means the document
 * is self-contained. (Used by the T010 acceptance runner; the report
 * builder itself never emits any of these.)
 */
export function findExternalReferences(html: string): Array<string> {
  const found: Array<string> = [];
  const patterns: Array<[string, RegExp]> = [
    ["remote-reference", /https?:\/\//i],
    ["protocol-relative-reference", /(?:^|[\s"'=])\/\//],
    ["script-element", /<\s*script/i],
    ["link-element", /<\s*link/i],
    ["image-element", /<\s*img/i],
    ["iframe-element", /<\s*iframe/i],
    ["object-element", /<\s*object/i],
    ["embed-element", /<\s*embed/i],
    ["css-import", /@import/i],
    ["css-url", /url\s*\(/i],
  ];
  for (const [name, pattern] of patterns) {
    if (pattern.test(html)) found.push(name);
  }
  return found;
}

function svgProfile(
  scenario: Scenario,
  state: ViewportState,
): string {
  const layout = scenario.layout;
  const surface = surfaceRectFor(layout, state);
  const expected = expectedAnchorRect(layout, state);
  const visual = {
    x: state.visualOffsetLeft,
    y: state.visualOffsetTop,
    width: state.visualWidth,
    height: state.visualHeight,
  };
  const keyboard = state.keyboardRect;
  let hotZone = null as null | {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  if (state.keyboardVisible && keyboard.height > 0) {
    const surfaceKeyboard = rectIntersection(surface, keyboard);
    if (surfaceKeyboard !== null) {
      hotZone = rectIntersection(surfaceKeyboard, visual);
    }
  }
  const w = px(scenario.viewport.layoutWidth);
  const h = px(scenario.viewport.layoutHeight);
  const rect = (
    r: { x: number; y: number; width: number; height: number },
    fill: string,
    stroke: string,
    strokeWidth: number,
    dash: string | null,
    label: string,
  ): string => {
    const dashAttr = dash !== null ? ` stroke-dasharray="${dash}"` : "";
    return (
      `<rect x="${px(r.x)}" y="${px(r.y)}" width="${px(r.width)}" height="${px(r.height)}"` +
      ` fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"${dashAttr} />` +
      `<text x="${px(r.x) + 4}" y="${px(r.y) + 14}">${escapeHtml(label)}</text>`
    );
  };
  const parts: Array<string> = [];
  parts.push(
    `<svg role="img" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">`,
  );
  parts.push(
    rect(
      { x: 0, y: 0, width: scenario.viewport.layoutWidth, height: scenario.viewport.layoutHeight },
      "#ffffff",
      "#111111",
      2,
      null,
      "布局视口",
    ),
  );
  parts.push(rect(visual, "#dbeafe", "#2563eb", 2, null, "视觉视口"));
  if (state.keyboardVisible && keyboard.height > 0) {
    parts.push(rect(keyboard, "#fde68a", "#b45309", 2, null, "键盘"));
  }
  parts.push(rect(expected, "none", "#6b7280", 1, "4 3", "期望锚点"));
  parts.push(rect(surface, "#bbf7d0", "#15803d", 2, null, "目标 UI"));
  if (hotZone !== null) {
    parts.push(rect(hotZone, "#fca5a5", "#b91c1c", 2, null, "遮挡热区"));
  }
  parts.push("</svg>");
  const summary =
    `布局视口 ${formatCssPx(scenario.viewport.layoutWidth)} × ${formatCssPx(scenario.viewport.layoutHeight)} CSS px；` +
    `视觉视口 ${formatCssPx(state.visualWidth)} × ${formatCssPx(state.visualHeight)} CSS px，` +
    `偏移 (${formatCssPx(state.visualOffsetLeft)}, ${formatCssPx(state.visualOffsetTop)}) CSS px；` +
    `键盘${state.keyboardVisible ? `可见，高 ${formatCssPx(keyboard.height)} CSS px` : "隐藏"}；` +
    `目标 UI ${formatCssPx(surface.width)} × ${formatCssPx(surface.height)} CSS px。`;
  return `<figure>${parts.join("")}<figcaption>${escapeHtml(summary)}</figcaption></figure>`;
}

/** Build the self-contained offline HTML report for one analysis. */
export function buildReportHtml(input: ReportInput): string {
  const { scenario, evaluation, bfs } = input;
  const esc = escapeHtml;
  const statusLabel = STATUS_LABELS[input.analysisStatus];
  const lines: Array<string> = [];
  lines.push("<!DOCTYPE html>");
  lines.push('<html lang="zh-CN">');
  lines.push("<head>");
  lines.push('<meta charset="utf-8">');
  lines.push(
    `<title>ViewportShift 离线报告 — ${esc(scenario.scenario_id)}</title>`,
  );
  lines.push("<style>");
  lines.push(
    "body{font-family:sans-serif;max-width:960px;margin:0 auto;padding:16px;color:#111}" +
      "table{border-collapse:collapse;width:100%}" +
      "th,td{border:1px solid #999;padding:4px 8px;text-align:left}" +
      "svg{border:1px solid #111;background:#fff}" +
      "text{font-size:12px;fill:#111}",
  );
  lines.push("</style>");
  lines.push("</head>");
  lines.push("<body>");
  lines.push("<h1>ViewportShift — 视口潮汐离线报告</h1>");
  lines.push(
    "<p><strong>行为模型实验室，不是真实设备兼容性认证。</strong>" +
      "本报告只用合成布局、合成事件与固定 seed 做确定性模拟；" +
      "模拟结果不等价于任何厂商浏览器的完整实现，不能替代真机测试。</p>",
  );
  lines.push("<h2>场景</h2>");
  lines.push("<table>");
  lines.push(
    `<tr><th scope="row">场景 ID</th><td>${esc(scenario.scenario_id)}</td></tr>`,
  );
  lines.push(`<tr><th scope="row">模式</th><td>${esc(scenario.mode)}</td></tr>`);
  lines.push(`<tr><th scope="row">Seed</th><td>${esc(scenario.seed)}</td></tr>`);
  lines.push(
    `<tr><th scope="row">状态</th><td><strong>${esc(statusLabel)}</strong></td></tr>`,
  );
  lines.push(
    `<tr><th scope="row">场景哈希</th><td>${esc(input.scenarioSha256)}</td></tr>`,
  );
  lines.push(
    `<tr><th scope="row">布局模板</th><td>${esc(scenario.layout.template)}（锚点 ${esc(scenario.layout.anchor)}）</td></tr>`,
  );
  lines.push(
    `<tr><th scope="row">布局视口</th><td>${esc(formatCssPx(scenario.viewport.layoutWidth))} × ${esc(formatCssPx(scenario.viewport.layoutHeight))} CSS px</td></tr>`,
  );
  lines.push(
    `<tr><th scope="row">键盘高度</th><td>${esc(formatCssPx(scenario.keyboard.heightMilli))} CSS px</td></tr>`,
  );
  if (evaluation.reason !== null) {
    lines.push(
      `<tr><th scope="row">原因</th><td>${esc(evaluation.reason)}</td></tr>`,
    );
  }
  lines.push("</table>");

  const profileState = evaluation.finalState ?? evaluation.initialState;
  lines.push("<h2>视口剖面（最终状态）</h2>");
  if (profileState !== null) {
    lines.push(svgProfile(scenario, profileState));
  } else {
    lines.push(
      "<p>评估未产生可用状态（输入无效或超出模型范围），无法绘制视口剖面。</p>",
    );
  }

  const finalMetrics = evaluation.finalMetrics;
  lines.push("<h2>关键数值（最终步骤）</h2>");
  if (finalMetrics !== null) {
    lines.push("<table>");
    lines.push(
      `<tr><th scope="row">键盘遮挡面积</th><td>${esc(formatAreaCssPx2(finalMetrics.keyboardObscuredArea))} CSS px²</td></tr>`,
    );
    lines.push(
      `<tr><th scope="row">视口裁剪面积</th><td>${esc(formatAreaCssPx2(finalMetrics.viewportClippedArea))} CSS px²</td></tr>`,
    );
    lines.push(
      `<tr><th scope="row">可见面积</th><td>${esc(formatAreaCssPx2(finalMetrics.visibleArea))} CSS px²</td></tr>`,
    );
    lines.push(
      `<tr><th scope="row">可见比例</th><td>${esc(formatRatioPercent(finalMetrics.visibleRatio))}</td></tr>`,
    );
    lines.push(
      `<tr><th scope="row">底部间距</th><td>${esc(formatCssPx(finalMetrics.bottomGap))} CSS px</td></tr>`,
    );
    lines.push(
      `<tr><th scope="row">位置漂移 (dx, dy, 模长)</th><td>(${esc(formatCssPx(finalMetrics.anchorDrift.dx))}, ${esc(formatCssPx(finalMetrics.anchorDrift.dy))}, ${esc(formatCssPx(finalMetrics.anchorDrift.magnitude))}) CSS px</td></tr>`,
    );
    lines.push("</table>");
  } else {
    lines.push("<p>无几何指标。</p>");
  }

  lines.push("<h2>事件时间轴</h2>");
  lines.push("<table>");
  lines.push(
    "<thead><tr><th scope=\"col\">步骤</th><th scope=\"col\">事件</th><th scope=\"col\">时间 (ms)</th>" +
      "<th scope=\"col\">键盘遮挡面积 (CSS px²)</th><th scope=\"col\">可见比例</th>" +
      "<th scope=\"col\">底部间距 (CSS px)</th><th scope=\"col\">位置漂移模长 (CSS px)</th>" +
      "<th scope=\"col\">失败谓词</th></tr></thead>",
  );
  lines.push("<tbody>");
  if (evaluation.initialState !== null) {
    const initial = computeMetrics(scenario.layout, evaluation.initialState);
    const m = initial.metrics;
    lines.push(
      "<tr><td>初始状态</td><td>INITIAL</td><td>0</td>" +
        `<td>${m !== null ? esc(formatAreaCssPx2(m.keyboardObscuredArea)) : "—"}</td>` +
        `<td>${m !== null ? esc(formatRatioPercent(m.visibleRatio)) : "—"}</td>` +
        `<td>${m !== null ? esc(formatCssPx(m.bottomGap)) : "—"}</td>` +
        `<td>${m !== null ? esc(formatCssPx(m.anchorDrift.magnitude)) : "—"}</td>` +
        "<td>无</td></tr>",
    );
  }
  for (const step of evaluation.steps) {
    const m = step.metrics;
    lines.push(
      `<tr><td>步骤 ${step.index + 1}</td><td>${esc(step.eventType)}（${esc(step.eventId)}）</td><td>${step.atMs}</td>` +
        `<td>${m !== null ? esc(formatAreaCssPx2(m.keyboardObscuredArea)) : "—"}</td>` +
        `<td>${m !== null ? esc(formatRatioPercent(m.visibleRatio)) : "—"}</td>` +
        `<td>${m !== null ? esc(formatCssPx(m.bottomGap)) : "—"}</td>` +
        `<td>${m !== null ? esc(formatCssPx(m.anchorDrift.magnitude)) : "—"}</td>` +
        `<td>${step.failedPredicates.length > 0 ? esc(step.failedPredicates.join(", ")) : "无"}</td></tr>`,
    );
  }
  if (evaluation.steps.length === 0 && evaluation.initialState === null) {
    lines.push(
      "<tr><td colspan=\"8\">无时间轴行：评估未运行（输入无效或超出模型范围）。</td></tr>",
    );
  }
  lines.push("</tbody>");
  lines.push("</table>");

  lines.push("<h2>最短失败序列（见证）</h2>");
  if (bfs.witness !== null) {
    lines.push(
      `<p>见证长度：${bfs.witnessLength} 个事件；` +
        `首个失败步骤下标：${bfs.firstFailedStepIndex}；` +
        `触发谓词：${bfs.failedPredicates.length > 0 ? esc(bfs.failedPredicates.join(", ")) : "无"}；` +
        `访问节点：${bfs.nodesVisited}；` +
        `搜索上限：深度 ${bfs.limits.maxDepth}，节点 ${bfs.limits.maxNodes}。</p>`,
    );
    lines.push("<table>");
    lines.push(
      "<thead><tr><th scope=\"col\">步骤</th><th scope=\"col\">事件</th><th scope=\"col\">时间 (ms)</th>" +
        "<th scope=\"col\">参数</th><th scope=\"col\">可见比例</th>" +
        "<th scope=\"col\">键盘遮挡面积 (CSS px²)</th><th scope=\"col\">失败谓词</th></tr></thead>",
    );
    lines.push("<tbody>");
    for (const step of bfs.witness) {
      const params = Object.keys(step.params)
        .sort()
        .map((k) => `${k}=${step.params[k]}`)
        .join(", ");
      lines.push(
        `<tr><td>${step.index + 1}</td><td>${esc(step.eventType)}（${esc(step.eventId)}）</td><td>${step.atMs}</td>` +
          `<td>${params.length > 0 ? esc(params) : "无"}</td>` +
          `<td>${esc(formatRatioPercent(step.metrics.visibleRatio))}</td>` +
          `<td>${esc(formatAreaCssPx2(step.metrics.keyboardObscuredArea))}</td>` +
          `<td>${step.failedPredicates.length > 0 ? esc(step.failedPredicates.join(", ")) : "无"}</td></tr>`,
      );
    }
    lines.push("</tbody>");
    lines.push("</table>");
  } else {
    lines.push(
      `<p>无见证。搜索状态：<strong>${esc(bfs.status)}</strong>` +
        `${bfs.reason !== null ? `（原因：${esc(bfs.reason)}）` : ""}` +
        `${bfs.limitReached !== null ? `；触及上限：${esc(bfs.limitReached)}` : ""}。</p>`,
    );
  }

  lines.push("<h2>可复算性</h2>");
  lines.push(
    `<p>场景哈希（SHA-256，规范化场景 JSON）：${esc(input.scenarioSha256)}。</p>` +
      `<p>报告版本 ${esc(REPORT_VERSION)}；Schema ${esc(SCHEMA_VERSION)}；IO ${esc(IO_VERSION)}。` +
      "本报告不含任何外部资源，可离线打开；导出 JSON 的哈希可用规范化 JSON 重新计算验证。</p>",
  );
  lines.push("</body>");
  lines.push("</html>");
  return lines.join("\n") + "\n";
}
