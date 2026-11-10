# T004 — Schema 与输入验证｜任务报告

- **任务卡：** T004（S1，4h）— 冻结 `viewportshift.scenario/v1`、布局、事件、视口、键盘、谓词、限制和结果 Schema
- **工作目录：** `~/workspace/p021-viewportshift/`
- **开始前状态：** `git status` 干净，HEAD 为 `acbd41b`（S0 PASS）；S0 证据 `evidence/s0/S0_GATE.json` status PASS
- **规格：** `P021_PROJECT_BOOK.md`（SHA 8070d7e3…）、`P021_IMPLEMENTATION_PLAN.md`（SHA 458cd409…）全文已读；项目书第 4、6 节为 Schema 依据
- **完成状态：** ✅ 完成，全部验收命令 exit 0

## 1. 做了什么

### 1.1 `src/domain/types.ts`（新建，冻结 Schema）

冻结 `viewportshift.scenario/v1`（SPEC_VERSION 1.0.0），内容全部取自项目书第 4/6 节与 S0 fixture 的既成形状，未自创字段名或单位：

- 枚举：`ViewportMode`（3 种标准模式）、`EventType`（5 种事件）、`LayoutTemplate`（4 种合成模板：chat-input / bottom-sheet / fixed-cta / search-bar）、`LayoutAnchor`（bottom/top）、`AnalysisStatus`（PASS / FAIL / UNKNOWN / BOUNDED_NO_WITNESS / INVALID）、谓词字段（4 个）与谓词操作符（5 个）。
- 核心类型：`RectMilli`（即项目书 §6.2 的 `Rect`，单位为 S0 冻结的定点 milli-px）、`GeometryMetrics`（§6.2 六字段 + S0 冻结的 `surfaceArea`；`visibleRatio` 为整数 milli-ratio 0..1000，非浮点）、`LayoutSpec` / `ViewportSpec` / `KeyboardSpec` / `ScenarioEvent`（可辨识联合）/ `FailurePredicate` / `ScenarioLimits` / `ScenarioProfile` / `Scenario` / `AnalysisResult`（结果 envelope）。
- 单位冻结：全部数值字段为整数 milli-px（1 单位 = 1/1000 CSS px，§4.1），单位由 Schema 版本本身声明（`SCHEMA_UNIT = "css-px-milli"`），不按场景选择。S0 fixture 无 `unit` 字段仍能通过校验，正是因此——见 §4 的决策记录。
- 冻结数值界：`MAX_DIMENSION_MILLI = 10_000_000`（= 10,000 CSS px）、`MAX_AT_MS = 2_147_483_647`、`MAX_EVENTS_LIMIT = 64`、`MAX_DEPTH_LIMIT = 16`、`MAX_NODES_LIMIT = 1_000_000`。
- 冻结默认 limits：`DEFAULT_LIMITS = { maxEvents: 8, maxPanMilli: 500000, maxDepth: 8, maxNodes: 10000, scale: 1 }`（`maxDepth` / `maxNodes` 为 §4.5 要求的 BFS 界；线形中可选，缺失时填默认）。
- 冻结错误码：22 个 `ValidationCode`（INVALID 类 13 个、UNKNOWN 类 9 个），为契约一部分，不得静默改名。

### 1.2 `src/domain/validate.ts`（新建，纯函数验证器）

`validateScenario(input: unknown): ValidationResult`，只做 Schema + 静态验证，不实现 T005/T006 的业务逻辑（不调状态机、不算几何、不做 BFS）：

- 固定检查顺序（13 步，文档写在文件头）：root → scenario_id → seed → unit → layout → viewport → keyboard → mode → events（逐事件 → 时钟单调 → 重复 id）→ failure_predicates → limits → profile.scale → 事件数 vs maxEvents。同一非法输入每次返回同一错误码（同顺序、同集合）。
- 分类规则：结构违规 → INVALID（缺字段、错类型、负尺寸、零面积 surface、非正视口、非法单位、非法闭枚举、非法 limits、重复事件 id、非法 atMs）；合规但超出模型范围 → UNKNOWN（非 1 scale、未知模式/事件类型/布局模板、时间倒退、键盘高度超限、事件数超限、平移超限），与项目书 §3.4 的 UNKNOWN 清单一致；INVALID 优先于 UNKNOWN。
- 单位规则（无隐式换算、不猜）：显式 `unit` 字段 ≠ `css-px-milli` → INVALID `illegal_unit`；维度写成 `"390px"` 这类带单位字符串 → INVALID `illegal_unit`；缺失 `unit` 字段不报错（v1 已定单位，无可猜之处）。
- 静态范围检查与 S0 的 fail-closed 分类逐项对齐：事件 `keyboardHeight` ∈ [0, layoutHeight]、时钟单调不减（等时间戳允许，保持数组顺序）、事件数 ≤ `limits.maxEvents`、每项平移 |dx|/|dy| ≤ `limits.maxPanMilli`。
- 不修改输入（test:validation 中以 JSON 快照验证）；不含 Date.now / setTimeout / Math.random / 系统时钟（grep 验证，见日志 10）。
- 归一化：VALID 时返回填好冻结默认值（limits.maxDepth/maxNodes/scale、profile、unit）的 typed `Scenario`；INVALID/UNKNOWN 时 `scenario` 为 null（UNKNOWN 输入可能含枚举外字符串，无法装入冻结类型，且下游求值器只应接收 VALID 场景）。

