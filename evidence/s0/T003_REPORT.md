# P021 ViewportShift — T003 几何 Oracle PoC 与 S0 Gate 报告

- **任务：** T003 几何 Oracle PoC 与 S0 Gate（S0，实施计划 §5）
- **结论：** T003 通过，**S0 GATE = PASS**。48/48 主场景 Oracle parity、12/12 植入错误检出、正常场景误报 0、5/5 边界 fail-closed、100 次运行 1 个 SHA-256。S0 全部通过条件（实施计划 §0.1）满足，T004–T014 的启动门禁已打开（是否启动由协调员决定，本任务不启动 T004–T014）。
- **输入：** T001 骨架、T002 状态机 PoC（`evidence/s0/T002_REPORT.md` §2.2 的 7 条已冻结建模选择已全文复核，Oracle 按同一语义实现，无分歧、无静默改预期）、固定 seed `P021-VIEWPORTSHIFT-S0-2026-11-10`。
- **不做：** 不碰 T004–T014；不改规格书与实施计划；不改 T002 状态机与 8 个 PoC fixture；不删场景、不放宽阈值、不忽略字段、不由 TS 生成 Oracle 期望值。

## 1. 交付物

| 文件 | 说明 |
| --- | --- |
| `src/domain/geometry.ts` | TS 矩形几何 + 场景分析：定点整数指标、谓词求值、规范化 JSON |
| `oracle/python/geometry_oracle.py` | 独立 Python Oracle（替换 T001 空桩）：状态机 + 几何 + 谓词 + CLI，stdlib only |
| `tests/fixtures/s0/s0-geometry-01.json` … `s0-geometry-48.json` | 48 场景 fixtures（4 布局 × 3 模式 × 4 事件序列） |
| `tests/fixtures/s0/s0-edge-*.json`（5 个） | 边界 fail-closed fixtures：零面积、未知模式、scale=2、时钟倒退、键盘超高 |
| `scripts/s0-lib.mjs` | 四个验收脚本的共享库（fixture 加载、domain 转译加载、哈希、Oracle 调用） |
| `scripts/s0-geometry.mjs` / `s0-oracle.mjs` / `s0-determinism.mjs` / `s0-gate.mjs` | 四个验收脚本（`npm run s0:geometry` 等） |
| `package.json` | 新增 `s0:geometry`、`s0:oracle`、`s0:determinism`、`s0:gate` 四个脚本（其余未变） |
| `evidence/s0/S0_GEOMETRY_TS.json` | TS 侧 53 场景分析结果 + `analysisSha256` |
| `evidence/s0/S0_GEOMETRY_PY.json` | Python Oracle 侧 53 场景分析结果 + `analysisSha256` |
| `evidence/s0/S0_DETERMINISM.json` / `S0_DETERMINISM_PY.json` | 100 次运行确定性证据 |
| `evidence/s0/S0_GATE.json` | S0 门禁报告（`status: PASS`，含 `gateSha256`） |
| `evidence/s0/T003_REPORT.md` | 本报告 |
| `README.md` | 仅状态行更新为 `SPEC_FROZEN / S0_PASS` |

## 2. 冻结的几何语义（项目书 §4.4，T003 冻结）

单位：定点整数，1 单位 = 1/1000 CSS px。`visibleRatio` 为整数毫比 `floor(visibleArea × 1000 / surfaceArea)`（BigInt 精确除法 / Python `//`，无浮点）；`anchorDrift.magnitude` 为精确整数平方根（BigInt 牛顿迭代 / Python `math.isqrt`，无 `Math.sqrt`）。

设 S 为 surface 矩形，V 为视觉视口矩形，K 为键盘矩形：

