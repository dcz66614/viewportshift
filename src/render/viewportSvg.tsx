/**
 * P021 ViewportShift — T009 SVG viewport profile (render only).
 *
 * Draws the layout viewport, visual viewport, keyboard rect, target
 * UI rect, expected anchor rect, and the occlusion hot zone. All
 * geometry comes from the domain: the state, the surface rect, and
 * `rectIntersection` from `src/domain/geometry.ts`. This module
 * computes no geometry of its own — it only scales milli-CSS-px to
 * CSS px for display (division by 1000, display only, never a
 * decision) and draws what the domain reports.
 */

import { expectedAnchorRect, rectIntersection } from "../domain/geometry.ts";
import type { GeometryMetrics } from "../domain/geometry.ts";
import type { RectMilli } from "../domain/types.ts";
import type { ViewportState } from "../domain/viewport-state.ts";
import { formatAreaCssPx2, formatCssPx } from "../ui/scenario.ts";

export interface ViewportSvgProps {
  state: ViewportState;
  surfaceRect: RectMilli;
  metrics: GeometryMetrics | null;
  layoutWidthCssPx: number;
  layoutHeightCssPx: number;
  /** Layout template, for the anchor computation (domain-owned). */
  layout: {
    template: string;
    anchor: "bottom" | "top";
    offsetMilli: number;
    xMilli: number;
    widthMilli: number;
    heightMilli: number;
  };
}

/** Milli-CSS-px to CSS px for SVG coordinates (display scaling only). */
function px(milli: number): number {
  return milli / 1000;
}

