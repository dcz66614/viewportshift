/**
 * P021 ViewportShift — T009 event timeline (render only).
 *
 * One row per replay step (plus the initial state). Clicking a row
 * selects that step; the parent renders the selected step's state in
 * the SVG profile and the detail box. Rows are native buttons, so the
 * timeline is fully keyboard operable (Tab / arrows / Enter).
 * All metrics are formatted from domain values by `src/ui/scenario.ts`
 * helpers; no geometry is computed here.
 */

import type { TimelineRow } from "../ui/scenario.ts";
import {
  formatAreaCssPx2,
  formatCssPx,
  formatRatioPercent,
} from "../ui/scenario.ts";

export interface TimelineProps {
  rows: Array<TimelineRow>;
  selectedIndex: number;
  onSelect: (index: number) => void;
  /**
   * Fail-closed context for the empty state. Rows are empty only
   * when the replay never ran (UNKNOWN / INVALID: no initial state,
   * no steps), so an empty timeline is a completed evaluation with
   * no replay steps — never a loading state and never a silent
   * empty table (P1-1 fix).
   */
  failClosedStatusLabel?: string;
  failClosedReason?: string | null;
}

export function Timeline(props: TimelineProps) {
  const { rows, selectedIndex, onSelect, failClosedStatusLabel, failClosedReason } = props;
  if (rows.length === 0) {
    return (
      <section aria-label="事件时间轴">
        <h2>事件时间轴</h2>
        <p data-testid="timeline-empty-state">
          评估已完成：因 fail-closed
          {failClosedStatusLabel !== undefined || failClosedReason !== undefined
            ? `（${failClosedStatusLabel ?? ""}${failClosedReason !== null && failClosedReason !== undefined ? `，原因：${failClosedReason}` : ""}）`
            : ""}
          ，无重放步骤，时间轴为空。
        </p>
      </section>
    );
  }
  return (
    <section aria-label="事件时间轴">
      <h2>事件时间轴</h2>
      <p>
        点击某一行查看该时刻的状态与几何指标。遮挡面积以 CSS px² 计；
        底部间距与位置漂移以 CSS px 计；可见比例为目标 UI 可见面积占
        其总面积的百分比。
      </p>
      <div style={{ overflowX: "auto" }}>
      <table>
        <thead>
          <tr>
            <th scope="col">步骤</th>
            <th scope="col">事件</th>
            <th scope="col">时间 (ms)</th>
            <th scope="col">遮挡面积 (CSS px²)</th>
            <th scope="col">可见比例</th>
            <th scope="col">底部间距 (CSS px)</th>
            <th scope="col">位置漂移 (CSS px)</th>
            <th scope="col">状态</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const selected = row.index === selectedIndex;
            const failed = row.failedPredicates.length > 0;
            return (
              <tr key={row.index} aria-current={selected ? "true" : undefined}>
                <td>
                  <button
                    type="button"
                    onClick={() => onSelect(row.index)}
                    aria-pressed={selected}
                    data-testid={`timeline-step-${row.index}`}
                  >
                    {row.index === -1 ? "初始状态" : `步骤 ${row.index + 1}`}
                  </button>
                </td>
                <td>
                  {row.eventType}
                  {row.eventId !== "initial" ? ` (${row.eventId})` : ""}
                </td>
                <td>{row.atMs}</td>
                <td>
                  {row.metrics !== null
                    ? formatAreaCssPx2(row.metrics.keyboardObscuredArea)
                    : "—"}
                </td>
                <td>
                  {row.metrics !== null
                    ? formatRatioPercent(row.metrics.visibleRatio)
                    : "—"}
                </td>
                <td>
                  {row.metrics !== null
                    ? formatCssPx(row.metrics.bottomGap)
                    : "—"}
                </td>
                <td>
                  {row.metrics !== null
                    ? formatCssPx(row.metrics.anchorDrift.magnitude)
                    : "—"}
                </td>
                <td>{failed ? `FAIL（失败）：${row.failedPredicates.join(", ")}` : "PASS（通过）"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </section>
  );
}
