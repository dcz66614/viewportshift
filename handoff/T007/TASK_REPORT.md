# T007 — 遮挡与可见性几何计算｜任务报告

- **任务：** P021 ViewportShift T007（S2），只做 T007，不碰 T008 及以后
- **工作目录：** `~/workspace/p021-viewportshift/`
- **规格：** `~/workspace/P021_PROJECT_BOOK.md`（§4.4 几何契约）、`~/workspace/P021_IMPLEMENTATION_PLAN.md`（§5 T007、§6）
- **固定 seed：** `P021-VIEWPORTSHIFT-S0-2026-11-10`
- **状态：** ✅ 全部验收通过，无未解决项（见 `unresolved_items.md`）
- **未 git commit**（按任务要求，留待协调员验收后统一提交）

## 1. 做了什么

在 S0 T003 几何 PoC 之上建成正式 T007 求值层，**未改动 S0 的任何行为路径**：

| 文件 | 改动 |
|---|---|
| `src/domain/geometry.ts` | 只追加：`tripleIntersectionArea`（三重交集 \|S∩V∩K\|）、`computeGeometryDirect`（矩形级直接求值，无重放）、`geometryContractChecksFor`（11 项冻结几何契约检查）、`GEOMETRY_CONTRACT_CHECK_NAMES`。`analyzeScenario` / `computeGeometry` / `computeMetrics` 等 S0 函数一字未动 |
| `src/domain/geometry-eval.ts` | **新建**：`GEOMETRY_VERSION = "geometry/v1"`；`evaluateGeometry`（Schema-first 入口：先 T004 校验，INVALID/UNKNOWN 永不进入状态机）、`evaluateScenarioGeometry`（在 T005 正式三模式求值器上逐事件算几何 + 契约检查 + 谓词）、`evaluateDirectGeometry`（矩形级入口）、`canonicalGeometryJson` |
| `oracle/python/geometry_full_oracle.py` | **新建**：Python 独立 Oracle 完整实现。矩形几何（交集/三重交集/裁剪/可见面积/比例/bottomGap/anchorDrift/契约检查/谓词）全部在本文件内独立重写；重放与校验层复用 Python Modes Oracle（`modes_oracle.py` 的 T004 校验端口与 T005 求值器端口），与 TS 侧 `geometry-eval.ts` 复用 `modes.ts` 完全对称。**不导入、不调用任何 TS 代码** |
| `scripts/t007-lib.mjs` | **新建**：T007 共享库（6 个 domain 模块内存转译加载、fixture 加载、Python Oracle 调用、规范化哈希） |
| `scripts/test-geometry.mjs` | **新建**：`npm run test:geometry` |
| `scripts/oracle-diff-geometry.mjs` | **新建**：`npm run oracle:diff:geometry` |
| `package.json` | 只加两个脚本：`test:geometry`、`oracle:diff:geometry`（s0:* 与 S1 脚本未动；文件由单行改回单行格式，diff 仅 1 行） |
| `tests/fixtures/geometry/` | **新建目录**：13 个直接 fixture + 21 个场景 fixture（共 34 个），全部手工算好期望值（见 §2） |
| `evidence/geometry/` | `GEOMETRY_TS.json`、`GEOMETRY_PY.json`、`GEOMETRY_DIFF.json`（逐字段差分报告） |

**未改动（只读）：** `src/domain/types.ts`、`validate.ts`、`modes.ts`、`events.ts`、`viewport-state.ts`、`oracle/python/modes_oracle.py`、`events_oracle.py`、`geometry_oracle.py`（S0 Oracle）、`tests/fixtures/s0/`、S1 全部脚本。

## 2. 几何语义（项目书 §4.4，逐字落实）