- `keyboardObscuredArea = |S ∩ V ∩ K|`（键盘可见时，否则 0）。单一均匀定义即编码模式语义：`resizes-visual` / `resizes-content` 下 K 与 V 不相交（键盘位于缩小后的视觉视口下方），遮挡为 0、视口外的元素计为裁剪而非遮挡；`overlays-content` 下 V 覆盖全布局，三重交集等于 `|S ∩ K|`；`resizes-visual` 下一次 `DELAYED_VISUAL_PAN` 后 V 可与 K 重叠，重叠部分只扣一次。
- `viewportClippedArea = |S| − |S ∩ V|`；`visibleArea = |S ∩ V| − keyboardObscuredArea`。不变量（逐 step 断言）：`visible + clipped + obscured = surfaceArea`。
- `bottomGap = (visualOffsetTop + visualHeight) − surfaceBottom`（有符号；正为间隙，负为越界）。
- `anchorDrift`：surface 实际原点减去“锚点相对视觉视口”的期望原点（底部锚：期望 y = 视觉底边 − offset − height；顶部锚：期望 y = 视觉顶边 + offset；x 期望 = 视觉左 + x）。
- 零面积 surface（宽或高 ≤ 0）为 INVALID；不支持模式为 UNKNOWN；scale ≠ 1、时钟倒退、键盘高度越界为 UNKNOWN（T002 重放语义：停在首个 UNKNOWN 事件，状态保持为该事件之前）。

场景状态由**终态**谓词决定：键盘关闭后恢复的场景（open-close / open-scroll-close）终态 PASS，即使中间 open 步骤曾失败；每一步触发的谓词全部记录并逐字段对照，瞬时失败在证据中可见、不隐藏（T008 BFS 将采用 any-step 语义找最短见证）。

统一失败谓词（全部 48 场景相同）：`visibleRatio < 1000`、`keyboardObscuredArea > 0`、`bottomGap < 0`、`anchorDriftMagnitude > 50000`（50 CSS px 容差）。

## 3. 48 场景设计（4 布局 × 3 模式 × 4 事件序列）

视口固定 390×844 CSS px（390000×844000），键盘高 300 CSS px（300000）。

| 布局 | 锚点 | 几何（milli-px） |
| --- | --- | --- |
| chat-input 聊天输入框 | bottom，offset 0 | x=0，w=390000，h=56000 |
| bottom-sheet 底部面板 | bottom，offset 0 | x=0，w=390000，h=300000 |
| fixed-cta 固定 CTA | bottom，offset 16000 | x=16000，w=358000，h=48000 |
| search-bar 搜索栏 | top，offset 12000 | x=16000，w=358000，h=48000 |

| 序列 | 事件 |
| --- | --- |
| open | OPEN@100 |
| open-close | OPEN@100，CLOSE@200，SETTLED@300 |
| open-scroll-close | OPEN@100，SCROLL@150（dy=100000），CLOSE@200，SETTLED@250 |
| open-pan | OPEN@100，PAN@200（dx=0，dy=10000），SETTLED@300 |

手算预期（fixture 内 `expected_status`，非实现生成）：FAIL 当且仅当序列为 open / open-pan、布局为 chat/sheet/cta、模式为 resizes-visual（裁剪）或 overlays-content（键盘遮挡）；其余 36 个 PASS。`resizes-content` 下底部布局随缩小后的布局视口重新锚定，始终完全可见；搜索栏为顶部锚，键盘够不着，10px 平移后仍完全可见且漂移 10000 < 50000 容差。

## 4. 验收命令逐条结果（退出码均为 0）

完整逐字日志见 `handoff/T003/test_logs/`（`01`–`05`）。

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `npm run typecheck` | 0 | `tsc --noEmit` 通过（strict） |
| `npm run s0:geometry` | 0 | 627 项检查，0 失败；53 场景 TS 分析，植入 12/12，误报 0 |
| `npm run s0:oracle` | 0 | 117 项检查，0 失败；Python Oracle 53 场景，植入 12/12，误报 0 |
| `npm run s0:determinism` | 0 | 6 项检查，0 失败；TS 与 Python 各 100 次，均为 1 个哈希且一致 |
| `npm run s0:gate` | 0 | 120 项检查，0 失败；**S0 gate: PASS** |

```text
S0 gate: scenarios=48 parity=53/53 planted=12/12 falsePositives=0 edge=5/5 determinism=100 runs, tsUnique=1, pyUnique=1
analysisSha256: a7584d47023c38c19cb7fc9cb71c671744d4917f9a67e1ee9f3c8021375165df
gateSha256: 65b4b32f4a5298642fd3de5a64441ed7d214e2519d118b8b67a7871ba73aca26
```

