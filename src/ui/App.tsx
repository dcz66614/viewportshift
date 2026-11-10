/**
 * P021 ViewportShift — T009 local web UI.
 *
 * Layout: header (no-phone notice + lab disclaimer), top status bar
 * (scenario id, mode, seed, text status label), left controls
 * (template / mode / parameters / event sequence), centre SVG viewport
 * profile + event timeline, right shortest-failure witness panel.
 *
 * All computation goes through `src/ui/scenario.ts`, which calls only
 * the frozen domain pure functions. This component holds UI state
 * only. Deterministic: fixed seed, fixed event sequences, no wall
 * clock, no randomness, no timers, no network.
 */

import { useEffect, useState } from "react";
import type { BfsSearchResult } from "../domain/bfs.ts";
import type { GeometryEvaluation } from "../domain/geometry-eval.ts";
import { VIEWPORT_MODES } from "../domain/types.ts";
import type { AnalysisStatus, LayoutTemplate, ViewportMode } from "../domain/types.ts";
import { ViewportSvg } from "../render/viewportSvg.tsx";
import { Timeline } from "../render/timeline.tsx";
import {
  DEFAULT_PREDICATES,
  DEFAULT_UI_PARAMS,
  EVENT_SEQUENCE_IDS,
  EVENT_SEQUENCE_LABELS,
  MODE_LABELS,
  TEMPLATE_LABELS,
  TEST_SET_TEMPLATES,
  UI_SEED,
  UI_TEMPLATES,
  buildScenario,
  canonicalExportJson,
  canonicalScenarioJson,
  deriveAnalysisStatus,
  formatAreaCssPx2,
  formatCssPx,
  formatRatioPercent,
  predicateText,
  replayScenario,
  runBfs,
  scenarioIdFor,
  selectedRow,
  sha256HexBrowser,
  statusLabel,
  timelineRows,
} from "./scenario.ts";
import type {
  EventSequenceId,
  TimelineRow,
  UiParams,
} from "./scenario.ts";
import { WitnessPanel } from "./WitnessPanel.tsx";
import "./styles.css";

interface ComputedResult {
  scenario: Record<string, unknown>;
  scenarioJson: string;
  scenarioSha256: string;
  shaMethod: string;
  evaluation: GeometryEvaluation;
  bfs: BfsSearchResult;
  analysisStatus: AnalysisStatus;
  rows: Array<TimelineRow>;
  compare: Array<{ template: LayoutTemplate; status: AnalysisStatus }>;
}

function isTemplate(value: string): value is LayoutTemplate {
  return (TEST_SET_TEMPLATES as ReadonlyArray<string>).includes(value);
}

/**
 * Fail-closed notice (P1-1 fix): shown when the evaluation has
 * finished but produced no row — i.e. the scenario is UNKNOWN /
 * INVALID and outside the model range. This is a completed
 * evaluation, never "still computing", so it must never render the
 * loading text. Carries the text status label and the domain reason
 * code (e.g. keyboard_height_out_of_range).
 */
function FailClosedNotice({
  status,
  reason,
}: {
  status: AnalysisStatus;
  reason: string | null;
}) {
  return (
    <div data-testid="fail-closed-notice">
      <p>
        <strong>{statusLabel(status)}</strong>
        {reason !== null ? `（原因：${reason}）` : ""}
      </p>
      <p>评估已完成，该场景超出模型范围，无法绘制视口剖面。</p>
    </div>
  );
}

function isMode(value: string): value is ViewportMode {
  return (VIEWPORT_MODES as ReadonlyArray<string>).includes(value);
}

function isSequence(value: string): value is EventSequenceId {
  return (EVENT_SEQUENCE_IDS as ReadonlyArray<string>).includes(value);
}

