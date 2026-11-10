# P021 T011 — 独立审查 P2 登记册（REVIEW_P2_REGISTER.md）

任务：P021 ViewportShift T011（S4）。本文件归档所有已知 P2 的原文与处理结果。

## 0. 编纂规则（必读）

- **逐字原文**：§A 中引用的文字，逐字抄录自仓库快照内的交接文件（`handoff/T007/`、`handoff/T008/`、`handoff/T009/`、`handoff/T009-FIX/`、`handoff/T010/` 的 `TASK_REPORT.md` 与 `unresolved_items.md`）或 `git HEAD` 的源码，未改一字。出处标在每段之前。

- **协调员摘要，非逐字原文**：凡标此记号的条目，其逐字审查原文不在仓库快照中，以下文字是 T011 任务书中协调员给出的摘要/指令转述，不得当作审查报告原文引用，不得据此编造逐字文本。

- **映射说明**：S2 审查遗留 6 项 P2（T007 2 项 + T008 4 项）与 T010 审查遗留 4 项 P2 的编号（T007 P2-1/P2-2、T008 P2-1…P2-4、T010 P2-1…P2-4）均按 T011 任务书的写法；T009 审查的 8 项 P2 的逐条原文不在仓库快照中（见 §C）。

- 本文件只归档、不修复；修复状态见 §B。

## A. 逐字原文（仓库快照内已有）

### A.1 T007 TASK_REPORT.md §7（分层方式，逐字原文）

> - **分层方式（说明，非违反）：** 计划 §6.1 要求 Python Oracle 与 TS“不共享算法模块、不相互调用”。本任务的 Python Oracle（`geometry_full_oracle.py`）**复用同一侧的 Python Modes Oracle**作重放/校验层，矩形几何则在本文件内独立重写；这与 TS 侧 `geometry-eval.ts` 复用同一侧的 `modes.ts` 完全对称。两侧之间仍无任何共享代码或调用，逐字段差分 34/34 通过。S0 的 `geometry_oracle.py` 未动、未被复用。

### A.2 T007 unresolved_items.md（全文，逐字原文）

```
# T007 — 未解决项

无未解决项。

- 全部验收命令通过（`test:geometry` 629 checks、`oracle:diff:geometry` 86 checks / parity 34/34、`typecheck`）。
- S1 七条回归与 `s0:gate` 全部通过，S0 gate 哈希 `65b4b32f4a5298642fd3de5a64441ed7d214e2519d118b8b67a7871ba73aca26` 保持不变。
- 工作中发现的 3 个问题均已修复并记录在 `TASK_REPORT.md` §6（D10/D11 fixture 期望手误、Python Oracle 缺 `import json`、差分脚本 oc 计数错误）。
- 无需 Sam 决策的事项；无遗留 TODO。T008 可按计划启动。
```

### A.3 T008 TASK_REPORT.md §6（与计划/项目书的偏差，逐字原文）

```
## 6. 与计划/项目书的偏差

1. **无 Python BFS Oracle**：T008 任务卡只要求 `test:bfs` 与 `test:bfs:determinism`；BFS 复用 T007 evaluator（TS/Python parity 已由 `oracle:diff:geometry` 34/34 覆盖），未新建独立 Python BFS Oracle。计划 §6.1 提到的 witness sequence 对照由 runner 的独立暴力枚举 + T007 重放覆盖（见 §4）。如 T011 要求 Python BFS parity，需另开任务。
2. **fail-closed 时的 `limits` 字段**：`searchBfs` 对 INVALID/UNKNOWN 输入返回默认 limits（maxDepth 8 / maxNodes 10000），因输入 limits 本身可能非法、不可信。这是有意选择，记录在案。
3. **初始态谓词**：若谓词在初始态已触发，返回空 witness（`witnessLength: 0`，`firstFailedStepIndex: -1`）。11 个 fixture 均未触发该分支；语义在 `bfs.ts` 头注中冻结。
4. **`package.json`**：仅追加 `test:bfs` 与 `test:bfs:determinism` 两个脚本；文件保持原单行压缩格式（初版误写成缩进格式，已恢复为单行最小 diff）。
```

### A.4 T008 unresolved_items.md（全文，逐字原文）

```
# P021 T008 — 未解决项

无遗留阻塞。以下为过程中发现并已处理的问题与说明性备注：

1. [已修正] 初版 dedup fixture 曾用谓词 `keyboardObscuredArea > 100000000000`，被 T004
   冻结校验拒绝（`value_out_of_range`：谓词阈值上限为 MAX_DIMENSION_MILLI =
   10000000）。这是校验器的正确行为，不是 bug。已改用独立枚举计数设计：
   全键 74 态 vs naive-sum 键 34 态，BFS nodesVisited/nodesEnqueued = 74。
2. [说明] 未新建独立 Python BFS Oracle（见 TASK_REPORT §6.1）：T008 任务卡只要求
   test:bfs 与 test:bfs:determinism；witness 对照由 runner 独立暴力枚举 + T007
   重放覆盖。如 T011 要求 Python BFS parity，需另开任务。
3. [说明] fail-closed 时 `searchBfs` 返回默认 limits（maxDepth 8 / maxNodes 10000），
   因输入 limits 本身可能非法、不可信。有意选择，见 TASK_REPORT §6.2。
```

