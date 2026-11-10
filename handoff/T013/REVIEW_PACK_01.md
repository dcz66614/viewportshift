# P021 T013 — 审查包 01：域核心（Schema / 校验 / 状态机 / 模式 / 事件）

- 审查员：独立审查会话（与 T001–T012 施工方不同会话；未参与施工）
- 审查对象：commit `fff40cb`（T012 已提交），工作树干净
- 审查时间：2026-11-10 ~11:02–11:20 GMT
- 本包文件：`src/domain/types.ts`（407 行）、`src/domain/validate.ts`（798 行）、
  `src/domain/viewport-state.ts`（542 行）、`src/domain/modes.ts`（626 行）、
  `src/domain/events.ts`（681 行）

## 所读内容

- `types.ts` 全文：冻结 Schema `viewportshift.scenario/v1`、milli-px 定点单位、
  `scale` 固定为 1、INVALID/UNKNOWN 分类（INVALID 优先）、冻结数值界
  （`MAX_DIMENSION_MILLI`、`MAX_DEPTH_LIMIT` 16、`MAX_NODES_LIMIT` 1000000、
  `DEFAULT_LIMITS` maxDepth 8 / maxNodes 10000）。
- `validate.ts` 全文（含 `validateScenario` 684–798 行）：校验器按固定顺序
  收集 issue；零面积布局（宽/高为 0）记 `zero_area_surface`（INVALID），
  因此已校验场景的 surface 恒为正面积——这是 T007 P2-2 不可达论证的前提。
- `viewport-state.ts` 全文：`transition()` 各事件分支。
  `KEYBOARD_CLOSE` / `resizes-visual`（355–375 行）：`visualHeight` 恢复
  `current.visualHeight + h`，其余字段 `...current` 展开保留，即
  `visualOffsetTop` 不重置——上游遗留决策的代码实现。
  `DELAYED_VISUAL_PAN`（~440–490 行）：按 pan 前状态算 `maxLeft/maxTop` 并 clamp，
  记录 requested/applied 与原因。`SCROLL` 只动 scroll 偏移，下限 0。
- `modes.ts` 全文：模式白名单（未知模式 fail-closed UNKNOWN，不落入
  overlays 分支）；逐步骤 §4.2 合同检查；`KEYBOARD_CLOSE` / `resizes-visual`
  检查 `rv_offsets_unchanged`（`next.visualOffsetTop === prev.visualOffsetTop`，
  283–310 行）；头注明确记载保留偏移的 PoC 行为。
- `events.ts` 全文：`eventChecksFor` 的 `ev_close_offsets_retained` /
  `ev_close_pending_retained`（~360 行）同样钉住保留行为；头注（~40–60 行）
  完整记载该决策的理由与后果（close 后保留偏移可能超过恢复后的 pan 上限，
  但 clamp 只约束 pan 步骤本身），并点名钉住夹具
  `tests/fixtures/events/events-rv-open-pan-close-retained.json`。
  审查员独立核对该夹具：`expected.final.visualOffsetTop = 100000`、
  `visualHeight = 844000`、`pendingPan = {dx: 0, dy: 100000}`，与决策一致。

## 发现

- 无 P0/P1。本包未发现正确性问题。
- 上游遗留决策（resizes-visual 下 KEYBOARD_CLOSE 只恢复 visualHeight、不重置
  visualOffsetTop）复核见 `INDEPENDENT_REVIEW.md` §9：TS 侧三层
  （viewport-state 转移、modes 合同检查、events 事件检查）与 Python Oracle
  三层（modes_oracle、events_oracle、geometry_oracle 的 rv close 分支）
  均一致，且项目书对此保持沉默（只在 §140 描述 open 时缩小视觉视口）。
  建议：**维持（MAINTAIN）**，不改。改动将破坏 modes/events/geometry parity
  与 S0 gate，需规格修订 + 新 S0，由终审定。
- `src/` 全仓 grep：无 `Math.random` / `Date.now` / `new Date` / `fetch(` /
  `XMLHttpRequest` / `WebSocket` / `localStorage`；无 `TODO` / `FIXME` / `HACK`。