export function ViewportSvg(props: ViewportSvgProps) {
  const { state, surfaceRect, metrics, layout } = props;
  const w = props.layoutWidthCssPx;
  const h = props.layoutHeightCssPx;
  const visual: RectMilli = {
    x: state.visualOffsetLeft,
    y: state.visualOffsetTop,
    width: state.visualWidth,
    height: state.visualHeight,
  };
  const keyboard = state.keyboardRect;
  const expected = expectedAnchorRect(layout, state);
  // Occlusion hot zone: the part of the surface that is both inside
  // the visual viewport and under the keyboard (domain intersection).
  let hotZone: RectMilli | null = null;
  if (state.keyboardVisible && keyboard.height > 0) {
    const surfaceKeyboard = rectIntersection(surfaceRect, keyboard);
    if (surfaceKeyboard !== null) {
      hotZone = rectIntersection(surfaceKeyboard, visual);
    }
  }
  const obscured =
    metrics !== null ? metrics.keyboardObscuredArea : 0;
  const summary =
    `布局视口 ${w} × ${h} CSS px；` +
    `视觉视口 ${formatCssPx(state.visualWidth)} × ${formatCssPx(state.visualHeight)} CSS px，` +
    `偏移 (${formatCssPx(state.visualOffsetLeft)}, ${formatCssPx(state.visualOffsetTop)}) CSS px；` +
    `键盘${state.keyboardVisible ? `可见，高 ${formatCssPx(keyboard.height)} CSS px` : "隐藏"}；` +
    `目标 UI ${formatCssPx(surfaceRect.width)} × ${formatCssPx(surfaceRect.height)} CSS px；` +
    `键盘遮挡面积 ${formatAreaCssPx2(obscured)} CSS px²。`;
  return (
    <figure>
      <svg
        role="img"
        aria-label={summary}
        viewBox={`0 0 ${w} ${h}`}
        width={w}
        height={h}
        data-testid="viewport-svg"
      >
        {/* Layout viewport: the whole canvas. */}
        <rect x={0} y={0} width={w} height={h} fill="#f4f6f8" stroke="#334155" strokeWidth={2} />
        {/* Visual viewport. */}
        <rect
          x={px(visual.x)}
          y={px(visual.y)}
          width={px(visual.width)}
          height={px(visual.height)}
          fill="#dbeafe"
          fillOpacity={0.7}
          stroke="#2563eb"
          strokeWidth={2}
        />
        {/* Keyboard rect. */}
        {state.keyboardVisible && keyboard.height > 0 ? (
          <rect
            x={px(keyboard.x)}
            y={px(keyboard.y)}
            width={px(keyboard.width)}
            height={px(keyboard.height)}
            fill="#475569"
            fillOpacity={0.85}
            stroke="#0f172a"
            strokeWidth={2}
          />
        ) : null}
        {/* Occlusion hot zone (surface ∩ keyboard ∩ visual). */}
        {hotZone !== null ? (
          <rect
            x={px(hotZone.x)}
            y={px(hotZone.y)}
            width={px(hotZone.width)}
            height={px(hotZone.height)}
            fill="#dc2626"
            fillOpacity={0.65}
            stroke="#991b1b"
            strokeWidth={1.5}
          />
        ) : null}
        {/* Target UI surface. */}
        <rect
          x={px(surfaceRect.x)}
          y={px(surfaceRect.y)}
          width={px(surfaceRect.width)}
          height={px(surfaceRect.height)}
          fill="#f59e0b"
          fillOpacity={0.85}
          stroke="#92400e"
          strokeWidth={2}
        />
        {/* Expected anchor position (dashed). */}
        <rect
          x={px(expected.x)}
          y={px(expected.y)}
          width={px(expected.width)}
          height={px(expected.height)}
          fill="none"
          stroke="#16a34a"
          strokeWidth={1.5}
          strokeDasharray="6 4"
        />
        <text x={8} y={20} fontSize={13} fill="#334155">
          布局视口 {w} × {h} CSS px
        </text>
        <text x={8} y={40} fontSize={13} fill="#2563eb">
          视觉视口 {formatCssPx(state.visualWidth)} × {formatCssPx(state.visualHeight)} CSS px
        </text>
        {state.keyboardVisible && keyboard.height > 0 ? (
          <text x={8} y={px(keyboard.y) + 20} fontSize={13} fill="#ffffff">
            键盘 {formatCssPx(keyboard.height)} CSS px 高
          </text>
        ) : null}
        <text
          x={px(surfaceRect.x) + 4}
          y={px(surfaceRect.y) + 18}
          fontSize={12}
          fill="#451a03"
        >
          目标 UI
        </text>
      </svg>
      <figcaption>
        <ul>
          <li>
            布局视口：0, 0, {w} × {h} CSS px
          </li>
          <li>
            视觉视口：({formatCssPx(state.visualOffsetLeft)}, {formatCssPx(state.visualOffsetTop)}),{" "}
            {formatCssPx(state.visualWidth)} × {formatCssPx(state.visualHeight)} CSS px
          </li>
          <li>
            键盘矩形：({formatCssPx(keyboard.x)}, {formatCssPx(keyboard.y)}),{" "}
            {formatCssPx(keyboard.width)} × {formatCssPx(keyboard.height)} CSS px，
            {state.keyboardVisible ? "可见" : "隐藏"}
          </li>
          <li>
            目标 UI 矩形：({formatCssPx(surfaceRect.x)}, {formatCssPx(surfaceRect.y)}),{" "}
            {formatCssPx(surfaceRect.width)} × {formatCssPx(surfaceRect.height)} CSS px
          </li>
          <li>
            期望锚点矩形（绿色虚线）：({formatCssPx(expected.x)}, {formatCssPx(expected.y)}),{" "}
            {formatCssPx(expected.width)} × {formatCssPx(expected.height)} CSS px
          </li>
          <li>
            遮挡热区（红色）：目标 UI 与键盘在视觉视口内的重叠部分；
            {metrics !== null
              ? `键盘遮挡面积 ${formatAreaCssPx2(metrics.keyboardObscuredArea)} CSS px²`
              : "无指标"}
          </li>
        </ul>
      </figcaption>
    </figure>
  );
}
