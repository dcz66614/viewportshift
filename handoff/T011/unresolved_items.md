# P021 T011 — 未解决项

## 移交 T013 的事项

1. **T007 P2-2 — `src/domain/geometry-eval.ts` INVALID 步分支（登记，未改代码）。**
   `evaluateScenarioGeometry` 内 `computeMetrics` 返回 INVALID 时压入 INVALID 步并 fail-closed 的分支，经公开入口不可达，理由如下（静态论证 + 观测佐证）：
   - 静态：该分支要求重放某一步的 surface 宽/高 ≤ 0 或非整数；但进入重放前必经 T004 校验，校验要求 layout `widthMilli`/`heightMilli` 为正整数，`surfaceRectFor` 直接取用这两个值，故 surface 在场景重放中恒为正整数、`computeMetrics` 永不返回 INVALID。
   - 观测：冻结语料（T007 几何夹具 34 个 + T011 Golden 24 个，共 58 个夹具、50 个重放步骤）中 INVALID 步为 0（`test:coverage` P2 验证段断言）；零面积输入的 INVALID 由校验层（`evaluateGeometry` 入口）与矩形级入口（`evaluateDirectGeometry`）覆盖，不走该分支。
   - T011 未删代码（不删代码凑数）。是否删除该分支或保留为防御性代码，由 T013 独立复核决定。
2. **T009 独立审查 8 项 P2 的剩余条目。** 逐字原文不在仓库快照中（见 `handoff/T011/REVIEW_P2_REGISTER.md` §C）；T011 只处理了其中与 T010 P2-1…P2-4 对应的部分（信封完整性、状态派生复刻、`@ts-ignore`、可追溯性归档）与任务书点名的两项提示（顶栏状态、时间轴行状态——未改动，留待 T012/T013）。其余条目明细以独立审查报告原文为准，留待 T013 处理。
3. **上游遗留决策（维持，未改动）。** `resizes-visual` 下 KEYBOARD_CLOSE 只恢复 visualHeight、不重置 visualOffsetTop；留待 T013/终审复核。

## 无其他未解决项

- 全部六条验收命令 exit 0；回归数字与基线一字不差（test:schema 259、test:validation 273、test:modes 1159、test:events 1301、test:event-order 22、test:geometry 629、test:bfs 277、test:bfs:determinism 4、test:ui 202、test:export 136、s0:gate 120，gate 哈希不变，demo 双哈希不变）。
- Oracle parity 165/165（100%）；8/8 变异检出；属性 709/709；Golden 107/107。
- 无需 Sam 决策的事项；无遗留 TODO。T012 可按计划启动。