- 全部 CSS px，定点整数 1/1000 px；`visibleRatio = floor(visibleArea×1000/surfaceArea)` 用 BigInt / Python 整数除法；`anchorDrift.magnitude` 用精确整数开方（TS `isqrt` BigInt 牛顿迭代 / Python `math.isqrt`），**无浮点比较、无容差**。
- `keyboardObscuredArea = |S ∩ V ∩ K|`（键盘可见时），否则 0。键盘矩形本身不遮挡视口外的部分。
- `viewportClippedArea = |S| − |S ∩ V|`；`visibleArea = |S ∩ V| − keyboardObscuredArea`，重叠区只扣一次。不变量 `visible + clipped + obscured = surfaceArea` 由 11 项契约检查逐项复核。
- `bottomGap` = 视觉视口底边 − surface 底边（有符号）。
- `anchorDrift` = surface 原点 − 声明锚点期望原点（底锚以视觉底边为准，顶锚以视觉顶边为准）+ 模长。
- 零面积 surface（宽或高 ≤ 0）→ `INVALID`（`zero_area_surface`），永不静默为 0；非整数矩形输入 → `INVALID`（`non_integer_geometry`）。
- 上游遗留决策**维持未动**：`resizes-visual` 下 `KEYBOARD_CLOSE` 只恢复 `visualHeight`、不重置 `visualOffsetTop`（fixture `T007-scen-06` 钉住：平移后关闭，`anchorDrift.dy = -200000`、`bottomGap = +200000`）；遮挡计入与否由 mode 语义决定（`resizes-visual`/`resizes-content` 下键盘矩形与 V 不相交 → 遮挡为 0、越界部分计为裁剪；`DELAYED_VISUAL_PAN` 后 V 与 K 重叠则按三重交集计入，`T007-scen-07` 钉住）。

## 3. Fixture 覆盖（34 个，`tests/fixtures/geometry/`）

直接 fixture（矩形级，无重放，`geometry-direct-01…13`）：完全可见、部分键盘遮挡、完全遮挡、视口水平裁剪、键盘与视口重叠不重复扣除（D05：`visible 17160000000 + clipped 56160000000 + obscured 60840000000 = surface 134160000000`）、零面积宽 0 / 高 0（INVALID）、边界恰好命中（D08 键盘边相切面积 0；D09 视口边相切）、bottomGap 正/零/负、anchorDrift 非零（D10 dx=10000；D11 3-4-5 三角形模长 5000）、键盘隐藏但矩形重叠（遮挡为 0）、visibleRatio 向下取整（D13：333）。

场景 fixture（`geometry-scen-01…21`）：`resizes-visual` 5 个 OK（裁剪非遮挡、开-平移-关闭保留偏移、平移后遮挡、平移夹紧、bottomGap 负）、`resizes-content` 3 个 OK（同布局对比 rv、满键盘视觉高为 0 边界、平移无空间夹紧为 0）、`overlays-content` 7 个 OK（完全可见、完全遮挡、部分遮挡、顶锚、边缘相切、滚动不改变几何、开-关恢复），fail-closed 6 个（零面积 INVALID、未知模式 UNKNOWN、scale=2 UNKNOWN、时钟倒退 UNKNOWN、键盘超高 UNKNOWN、重复事件 id INVALID）。每步的 metrics / surfaceRect / expectedAnchorRect / 契约检查名 / 触发谓词 / panReport 均有手工期望值。

## 4. 验收结果（全部通过）

| 命令 | 结果 |
|---|---|
| `npm run test:geometry` | **PASS — 629 checks，0 失败**。34 fixture，22 步，363 项契约检查；OK 26 / UNKNOWN 4 / INVALID 4；两次运行哈希相同：`c7109f327bf8d1b7dd8113c553799fe40375c75fe2ab97b0fad8b2475d5c1b9f` |
| `npm run oracle:diff:geometry` | **PASS — 86 checks，0 失败**。parity **34/34，mismatches 0**；直接 13/13、场景 21/21；rv 5 / rc 3 / oc 7 OK；TS 与 Python 分析哈希相同：`c7109f327bf8d1b7dd8113c553799fe40375c75fe2ab97b0fad8b2475d5c1b9f` |
| `npm run typecheck` | **PASS**（exit 0，无输出） |
| Python Oracle `--repeat 5` | 5 次运行 1 个哈希，与 TS 哈希相同 |