### 1.3 `tests/fixtures/schema/`（新建，50 个 fixture + `EXPECTED.json`）

正例 12 / 负例（INVALID）28 / 边界与 UNKNOWN 10，覆盖：缺字段（layout/scenario_id/events/mode/limits/阈值/事件 id/键盘高度/滚动 dy）、非法单位（`unit: "px"`、 `"390px"`）、负尺寸、零面积、非正视口、浮点维度、字符串维度、非法 anchor/谓词字段/谓词操作符、负 atMs、重复事件 id、超限 limits、空 id、超大维度、INVALID+UNKNOWN 混合（INVALID 优先）、非 1 scale、未知模式/事件类型/模板、时间倒退、键盘超高（事件与声明两种）、事件数超限、平移超限、双 UNKNOWN 问题、边界例（恰好 maxEvents=8、平移恰好 maxPanMilli、键盘高度恰好等于布局高、等时间戳、空 events/空谓词、任意合法 seed、显式合法 unit、缺失可选 limits/profile）。

### 1.4 `scripts/`（新建）与 `package.json`（唯一改动文件）

- `scripts/t004-lib.mjs`：T004 域模块的内存转译加载器（复用项目自身 TypeScript 依赖与 `s0-lib.mjs` 的模式/禁令词表，不改 S0 脚本）。
- `scripts/test-schema.mjs`（`npm run test:schema`）、`scripts/test-validation.mjs`（`npm run test:validation`）。
- `package.json`：仅新增两条 scripts（`test:schema`、`test:validation`），其余一字未动。

## 2. 改了哪些文件

| 文件 | 变动 |
|---|---|
| `src/domain/types.ts` | 新建 |
| `src/domain/validate.ts` | 新建 |
| `scripts/t004-lib.mjs` | 新建 |
| `scripts/test-schema.mjs` | 新建 |
| `scripts/test-validation.mjs` | 新建 |
| `tests/fixtures/schema/`（50 个 fixture + `EXPECTED.json`） | 新建 |
| `package.json` | 仅新增 2 条 scripts |
| `handoff/T004/` | 本任务交接材料 |

未改动：`tests/fixtures/s0/`、`oracle/python/`、`evidence/s0/`、`src/domain/viewport-state.ts`、`src/domain/geometry.ts`、`scripts/s0-*.mjs`、两份规格文件。S0 回归重跑后 `evidence/s0/` 输出内容与 S0 记录完全一致（`git status` 无任何 evidence 改动）。

## 3. 验收命令逐条输出（原文关键行）

完整日志见 `handoff/T004/test_logs/`。各命令均 exit 0：

### `npm run typecheck`（日志 01）

```text
> viewportshift@0.1.0 typecheck
> tsc --noEmit
```

严格模式，exit 0，无错误。

### `npm run test:schema`（日志 02）

```text
checks passed: 259, checks failed: 0

test:schema: PASS
```

259 项检查：冻结常量/枚举/默认 limits（11 项）、禁令词扫描、50 个 fixture 各 4–6 项（outcome、错误码顺序、两次运行稳定性、VALID 归一化 / 非 VALID 的 null scenario）。

### `npm run test:validation`（日志 03）

```text
tests/fixtures/s0/s0-edge-clock-regression.json: outcome=UNKNOWN codes=[event_clock_regression]
tests/fixtures/s0/s0-edge-keyboard-too-tall.json: outcome=UNKNOWN codes=[keyboard_height_out_of_range]
tests/fixtures/s0/s0-edge-scale-2.json: outcome=UNKNOWN codes=[unsupported_scale]
tests/fixtures/s0/s0-edge-unknown-mode.json: outcome=UNKNOWN codes=[unsupported_mode]
tests/fixtures/s0/s0-edge-zero-area.json: outcome=INVALID codes=[zero_area_surface]

checks passed: 273, checks failed: 0

test:validation: PASS
```

48 个主 S0 fixture 全部 VALID（0 issues），5 个 edge fixture 分类与 hand-authored `expected_status` 完全一致；另含每 fixture 3 次运行确定性与输入不被修改的检查。

### S0 回归（日志 04–08）