function intParam(
  raw: string | null,
  fallback: number,
  min: number,
  max: number,
): number {
  if (raw === null) return fallback;
  const v = Number(raw);
  if (!Number.isInteger(v)) return fallback;
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

/** Initial parameters: URL query overrides the frozen defaults. */
function initialParams(): UiParams {
  const query = new URLSearchParams(window.location.search);
  const template = query.get("template");
  const mode = query.get("mode");
  const sequence = query.get("sequence");
  return {
    template: template !== null && isTemplate(template) ? template : DEFAULT_UI_PARAMS.template,
    mode: mode !== null && isMode(mode) ? mode : DEFAULT_UI_PARAMS.mode,
    layoutWidthCssPx: intParam(query.get("layoutWidth"), DEFAULT_UI_PARAMS.layoutWidthCssPx, 200, 1200),
    layoutHeightCssPx: intParam(query.get("layoutHeight"), DEFAULT_UI_PARAMS.layoutHeightCssPx, 400, 2000),
    keyboardHeightCssPx: intParam(query.get("keyboardHeight"), DEFAULT_UI_PARAMS.keyboardHeightCssPx, 0, 800),
    scrollDxCssPx: intParam(query.get("scrollDx"), DEFAULT_UI_PARAMS.scrollDxCssPx, -500, 500),
    scrollDyCssPx: intParam(query.get("scrollDy"), DEFAULT_UI_PARAMS.scrollDyCssPx, -500, 500),
    panDyCssPx: intParam(query.get("panDy"), DEFAULT_UI_PARAMS.panDyCssPx, -500, 500),
    sequenceId: sequence !== null && isSequence(sequence) ? sequence : DEFAULT_UI_PARAMS.sequenceId,
  };
}

export function ViewportShiftApp() {
  const [params, setParams] = useState<UiParams>(initialParams);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const [result, setResult] = useState<ComputedResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function compute() {
      const scenario = buildScenario(params);
      const scenarioJson = canonicalScenarioJson(scenario);
      const { hex, method } = await sha256HexBrowser(scenarioJson);
      const evaluation = replayScenario(scenario, hex);
      const bfs = runBfs(scenario, hex);
      const compare = await Promise.all(
        TEST_SET_TEMPLATES.map(async (template) => {
          const variant = buildScenario({ ...params, template });
          const variantHex = (await sha256HexBrowser(canonicalScenarioJson(variant))).hex;
          return {
            template,
            status: deriveAnalysisStatus(replayScenario(variant, variantHex)),
          };
        }),
      );
      if (cancelled) return;
      setResult({
        scenario,
        scenarioJson,
        scenarioSha256: hex,
        shaMethod: method,
        evaluation,
        bfs,
        analysisStatus: deriveAnalysisStatus(evaluation),
        rows: timelineRows(evaluation, scenario),
        compare,
      });
    }
    void compute();
    return () => {
      cancelled = true;
    };
  }, [params]);

  function updateParams(next: Partial<UiParams>) {
    setParams((prev) => ({ ...prev, ...next }));
    setSelectedIndex(-1);
  }

  function numberInput(
    label: string,
    value: number,
    min: number,
    max: number,
    onChange: (v: number) => void,
  ) {
    return (
      <label>
        {label} (CSS px)
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={1}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === "") return;
            const v = Number(raw);
            if (!Number.isInteger(v)) return;
            if (v < min || v > max) return;
            onChange(v);
          }}
        />
      </label>
    );
  }

  function exportJson() {
    if (result === null) return;
    const text = canonicalExportJson({
      schemaVersion: "viewportshift.scenario/v1",
      scenario: result.scenario,
      scenarioSha256: result.scenarioSha256,
      evaluation: result.evaluation,
      bfs: result.bfs,
    });
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${scenarioIdFor(params)}.viewportshift.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const row = result !== null ? selectedRow(result.rows, selectedIndex) : null;
  const status = result !== null ? result.analysisStatus : "UNKNOWN";

  return (
    <main>
      <h1>ViewportShift — 视口潮汐</h1>
      <div className="banner">
        <p>
          <strong>不需要手机。</strong>
          本工具只用合成布局、合成事件与固定 seed 做确定性模拟。
        </p>
        <p>
          <strong>行为模型实验室，不是真实设备兼容性认证。</strong>
          模拟结果不等价于任何厂商浏览器的完整实现，不能替代真机测试。
        </p>
      </div>

      <div className="status-bar" aria-label="场景状态">
        <span>
          场景 ID：<strong data-testid="scenario-id">{scenarioIdFor(params)}</strong>
        </span>
        <span>
          模式：<strong>{params.mode}</strong>
        </span>
        <span>
          Seed：<strong>{UI_SEED}</strong>
        </span>
        <span>
          状态：<strong data-testid="analysis-status">{statusLabel(status)}</strong>
        </span>
        <span>
          场景哈希（{result !== null ? result.shaMethod : "计算中"}）：
          <strong>{result !== null ? result.scenarioSha256 : "计算中…"}</strong>
        </span>
      </div>

      <div className="layout">
        <div>
          <section aria-label="布局与模式选择">
            <h2>布局与视口参数</h2>
            <fieldset>
              <legend>合成 UI 模板（三选一）</legend>
              {UI_TEMPLATES.map((template) => (
                <label key={template}>
                  <input
                    type="radio"
                    name="template"
                    value={template}
                    checked={params.template === template}
                    onChange={() => updateParams({ template })}
                  />
                  {TEMPLATE_LABELS[template]} ({template})
                </label>
              ))}
            </fieldset>
            <fieldset>
              <legend>内置四布局测试集</legend>
              <p>一键载入任一布局（含搜索栏），与当前模式组合重放。</p>
              {TEST_SET_TEMPLATES.map((template) => (
                <button
                  key={template}
                  type="button"
                  onClick={() => updateParams({ template })}
                  aria-pressed={params.template === template}
                >
                  {TEMPLATE_LABELS[template]}
                </button>
              ))}
            </fieldset>
            <fieldset>
              <legend>视口响应模式（三选一）</legend>
              {VIEWPORT_MODES.map((mode) => (
                <label key={mode}>
                  <input
                    type="radio"
                    name="mode"
                    value={mode}
                    checked={params.mode === mode}
                    onChange={() => updateParams({ mode })}
                  />
                  {MODE_LABELS[mode]}
                </label>
              ))}
            </fieldset>
            {numberInput("布局视口宽度", params.layoutWidthCssPx, 200, 1200, (v) =>
              updateParams({ layoutWidthCssPx: v }),
            )}
            {numberInput("布局视口高度", params.layoutHeightCssPx, 400, 2000, (v) =>
              updateParams({ layoutHeightCssPx: v }),
            )}
            {numberInput("键盘高度", params.keyboardHeightCssPx, 0, 800, (v) =>
              updateParams({ keyboardHeightCssPx: v }),
            )}
            {numberInput("滚动 dx", params.scrollDxCssPx, -500, 500, (v) =>
              updateParams({ scrollDxCssPx: v }),
            )}
            {numberInput("滚动 dy", params.scrollDyCssPx, -500, 500, (v) =>
              updateParams({ scrollDyCssPx: v }),
            )}
            {numberInput("延迟平移 dy", params.panDyCssPx, -500, 500, (v) =>
              updateParams({ panDyCssPx: v }),
            )}
            <p>
              延迟视觉视口平移是压力事件，不是第四种标准模式；dx 固定为 0
              CSS px。
            </p>
          </section>

          <section aria-label="事件序列">
            <h2>事件编辑 / 重放</h2>
            <label>
              固定事件序列
              <select
                value={params.sequenceId}
                onChange={(e) => {
                  const v = e.target.value;
                  if (isSequence(v)) updateParams({ sequenceId: v });
                }}
              >
                {EVENT_SEQUENCE_IDS.map((id) => (
                  <option key={id} value={id}>
                    {EVENT_SEQUENCE_LABELS[id]}
                  </option>
                ))}
              </select>
            </label>
            <p>
              事件时间固定为 100 ms 步进（100、200、300 ms），按数组顺序
              处理；不依赖系统时钟。
            </p>
            <p>
              失败谓词：
              {DEFAULT_PREDICATES.map(predicateText).join("；")}
            </p>
          </section>

          <section aria-label="导出">
            <h2>导出</h2>
            <button type="button" onClick={exportJson} disabled={result === null}>
              导出 JSON（场景 + 重放 + 见证）
            </button>
            <button
              type="button"
              onClick={() => {
                setParams(DEFAULT_UI_PARAMS);
                setSelectedIndex(-1);
              }}
            >
              清空当前合成工作区（恢复默认）
            </button>
            <p>
              文件导入导出与离线 HTML 报告是 T010 的工作，本版本只提供
              JSON 下载。
            </p>
          </section>

          <section aria-label="四布局对比">
            <h2>四布局测试集对比（当前模式）</h2>
            {result === null ? (
              <p>计算中…</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th scope="col">布局</th>
                    <th scope="col">状态</th>
                  </tr>
                </thead>
                <tbody>
                  {result.compare.map((entry) => (
                    <tr key={entry.template}>
                      <td>
                        {TEMPLATE_LABELS[entry.template]} ({entry.template})
                      </td>
                      <td>{statusLabel(entry.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
          </section>
        </div>

        <div>
          <section aria-label="视口剖面">
            <h2>SVG 视口剖面</h2>
            {result === null ? (
              <p>计算中…</p>
            ) : row === null || row.state === null ? (
              <FailClosedNotice
                status={result.analysisStatus}
                reason={result.evaluation.reason}
              />
            ) : (
              <ViewportSvg
                state={row.state}
                surfaceRect={row.surfaceRect}
                metrics={row.metrics}
                layoutWidthCssPx={params.layoutWidthCssPx}
                layoutHeightCssPx={params.layoutHeightCssPx}
                layout={
                  result.scenario.layout as {
                    template: string;
                    anchor: "bottom" | "top";
                    offsetMilli: number;
                    xMilli: number;
                    widthMilli: number;
                    heightMilli: number;
                  }
                }
              />
            )}
          </section>

          {result !== null ? (
            <Timeline
              rows={result.rows}
              selectedIndex={selectedIndex}
              onSelect={setSelectedIndex}
              failClosedStatusLabel={statusLabel(result.analysisStatus)}
              failClosedReason={result.evaluation.reason}
            />
          ) : (
            <p>计算中…</p>
          )}

          {result !== null && (row === null || row.state === null) ? (
            <section aria-label="选中时刻状态">
              <h2>选中时刻</h2>
              <FailClosedNotice
                status={result.analysisStatus}
                reason={result.evaluation.reason}
              />
            </section>
          ) : row !== null && row.state !== null ? (
            <section aria-label="选中时刻状态">
              <h2>
                选中时刻：{row.index === -1 ? "初始状态" : `步骤 ${row.index + 1}（${row.eventType}，${row.atMs} ms）`}
              </h2>
              <ul>
                <li>
                  布局视口：{formatCssPx(row.state.layoutWidth)} ×{" "}
                  {formatCssPx(row.state.layoutHeight)} CSS px
                </li>
                <li>
                  视觉视口偏移：({formatCssPx(row.state.visualOffsetLeft)},{" "}
                  {formatCssPx(row.state.visualOffsetTop)}) CSS px
                </li>
                <li>
                  视觉视口：{formatCssPx(row.state.visualWidth)} ×{" "}
                  {formatCssPx(row.state.visualHeight)} CSS px
                </li>
                <li>
                  键盘：{row.state.keyboardVisible ? "可见" : "隐藏"}，
                  矩形 ({formatCssPx(row.state.keyboardRect.x)},{" "}
                  {formatCssPx(row.state.keyboardRect.y)}),{" "}
                  {formatCssPx(row.state.keyboardRect.width)} ×{" "}
                  {formatCssPx(row.state.keyboardRect.height)} CSS px
                </li>
                <li>
                  滚动：({formatCssPx(row.state.scrollX)}, {formatCssPx(row.state.scrollY)}) CSS px
                </li>
                <li>事件时钟：{row.state.eventClock} ms</li>
                <li>
                  目标 UI 矩形：({formatCssPx(row.surfaceRect.x)},{" "}
                  {formatCssPx(row.surfaceRect.y)}),{" "}
                  {formatCssPx(row.surfaceRect.width)} ×{" "}
                  {formatCssPx(row.surfaceRect.height)} CSS px
                </li>
              </ul>
              {row.metrics !== null ? (
                <table>
                  <thead>
                    <tr>
                      <th scope="col">几何指标</th>
                      <th scope="col">数值</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>键盘遮挡面积</td>
                      <td>{formatAreaCssPx2(row.metrics.keyboardObscuredArea)} CSS px²</td>
                    </tr>
                    <tr>
                      <td>视口裁剪面积</td>
                      <td>{formatAreaCssPx2(row.metrics.viewportClippedArea)} CSS px²</td>
                    </tr>
                    <tr>
                      <td>可见面积</td>
                      <td>{formatAreaCssPx2(row.metrics.visibleArea)} CSS px²</td>
                    </tr>
                    <tr>
                      <td>可见比例</td>
                      <td>{formatRatioPercent(row.metrics.visibleRatio)}</td>
                    </tr>
                    <tr>
                      <td>底部间距</td>
                      <td>{formatCssPx(row.metrics.bottomGap)} CSS px</td>
                    </tr>
                    <tr>
                      <td>位置漂移 (dx, dy, 模长)</td>
                      <td>
                        ({formatCssPx(row.metrics.anchorDrift.dx)},{" "}
                        {formatCssPx(row.metrics.anchorDrift.dy)},{" "}
                        {formatCssPx(row.metrics.anchorDrift.magnitude)}) CSS px
                      </td>
                    </tr>
                    <tr>
                      <td>失败谓词</td>
                      <td>{row.failedPredicates.join(", ") || "无"}</td>
                    </tr>
                  </tbody>
                </table>
              ) : (
                <p>无几何指标。</p>
              )}
            </section>
          ) : null}
        </div>

        <div>
          <WitnessPanel
            bfs={result !== null ? result.bfs : null}
            scenarioId={scenarioIdFor(params)}
          />
        </div>
      </div>
    </main>
  );
}
