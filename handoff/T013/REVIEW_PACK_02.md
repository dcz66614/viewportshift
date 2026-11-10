# P021 T013 — 审查包 02：几何内核 + BFS + Python Oracle

- 审查员：独立审查会话（与施工方不同会话）
- 审查对象：commit `fff40cb`
- 审查时间：2026-11-10 ~11:02–11:20 GMT
- 本包文件：`src/domain/geometry.ts`（846 行）、`src/domain/geometry-eval.ts`（387 行）、
  `src/domain/bfs.ts`（777 行）、`oracle/python/modes_oracle.py`（1296 行，抽查）、
  `oracle/python/events_oracle.py`（1499 行，抽查）、
  `oracle/python/geometry_oracle.py`（744 行，抽查）、
  `oracle/python/geometry_full_oracle.py`（598 行，抽查）、
  `oracle/python/bfs_oracle.py`（486 行，抽查）

## 所读内容

- `geometry.ts` 全文：`computeGeometry` / `computeGeometryDirect` /
  `computeMetrics` 均只在 surface 宽/高非整数或 ≤0 时返回 INVALID
  （`zero_area_surface` / `non_integer_geometry`）；`keyboardObscuredArea = |S ∩ V ∩ K|`
  三重交集、一次扣除；`visibleRatio` 用 BigInt floor；11 项合同检查
  （`geometryContractChecksFor`）。S0 `analyzeScenario` 对 INVALID 步骤记
  `stepStatus = "INVALID"`（与 UI 时间轴不同，见 P2-1）。
- `geometry-eval.ts` 全文：`evaluateScenarioGeometry` 中 INVALID 步分支
  （`computed.status !== "OK"` 时记步 `status: "INVALID"` 并停止评估）即
  T007 P2-2 的分支。头注记载 resizes-visual 保留偏移表现为 anchorDrift /
  bottomGap（夹具 T007-scen-06）。
- `bfs.ts` 全文：冻结 12 元字母表（固定顺序）、全状态 canonical JSON 去重键、
  初始态/前缀 any-step 检查、`limitsFromRawInput` 逐字段回退并记录原因字符串、
  fail-closed 结果保留合法输入 limits；头注已修正为 depth-3 碰撞对 +
  dedup 夹具本身为 BOUNDED_NO_WITNESS、无 witness（T008 P2-4 已修，核对属实）。
- Oracle 抽查：`modes_oracle.py` 的 `KEYBOARD_CLOSE` / `resizes-visual` 分支
  （~785–800 行）只恢复 `visualHeight`、不碰 `visualOffsetTop`，与 TS 一致；
  `events_oracle.py` 同样（~791 行起）；`geometry_full_oracle.py:83` 导入
  `modes_oracle` 作重放/校验层、矩形几何本文件独立实现；
  `bfs_oracle.py:66–73` 导入同侧 events/geometry_full/modes Oracle，
  搜索本身（字母表、队列顺序、去重键、界限、fail-closed limits）独立实现。
  TS 侧无任何 Python 导入、Python 侧无任何 TS 导入：两侧只共享只读夹具、
  字段名与 canonical JSON 定义。

## 独立探针（审查员亲自跑，非抄录）

- 探针脚本 `test_logs/probe-corpus-p2-5.mjs`（Node 24 直接跑仓库 `t011-lib.mjs`）：
  冻结语料 58 个夹具（geometry 34 + golden 24），共 50 个步骤，
  `INVALID` 步 = 0、`UNKNOWN` 步 = 0——与 T011 的静态论证数字一致。
- Golden 夹具 24/24 的 `expected.bfs` 缺 `nodesVisited`/`nodesEnqueued`；
  BFS 夹具 15/15 含有这两字段。`checkBfsExpected`（`scripts/t011-lib.mjs`）
  已支持在字段存在时比对节点数，故缺失只是夹具数据缺口，不是比较器缺口。
  （T011-P2-1，仍为 open P2。）

## 发现

- 无 P0/P1。
- T007 P2-1（Python Oracle 复用同侧 modes_oracle 作重放层）：**接受成立**。
  两侧分层完全对称、零跨侧共享、parity 100% 仍是真交叉检查；详见主报告 §5。
- T007 P2-2：**决定保留 INVALID 步分支为防御性代码，不删除**，理由见主报告 §4。
- T011-P2-1（Golden 缺节点数）：现状确认，仍为 open P2，修复为纯数据改动
  （给 24 个 golden 夹具补两个字段即可，比较器已就绪）。
