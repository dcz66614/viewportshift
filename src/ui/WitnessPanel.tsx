/**
 * P021 ViewportShift — T009 shortest-failure witness panel.
 *
 * Shows the BFS result: witness event sequence, the first failing
 * predicate(s), the state before and after the first failing step,
 * and the re-computable canonical JSON (domain `canonicalBfsJson`).
 * The search itself is the domain `searchBfs`; this panel only
 * renders its result.
 */

import type { BfsSearchResult } from "../domain/bfs.ts";
import {
  bfsStatusLabel,
  canonicalWitnessJson,
  formatCssPx,
  witnessBeforeAfter,
} from "./scenario.ts";

export interface WitnessPanelProps {
  bfs: BfsSearchResult | null;
  scenarioId: string;
}

function stateSummary(
  state: BfsSearchResult["initialState"],
): string {
  if (state === null) return "无状态";
  return [
    `布局视口 ${formatCssPx(state.layoutWidth)} × ${formatCssPx(state.layoutHeight)} CSS px`,
    `视觉视口偏移 (${formatCssPx(state.visualOffsetLeft)}, ${formatCssPx(state.visualOffsetTop)}) CSS px`,
    `视觉视口 ${formatCssPx(state.visualWidth)} × ${formatCssPx(state.visualHeight)} CSS px`,
    `键盘${state.keyboardVisible ? "可见" : "隐藏"}`,
    `滚动 (${formatCssPx(state.scrollX)}, ${formatCssPx(state.scrollY)}) CSS px`,
    `事件时钟 ${state.eventClock} ms`,
  ].join("；");
}

export function WitnessPanel(props: WitnessPanelProps) {
  const { bfs, scenarioId } = props;
  return (
    <section aria-label="最短失败见证">
      <h2>最短失败见证</h2>
      {bfs === null ? (
        <p>尚未运行最短失败搜索。</p>
      ) : (
        <div>
          <p data-testid="bfs-status">
            搜索状态：{bfsStatusLabel(bfs.status)}
            {bfs.reason !== null ? `（原因：${bfs.reason}）` : ""}
          </p>
          <p>
            场景：{scenarioId}；访问节点 {bfs.nodesVisited}；
            入队节点 {bfs.nodesEnqueued}；去重剪枝 {bfs.nodesPrunedDuplicate}；
            最大深度 {bfs.maxDepthReached}
            {bfs.limitReached !== null ? `；触及上限：${bfs.limitReached}` : ""}
          </p>
          {bfs.status === "FAIL" && bfs.witness !== null ? (
            <div>
              <p>
                见证长度：{bfs.witnessLength} 个事件；
                首个失败谓词：{bfs.failedPredicates.join(", ") || "无"}；
                首个失败步骤序号：{bfs.firstFailedStepIndex}
              </p>
              <h3>事件序列</h3>
              <ol>
                {bfs.witness.map((step) => (
                  <li key={step.index}>
                    步骤 {step.index + 1}：{step.eventType} ({step.eventId})，
                    时间 {step.atMs} ms
                    {Object.keys(step.params).length > 0
                      ? `，参数 ${Object.entries(step.params)
                          .map(([k, v]) => `${k}=${formatCssPx(v)} CSS px`)
                          .join(", ")}`
                      : ""}
                    ；失败谓词：{step.failedPredicates.join(", ") || "无"}
                  </li>
                ))}
              </ol>
              <h3>首个失败步骤前后状态</h3>
              {(() => {
                const { before, after } = witnessBeforeAfter(bfs);
                return (
                  <div>
                    <p>失败前状态：{stateSummary(before)}</p>
                    <p>失败后状态：{stateSummary(after)}</p>
                  </div>
                );
              })()}
              <h3>可复算 JSON（规范 canonical JSON）</h3>
              <pre data-testid="witness-json">
                {canonicalWitnessJson({
                  scenarioId: bfs.scenarioId,
                  seed: bfs.seed,
                  mode: bfs.mode,
                  status: bfs.status,
                  witnessLength: bfs.witnessLength,
                  failedPredicates: bfs.failedPredicates,
                  firstFailedStepIndex: bfs.firstFailedStepIndex,
                  witness: bfs.witness,
                })}
              </pre>
            </div>
          ) : null}
          {bfs.status === "BOUNDED_NO_WITNESS" ? (
            <p>
              在深度 {bfs.limits.maxDepth}、节点上限 {bfs.limits.maxNodes}{" "}
              内未找到失败序列。这不代表全空间安全，仅代表有界搜索未
              找到见证。
            </p>
          ) : null}
          {bfs.status === "UNKNOWN" || bfs.status === "INVALID" ? (
            <p>
              搜索未运行：输入超出模型范围或无效，见原因{" "}
              {bfs.reason ?? "未知"}。失败时闭合，不作通过处理。
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}