### A.5 T009 unresolved_items.md（全文，逐字原文）

```
# T009 未解决项

以下 5 项未在本任务内解决，均为可留待 T012 E2E 补做的交互验证缺口，
不阻塞 T009 验收（验收命令全部 exit 0，184 断言通过）。

1. **点击后键盘可见的 SVG 状态无截图。** 截图用 headless shell
   `--screenshot` 静态抓取，无法交互点击时间轴；现有截图的 SVG
   均显示初始选中状态（键盘隐藏）。键盘可见矩形与红色遮挡热区
   的渲染已由 DOM 断言与 `rectIntersection` 引用检查覆盖，但无
   “点击步骤 1 后”的出图证据。T012 E2E（可点击的浏览器自动化）
   可补。
2. **JSON 导出未做自动化点击验证。** 导出按钮（Blob 下载、
   domain canonical JSON）已实现并在界面上可见，但 `test:ui`
   未模拟点击下载验证文件内容。T012 可补下载断言。
3. **键盘可操作性未做真实 Tab 遍历断言。** 全部控件均为原生
   button / input / select / radio（Tab / 方向键 / Enter 可走完
   主流程是设计保证），并有 `:focus-visible` 样式，但 `test:ui`
   未做真实键盘遍历的自动化断言。T012 可补。
4. **四布局对比表只在当前模式下重放。** 界面上的对比表固定当前
   模式 × 四布局；3 模式 × 4 布局的完整矩阵未在界面上展开。
   逻辑层 sweep（4 模板 × 3 模式的 BFS 状态断言）已在 `test:ui`
   中覆盖；界面矩阵如需展开是 T010/T012 的可选增强。
5. **见证面板只展开首个失败步骤的前后状态。** 按任务卡要求
   （事件序列、首个失败谓词、前后状态、可复算 JSON）已满足；
   见证长度 > 1 时各见证步骤的逐项状态未逐一展开显示，只有
   canonical JSON 可复算。如需逐项展开是后续可选增强。
```

### A.6 T009-FIX TASK_REPORT.md（关于 8 项 P2 的逐字原文）

> 任务：只修 T009 独立审查的唯一 P1（P1-1）。不碰 8 项 P2（已登记留待 T012/T013），不碰 T010–T014，不改冻结文件。未 git commit（由协调员统一提交），未 push，未写 Drive，未对外发消息。

### A.7 T009-FIX unresolved_items.md（全文，逐字原文）

```
# T009-FIX — unresolved_items.md

- 无。本次任务只修 P1-1，已完成并通过全部四条验收命令（见 TASK_REPORT.md §5–§6）。
- T009 独立审查的 8 项 P2 未碰，已登记留待 T012/T013，按任务要求不在此处理。
- 未 git commit：按任务要求由协调员统一提交；未 push，未写 Drive，未对外发消息。
```

### A.8 T010 TASK_REPORT.md §6（上游遗留清单，逐字原文）

```
## 6. 上游遗留清单（只记录、不处理；按任务要求原样抄录）

> 另请注意（只记录、不处理）：S2 独立审查遗留 6 项 P2 与 T009 独立审查遗留 8 项 P2（含顶栏状态永不可能是 BOUNDED_NO_WITNESS、时间轴行状态忽略 GeometryStep.status 等）已登记留待 T011/T013；T009 另有复核观察一项（状态栏在 result === null 的短暂加载窗口默认显示 UNKNOWN 标签，T009 原有行为）——这些都不是 T010 的任务，不要顺手改，但不要把它们埋掉：在 TASK_REPORT.md 末尾原样抄录这份清单即可。

说明：上述清单按任务原文逐字抄录。S2 / T009 独立审查的 P2 明细条目文本不在本仓库快照中（仓库内 `handoff/T008/unresolved_items.md`、`handoff/T009/unresolved_items.md`、`handoff/T009-FIX/unresolved_items.md` 均未逐条列出这 6 + 8 项 P2），T010 未改动其中任何一项，也未重新推导条目细节；明细以独立审查报告原文为准，留待 T011/T013 处理。
```

### A.9 T010 unresolved_items.md（全文，逐字原文）