```text
S0 state-machine: PASS        (checks passed: 68, checks failed: 0)
S0 geometry (TS): PASS        (checks passed: 627, checks failed: 0)
S0 oracle (Python): PASS      (checks passed: 117, checks failed: 0)
S0 determinism: PASS          (checks passed: 6, checks failed: 0)
S0 gate: PASS (53/53 parity: 48 main + 5 edge, 12/12 planted, 0 false positives, 100 runs / 1 hash)
```

`npm run s0:gate` 关键行原文：

```text
S0 gate: scenarios=48 parity=53/53 planted=12/12 falsePositives=0 edge=5/5 determinism=100 runs, tsUnique=1, pyUnique=1
analysisSha256: a7584d47023c38c19cb7fc9cb71c671744d4917f9a67e1ee9f3c8021375165df
gateSha256: 65b4b32f4a5298642fd3de5a64441ed7d214e2519d118b8b67a7871ba73aca26
checks passed: 120, checks failed: 0
```

与 S0 记录的哈希（analysis `a7584d47…`、gate `65b4b32f…`）完全一致，无回归。

### `npm run build`（日志 09，额外回归）

```text
✓ 28 modules transformed.
✓ built in 1.59s
```

exit 0。

### 禁令词 grep（日志 10）

对 5 个 T004 新文件 grep `Date.now|setTimeout|setInterval|Math.random|new Date(|performance.now|randomUUID`：无匹配（exit 1 = 无匹配，符合预期）。

## 4. 测试数

| 套件 | 检查数 | 失败 |
|---|---|---:|
| `test:schema` | 259 | 0 |
| `test:validation` | 273 | 0 |
| `typecheck` | 0 错误 | 0 |
| `s0:state-machine` | 68 | 0 |
| `s0:geometry` | 627 | 0 |
| `s0:oracle` | 117 | 0 |
| `s0:determinism` | 6 | 0 |
| `s0:gate` | 120 | 0 |
| `build` | exit 0 | 0 |
| **合计检查** | **1470** | **0** |

Schema fixture：50 个（12 VALID / 28 INVALID / 10 UNKNOWN）；S0 回归：53 个 fixture（48 主 + 5 edge）。

## 5. 关键决策记录（供 T005/T013 复核）

1. **单位缺失不判 INVALID 的理由：** 任务要求“单位缺失或非法即 INVALID，不猜”，但 S0 fixture 无 `unit` 字段且必须通过新 Schema。冻结方案：单位由 Schema 版本 v1 声明（milli-px），不是按场景选择的值，因此“缺失 `unit` 字段”不存在需要猜测的单位；显式 `unit` ≠ `css-px-milli`、或维度写成 `"390px"` 时判 INVALID `illegal_unit`。此决策写在 `types.ts` 与 `validate.ts` 文件头。
2. **有效 scale 以 `profile.scale` 为准，`limits.scale` 仅做类型检查：** 与 S0 实现（`geometry.ts` 只读 `profile.scale`）完全一致，避免 S0 edge scale-2 fixture（profile=2、limits=1）被误判。未来修订可在 v2 将 `limits.scale` 提升为准权威字段。
3. **结构违规 → INVALID、超出模型范围 → UNKNOWN：** 闭枚举中 anchor/谓词字段/谓词操作符非法判 INVALID（Schema 语法），而 mode/事件类型/布局模板未知判 UNKNOWN（模型外输入，§3.4）；与 S0 edge 分类的 5 个用例逐项一致。
4. **未知附加字段忽略：** 项目书 §6.1 称场景“至少包含”所列字段；S0 fixture 自带的 `expected_status` / `planted_error` 即为附加字段。缺失必填字段仍以 `missing_field` 捕获。
5. **项目书 §6.1 写“由 T005 schema 冻结”与任务卡/实施计划 §5（T004 冻结）存在交叉引用出入：** 按任务指派与实施计划执行，T004 完成冻结；请 T013 注意该文字出入是否为规格笔误。
6. **BFS 界默认值（`maxDepth: 8`、`maxNodes: 10000`）由 T004 冻结：** T008 实现 BFS 时沿用；若搜索空间需要调整，须走 Schema 修订（v2），不得静默改值。
7. **未实现 T005/T006：** `validate.ts` 不含模式求值器与事件模型，仅做静态验证；`types.ts` 仅含类型与常量。

## 6. 未解决项

无。

## 7. 交接文件

- `handoff/T004/TASK_REPORT.md`（本文件）
- `handoff/T004/changed_files.txt`（git status / diff 清单）
- `handoff/T004/test_commands.txt`（跑过的命令）
- `handoff/T004/test_logs/`（01–12 号完整日志）
- `handoff/T004/sha256.txt`（新增/改动文件的 SHA-256，共 57 项）