## 5. 回归（无破坏）

| 命令 | 结果（与基线一致） |
|---|---|
| `npm run test:schema` | 259 checks PASS |
| `npm run test:validation` | 273 checks PASS |
| `npm run test:modes` | 1159 checks PASS（41 fixture，29 OK / 8 UNKNOWN / 4 INVALID） |
| `npm run oracle:diff:modes` | 98 checks PASS，parity 41/41 |
| `npm run test:events` | 1301 checks PASS |
| `npm run test:event-order` | 22 checks PASS |
| `npm run oracle:diff:events` | 70 checks PASS，parity 27/27 |
| `npm run s0:geometry` | 627 checks PASS |
| `npm run s0:gate` | 120 checks PASS；53/53 parity、12/12 植入检出、0 误报、100 次 1 哈希；**gateSha256 `65b4b32f4a5298642fd3de5a64441ed7d214e2519d118b8b67a7871ba73aca26` 保持不变** |

## 6. 工作中发现并已修复的问题（共 3 个，如实记录）

1. **D10/D11 fixture 期望值作者手误（已修正，有独立验算）：** 我最初把 x 偏移的 surface 当成完全在视口内，写了 `clipped=0 / ratio=1000`；实现算出 D10 `clipped=560000000 / ratio=974`、D11 `clipped=1716000000 / ratio=921`。独立手算复核：D10 `380000×56000=21280000000`、`21280000000×1000//21840000000=974`；D11 `387000×52000=20124000000`、`20124000000×1000//21840000000=921`——实现正确，修正的是 fixture 期望值（并在 runner 的独立重推导中同样通过）。不是改期望迎合实现：修正依据是脱离实现的几何手算。
2. **`geometry_full_oracle.py` 缺 `import json`：** 首跑差分时 Python 以 `NameError` 退出（exit 1）；补 import 后通过。
3. **差分脚本的 oc 计数错误：** `parityByMode` 按 mode 全量计数，把 5 个 fail-closed 的 oc 场景也算进 oc（12 而非 7）导致检查失败；改为只计 OK 场景（`parityByModeOk`）后通过。parity 本身 34/34 未受影响。

## 7. 与计划/项目书的偏差

- **分层方式（说明，非违反）：** 计划 §6.1 要求 Python Oracle 与 TS“不共享算法模块、不相互调用”。本任务的 Python Oracle（`geometry_full_oracle.py`）**复用同一侧的 Python Modes Oracle**作重放/校验层，矩形几何则在本文件内独立重写；这与 TS 侧 `geometry-eval.ts` 复用同一侧的 `modes.ts` 完全对称。两侧之间仍无任何共享代码或调用，逐字段差分 34/34 通过。S0 的 `geometry_oracle.py` 未动、未被复用。
- **新增一层薄求值器而非重写 `geometry.ts`：** S0 的 `analyzeScenario` 保持原样（S0 gate 哈希不变即证明）；T007 正式入口是新建的 `geometry-eval.ts`。计划 T007 输出只写了 `src/domain/geometry.ts`，实际交付为 `geometry.ts`（追加纯函数）+ `geometry-eval.ts`（正式入口）；`geometry.ts` 的 S0 入口未被 T007 入口替代。
- **其余无偏差：** 字段名、契约、seed、fail-closed 分类、确定性要求均与项目书/计划一致。

## 8. 证据与交接

- 证据：`evidence/geometry/GEOMETRY_TS.json`、`GEOMETRY_PY.json`、`GEOMETRY_DIFF.json`
- 交接包：`handoff/T007/`（本报告、`changed_files.txt`、`test_commands.txt`、`test_logs/` 12 份日志、`sha256.txt`、`unresolved_items.md`）
- 日志：`handoff/T007/test_logs/`，12 条命令 exit 均为 0