- 53 场景分析哈希（48 主场景 + 5 边界）：`a7584d47023c38c19cb7fc9cb71c671744d4917f9a67e1ee9f3c8021375165df`（TS 与 Python 各自独立算出，完全一致）。
- 100 次确定性哈希（48 主场景）：`2f85b424fd3eece3865fd4cc0f27ed4eb02687277db7dfe1930dfa55878769d6`（TS 100 次 1 个、Python 100 次 1 个、两侧一致）。
- `gateSha256` 已用独立 Python 脚本重算验证一致（规范化 JSON 去掉 `gateSha256` 字段后取 SHA-256）。
- 证据 JSON 中无机器绝对路径（grep 0 命中）。

## 5. 12 个植入错误检出明细（终态指标，单位 milli-px / (milli-px)²）

| 场景 | 种类 | 触发谓词 | visibleRatio | obscured | clipped | bottomGap | drift |
| --- | --- | --- | ---: |---:|---:|---:|---:|
| S0-chat-rv-open | viewport-clipped | visibleRatio, bottomGap, anchorDriftMagnitude | 0 | 0 | 21840000000 | -300000 | 300000 |
| S0-chat-rv-open-pan | viewport-clipped | visibleRatio, bottomGap, anchorDriftMagnitude | 0 | 0 | 21840000000 | -290000 | 290000 |
| S0-chat-oc-open | keyboard-obscured | visibleRatio, keyboardObscuredArea | 0 | 21840000000 | 0 | 0 | 0 |
| S0-chat-oc-open-pan | keyboard-obscured | visibleRatio, keyboardObscuredArea | 0 | 21840000000 | 0 | 0 | 0 |
| S0-sheet-rv-open | viewport-clipped | visibleRatio, bottomGap, anchorDriftMagnitude | 0 | 0 | 117000000000 | -300000 | 300000 |
| S0-sheet-rv-open-pan | viewport-clipped | 全部 4 项 | 0 | 3900000000 | 113100000000 | -290000 | 290000 |
| S0-sheet-oc-open | keyboard-obscured | visibleRatio, keyboardObscuredArea | 0 | 117000000000 | 0 | 0 | 0 |
| S0-sheet-oc-open-pan | keyboard-obscured | visibleRatio, keyboardObscuredArea | 0 | 117000000000 | 0 | 0 | 0 |
| S0-cta-rv-open | viewport-clipped | visibleRatio, bottomGap, anchorDriftMagnitude | 0 | 0 | 17184000000 | -284000 | 300000 |
| S0-cta-rv-open-pan | viewport-clipped | visibleRatio, bottomGap, anchorDriftMagnitude | 0 | 0 | 17184000000 | -274000 | 290000 |
| S0-cta-oc-open | keyboard-obscured | visibleRatio, keyboardObscuredArea | 0 | 17184000000 | 0 | 16000 | 0 |
| S0-cta-oc-open-pan | keyboard-obscured | visibleRatio, keyboardObscuredArea | 0 | 17184000000 | 0 | 16000 | 0 |

全部 12 个首个失败步骤均为 step 0（键盘打开即失败）。值得记录的一例：S0-sheet-rv-open-pan 中 10px 平移后底部面板只有 10px 高的条带进入视觉视口，而该条带恰好落在键盘矩形内——按三重交集定义计为遮挡 3900000000、可见面积仍为 0，而非可见 33‰。这正是 §2 定义想要区分的“进入视野但被键盘盖住”。

36 个正常场景全部 PASS、0 误报；其中 12 个 open-close / open-scroll-close 场景在 step 0 曾瞬时失败、关闭后恢复，终态 PASS（`firstFailedStepIndex=0`，终态谓词为空，见 `S0_GATE.json`）。

## 6. 5 个边界用例（fail-closed）

| 场景 | 预期 | 实际 | reason |
| --- | --- | --- | --- |
| S0-edge-zero-area（surface 高 0） | INVALID | INVALID | `zero_area_surface` |
| S0-edge-unknown-mode（mode `resizes-unknown`） | UNKNOWN | UNKNOWN | `unsupported_mode` |
| S0-edge-scale-2（profile scale=2） | UNKNOWN | UNKNOWN | `unsupported_scale`，failedEventId=e1 |
| S0-edge-clock-regression（OPEN@200 后 SCROLL@100） | UNKNOWN | UNKNOWN | `event_clock_regression`，failedEventId=e2 |
| S0-edge-keyboard-too-tall（OPEN 高 900000 > 844000） | UNKNOWN | UNKNOWN | `keyboard_height_out_of_range`，failedEventId=e1 |