```
# P021 T010 — 未解决项

无 T010 阻塞项。验收命令全部 exit 0（`npm run build`、`node dist/viewportshift.mjs demo`、`npm run test:export` 136/136），S0 门禁回归仍 PASS（120/120）。

说明性备注（不阻塞）：

1. **CLI 的 `node:` 导入带 `// @ts-ignore`。** 本仓库无 `@types/node`，`src/cli.ts` 的三个 Node 内建导入（`node:crypto` / `node:fs` / `node:path`）各带一行 `// @ts-ignore`，`process` 在文件内最小声明；其余 domain / io 逻辑仍完整受 `tsc --noEmit` 检查。后续如引入 `@types/node` 可去掉这三行注释（需 Sam / 协调员决定是否新增依赖类型包，T010 未擅自加）。
2. **`dist/viewportshift.mjs` 为构建生成物。** CLI 入口由 `npm run build` 的第二步（vite lib）产出，未单独提交源码之外的产物；`dist/` 在 `.gitignore` 内。发布冻结（T014）时按其清单处理。
3. **上游遗留（只记录、不处理）：** S2 独立审查遗留 6 项 P2 与 T009 独立审查遗留 8 项 P2（含顶栏状态永不可能是 BOUNDED_NO_WITNESS、时间轴行状态忽略 GeometryStep.status 等）已登记留待 T011/T013；T009 另有复核观察一项（状态栏在 result === null 的短暂加载窗口默认显示 UNKNOWN 标签，T009 原有行为）。T010 未碰其中任何一项。明细条目文本见独立审查报告原文（不在本仓库快照中），见 `handoff/T010/TASK_REPORT.md` §6。
```

### A.10 src/domain/bfs.ts 头注原文（git HEAD，T011 修改前，逐字原文）

```
 *   (tests/fixtures/bfs/bfs-dedup-rv-sheet.json) pins this: two
 *   depth-2 states whose numeric fields sum to the same total are
 *   still searched separately, and the witness through the second one
 *   is found.
```

## B. P2 处理登记（T011 任务书 10 项）

| 编号 | 内容 | 来源 | T011 处理 |
|---|---|---|---|
| T008 P2-1 | 新建独立 Python BFS Oracle，对照 T008 witness/golden：最短性、tie-break、BOUNDED_NO_WITNESS 边界 | §A.3 第 1 条（逐字原文）+ §A.4 第 2 条（逐字原文） | **已修**：新建 `oracle/python/bfs_oracle.py`（独立实现搜索逻辑；过渡/几何复用同侧 Python Oracle）；纳入 `oracle:diff:coverage`；39 夹具 parity 100%（见 `evidence/coverage/ORACLE_PARITY_REPORT.json`） |
| T008 P2-2 | fail-closed 时 `searchBfs` 一律返回默认 limits；改成 limits 合法时保留输入 limits，非法时才回退默认并记录原因 | §A.3 第 2 条（逐字原文）+ §A.4 第 3 条（逐字原文） | **已修**：`src/domain/bfs.ts` 新增 `limitsFromRawInput` 与 `limitsFallbackReason`（逐字段回退，原因字符串与 Python Oracle 完全一致）；`test:bfs` 仍 277/277、`test:bfs:determinism` 仍 4/4；`test:coverage` 含 4 组回退用例 + TS/Python 对照 |
| T008 P2-3 | 初始态谓词分支与前缀触发分支各补 fixture 覆盖 | §A.3 第 3 条（逐字原文：初始态谓词语义；“11 个 fixture 均未触发该分支”） | **已修**：`tests/fixtures/bfs/` 新增 `initial-state-rv-chat.json`、`initial-state-rc-search.json`、`prefix-trigger-oc-chat.json`、`prefix-trigger-rv-chat.json`（4 个）；纳入 BFS 覆盖差分（TS/Python 一致） |
| T008 P2-4 | `src/domain/bfs.ts` 第 47–50 行头注失实（称碰撞对为 depth-2 且“witness 被找到”，实为 depth-3 且 dedup fixture 本身无 witness） | §A.10（git HEAD 逐字原文） | **已修**：只改注释，不改逻辑；修正为 depth-3 碰撞对 + fixture 本身为 BOUNDED_NO_WITNESS、无 witness |
| T007 P2-2 | `src/domain/geometry-eval.ts` 一处 INVALID 步分支经公开入口不可达 | **协调员摘要，非逐字原文**（仓库快照内无此条逐字文本） | **登记到 T013，未改代码**：静态论证——经 T004 校验的场景其 surface 宽/高恒为正整数，`computeMetrics` 在场景重放中永不返回 INVALID，故 `evaluateScenarioGeometry` 内的 INVALID 步分支不可达；冻结语料观测佐证：几何 + Golden 全部 58 个夹具、50 个步骤中 INVALID 步为 0（`test:coverage` P2 验证）；直接夹具的 INVALID 由 `evaluateDirectGeometry` 覆盖，不走该分支。不得删代码凑数 |
| T007 P2-1 | Python Oracle 复用同侧 modes_oracle.py 作重放/校验层 | §A.1（逐字原文） | **接受现状，备案**：见 `evidence/coverage/ORACLE_PARITY_REPORT.json` 的 `layeringNote`（两侧之间零共享、零调用，parity 仍是真交叉检查）；未改 Oracle 文件既有逻辑 |
| T010 P2-1 | `exportResultJson` 信任调用方传入的 `scenarioSha256`、不重算指标；改成导出时重算并比对，不一致则拒绝导出 | **协调员摘要，非逐字原文**（仓库快照内无此条逐字文本；T010 报告只记载了导入侧的哈希校验，见 §A.8） | **已修**：`src/io/json.ts` 新增纯 TS SHA-256（`sha256HexPure`，无新依赖、无 Node 内建导入），`exportResultJson` 重算比对、不一致返回 `import_hash_mismatch` 拒绝；`test:export` 仍 136/136，demo 哈希不变（resultSha256 `88f2153a…` / reportSha256 `f329e814…`） |
| T010 P2-2 | `src/cli.ts` 的 `deriveAnalysisStatus` 是 `src/ui` 同名函数的 6 行复刻且永不返回 BOUNDED_NO_WITNESS；抽成 `src/domain/` 下共享纯函数 | **协调员摘要，非逐字原文**（仓库快照内无此条逐字文本） | **已修**：新建 `src/domain/analysis-status.ts`，CLI 与 UI 共用；行为一字未变（状态只由几何评估派生，故永不返回 BOUNDED_NO_WITNESS——BFS 状态另在见证面板/信封中报告）；`test:ui` 仍 202/202、`test:export` 仍 136/136、demo 哈希不变；`t010-lib.mjs` 与 `test-ui.mjs` 的加载清单已同步加入新模块 |
| T010 P2-3 | `src/cli.ts` 三处 `// @ts-ignore`（无 @types/node 所致） | §A.9 第 1 条（逐字原文） | **已修**：新建 `src/node-shims.d.ts`（仅覆盖 CLI 用到的三个 Node 内建的最小本地类型声明），去掉三处 ignore 指令；未新增任何依赖；`typecheck` 与 `build` 均 exit 0；`src/` 与 `scripts/` 内已无该指令字面 |
| T010 P2-4 | 把独立审查报告原文归档进仓库 | §A.8（逐字原文） | **已修**：本文件即该归档（§A 为逐字原文，§C 为明确标注的非逐字部分） |

## C. 原文不在仓库快照中的条目（不得编造逐字文本）

**原文不在仓库快照中，以下为协调员摘要，非逐字原文。** T009 独立审查的 8 项 P2 与 S2 审查的部分条目细节，其逐字文本不在本仓库快照中（T010 报告 §6 已如实说明，见 §A.8；仓库内 `handoff/T008/unresolved_items.md`、`handoff/T009/unresolved_items.md`、`handoff/T009-FIX/unresolved_items.md` 均未逐条列出这 6 + 8 项 P2）。本节只记录协调员在任务书中给出的已知提示，不补写、不推导、不编造其余条目的逐字文本：

- T009 审查提示（协调员摘要，非逐字原文）：含“顶栏状态永不可能是 BOUNDED_NO_WITNESS”、“时间轴行状态忽略 GeometryStep.status 等”；另有复核观察一项（协调员摘要，非逐字原文）：“状态栏在 result === null 的短暂加载窗口默认显示 UNKNOWN 标签，T009 原有行为”。以上三点在 T011 内未改动（不在 T011 任务范围内），留待 T012/T013。
- 除上述提示与 §B 所列 10 项外，T009 审查 8 项 P2 的其余条目明细、以及 S2 审查 6 项 P2 中除 §B 所列 6 项外的任何条目（如存在），其逐字文本均不在仓库快照中，本文件不予列举；以独立审查报告原文为准，留待 T013 处理。
- T009 的 5 项未解决项（交互验证缺口）见 §A.5 逐字原文；T009-FIX 的处理范围见 §A.6、§A.7 逐字原文。

## D. 移交 T013 的事项

1. **T007 P2-2（geometry-eval.ts INVALID 步分支）**：见 §B。静态不可达论证 + 冻结语料 0 触发观测；是否删除该分支或保留为防御性代码，由 T013 独立复核决定。T011 未删代码。
2. **T009 审查 8 项 P2 的剩余条目**：见 §C。逐字原文不在仓库快照中，T011 未处理；T013 需凭独立审查报告原文复核。
3. **上游遗留决策（维持，未改动）**：`resizes-visual` 下 KEYBOARD_CLOSE 只恢复 visualHeight、不重置 visualOffsetTop；留待 T013/终审复核。T011 未改动冻结 Oracle 与 modes/events/bfs/UI 行为。