5 个边界用例 TS/Python 逐字段 parity 全部 MATCH。

## 7. Oracle 独立性核查

- Python Oracle 仅 import stdlib（`argparse`、`hashlib`、`json`、`math`、`sys`、`pathlib`、`__future__`）；无 subprocess、无 `node`、无 `.ts` 引用、无 TS 调用（grep 0 命中；唯一含 `src/domain/geometry.ts` 字样的行是模块 docstring 中说明“语义与该文件一致”，非代码引用）。
- TS 与 Python 只共享只读 fixture 与字段名：布局锚点参数、谓词、事件均来自 fixture JSON；状态转移与几何在两侧各自独立实现。
- 逐字段对照：每场景的规范化 JSON 全文逐字节相等才算 parity——覆盖 status、13 个终态字段、键盘矩形、surface 矩形、期望锚点矩形、全部 7 个几何指标、每步状态与谓词、pan 报告、首个失败步骤。53/53 MATCH，`mismatches: []`。
- 首次运行曾 FAIL（已修复，属实记录）：第一版 `s0:geometry` 的禁令扫描命中了 `geometry.ts` 头注释中写出的 `Math.random` 字样（注释文字，非代码）；改写注释后通过，实现代码未动。另，`s0:oracle` 第一版把 5 个预期 UNKNOWN/INVALID 的边界用例计入误报而 FAIL；修复为仅对 48 主场景计误报后通过，Oracle 与实现均未动。

## 8. 额外验证（非验收清单，仅作诚实核查）

- **T002 无回归：** `npm run s0:state-machine` 退出码 0（8 个 PoC、9 个 case、68 项检查全部通过）；`npm run build` 退出码 0。
- **T002 与规格未修改：** `sha256sum -c handoff/T002/sha256.txt` 除 `package.json`（新增 4 个脚本，T003 有意）与 `oracle/python/geometry_oracle.py`（T001 空桩被 T003 实现，有意）外全部 OK，包括规格书、实施计划、`viewport-state.ts`、8 个 PoC fixture。
- **禁令 grep：** `src/domain/` 与 Oracle 中 wall-clock / timer / 随机 / 浮点比较 token 均为 0 命中（`grep` exit 1）。
- **逐 step 独立重算：** `s0:geometry` 在脚本内用 BigInt 独立重算每步的 visibleRatio、anchorDrift magnitude、bottomGap 与可见+裁剪+遮挡不变量（134 步），全部一致。
- **固定 seed：** 全部 fixture 的 `seed` 字段均为 `P021-VIEWPORTSHIFT-S0-2026-11-10`，分析器校验不一致即报错。

## 9. 已知事项 / 交给下游的说明（非未解决项）

1. **未知模式校验在 T003 分析层，不在 T002 状态机层。** T002 的 `transition` 不白名单校验 mode 名，未知模式会落入 `overlays-content` 分支；T003 的 `analyzeScenario` 在重放前先校验并返回 UNKNOWN（`unsupported_mode`），两侧 Oracle 一致。正式的模式校验属于 T005（三种模式正式求值器），届时应在状态机层补上。
2. **场景状态取终态。** 见 §2：open-close 类恢复场景终态 PASS；T008 BFS 的最短见证搜索将采用 any-step 语义。
3. **T002 行为原样保留：** `resizes-visual` 下 OPEN→PAN→CLOSE 后视觉偏移不复位（CLOSE 只恢复高度），本任务的 48 场景不含该序列，未触及；Python Oracle 按同一行为实现，parity 不受影响。
4. **48 场景视口固定 390×844。** 多尺寸覆盖属于 T011（Golden/变异/属性测试），不在 S0 范围内。

## 10. 未解决项

无（见 `handoff/T003/unresolved_items.md`：NONE）。§9 的 4 条是已记录的、交给下游的设计说明，不是未解决项。

## 11. 下一步

T003 完成，S0 GATE = PASS。按实施计划 §0，T004–T014 的启动门禁已打开；是否启动、何时启动由协调员决定。
