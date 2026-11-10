# P021 ViewportShift — T003 任务交接报告

- **任务：** T003 几何 Oracle PoC 与 S0 Gate（S0，实施计划 §5，5h）
- **结论：** T003 通过，**S0 GATE = PASS**。48/48 主场景 Oracle parity、12/12 植入错误检出、正常场景误报 0、5/5 边界 fail-closed、100 次运行 1 个 SHA-256。
- **输入：** T001 骨架、T002 状态机 PoC、固定 seed `P021-VIEWPORTSHIFT-S0-2026-11-10`、4 布局 × 3 键盘行为 × 4 事件序列。
- **不做：** 不碰 T004–T014；不改规格书与实施计划；不改 T002 状态机与 8 个 PoC fixture；不删场景、不放宽几何阈值、不忽略字段、不由 TS 生成 Oracle 期望值。

## 1. 做了什么

1. 通读项目书 §4.4–§4.6 与实施计划 §0–§6 的 T003 任务卡，复核 `evidence/s0/T002_REPORT.md` §2.2 的 7 条已冻结建模选择（SCROLL 只改 scroll 字段；`pendingPan` 语义；键盘关闭时零高矩形位于布局底边；重复 OPEN 按差量调整；键盘高度越界 / 时钟倒退 / 未知事件为 UNKNOWN；PAN 夹紧与 `requested/applied` 报告格式；关闭幂等）。Oracle 按同一语义实现，无分歧、无静默改预期。
2. 新建 `src/domain/geometry.ts`：TS 矩形几何与场景分析。定点整数（1/1000 CSS px）；`visibleRatio` 为整数毫比（BigInt 精确除法）；`anchorDrift.magnitude` 为精确整数平方根（BigInt 牛顿迭代）；`keyboardObscuredArea = |S ∩ V ∩ K|`（单一均匀定义编码模式语义，见 `evidence/s0/T003_REPORT.md` §2）；`viewportClippedArea = |S| − |S ∩ V|`；`visibleArea = |S ∩ V| − obscured`（不变量逐 step 断言）；`bottomGap` 有符号；零面积 INVALID；未知模式在分析层 fail-closed 为 UNKNOWN（`unsupported_mode`）；场景状态由终态谓词决定，每步谓词全部记录。
3. 替换 `oracle/python/geometry_oracle.py` 的 T001 空桩为完整独立 Python Oracle：状态转移 + 重放、矩形交集/裁剪、键盘遮挡、可见性、谓词、场景分析、CLI（`--files … --out … [--repeat N]`）。仅 import stdlib；不导入、不调用 TS 代码，不共享生产算法模块；只共享只读 fixture 与字段名。
4. 生成 48 个场景 fixtures（`tests/fixtures/s0/s0-geometry-01.json` … `s0-geometry-48.json`，生成器见 `/tmp/gen-s0-fixtures-t003.py`，确定性、无随机、无时间戳）与 5 个边界 fixtures（`s0-edge-*.json`）；未覆盖 T002 已有的 8 个 `state-machine-poc-*.json`（哈希验证未变）。
5. 新建 `scripts/s0-lib.mjs`（共享库）与 `scripts/s0-geometry.mjs` / `s0-oracle.mjs` / `s0-determinism.mjs` / `s0-gate.mjs`；`package.json` 新增 `s0:geometry`、`s0:oracle`、`s0:determinism`、`s0:gate` 四个脚本。四个脚本均为真实运行 + 逐字段断言，退出码 0 才算通过，无空脚本、无固定 `exit 0`。
6. 运行全部验收命令并生成 `evidence/s0/S0_GATE.json`（`status: PASS`）及配套证据；回归验证 T002 状态机与构建；写本交接包。

## 2. 冻结的几何语义（摘要）

详见 `evidence/s0/T003_REPORT.md` §2。关键点：定点整数；三重交集定义键盘遮挡；终态谓词决定场景状态；统一谓词 `visibleRatio < 1000`、`keyboardObscuredArea > 0`、`bottomGap < 0`、`anchorDriftMagnitude > 50000`；视口固定 390×844 CSS px、键盘高 300 CSS px。

## 3. 四个验收命令逐条输出原文与退出码

完整日志另见 `handoff/T003/test_logs/02-s0-geometry.log`、`03-s0-oracle.log`、`04-s0-determinism.log`、`05-s0-gate.log`（另有 `01-typecheck.log`）。下面是四条验收命令的逐字输出原文（`npm run` 头两行与 `EXIT_CODE` 行一并保留）。

<!-- APPENDIX-A-LOGS -->

### `npm run s0:geometry` — 退出码 0

```text

> viewportshift@0.1.0 s0:geometry
> node scripts/s0-geometry.mjs

S0-chat-rv-open: status=FAIL expected=FAIL planted=viewport-clipped failedPredicates=["visibleRatio","bottomGap","anchorDriftMagnitude"] visibleRatio=0 obscured=0 clipped=21840000000 bottomGap=-300000 drift=300000
S0-chat-rv-open-close: status=PASS expected=PASS planted=- failedPredicates=[] visibleRatio=1000 obscured=0 clipped=0 bottomGap=0 drift=0
S0-chat-rv-open-scroll-close: status=PASS expected=PASS planted=- failedPredicates=[] visibleRatio=1000 obscured=0 clipped=0 bottomGap=0 drift=0
S0-chat-rv-open-pan: status=FAIL expected=FAIL planted=viewport-clipped failedPredicates=["visibleRatio","bottomGap","anchorDriftMagnitude"] visibleRatio=0 obscured=0 clipped=21840000000 bottomGap=-290000 drift=290000
S0-chat-rc-open: status=PASS expected=PASS planted=- failedPredicates=[] visibleRatio=1000 obscured=0 clipped=0 bottomGap=0 drift=0
S0-chat-rc-open-close: status=PASS expected=PASS planted=- failedPredicates=[] visibleRatio=1000 obscured=0 clipped=0 bottomGap=0 drift=0
S0-chat-rc-open-scroll-close: status=PASS expected=PASS planted=- failedPredicates=[] visibleRatio=1000 obscured=0 clipped=0 bottomGap=0 drift=0
S0-chat-rc-open-pan: status=PASS expected=PASS planted=- failedPredicates=[] visibleRatio=1000 obscured=0 clipped=0 bottomGap=0 drift=0
S0-chat-oc-open: status=FAIL expected=FAIL planted=keyboard-obscured failedPredicates=["visibleRatio","keyboardObscuredArea"] visibleRatio=0 obscured=21840000000 clipped=0 bottomGap=0 drift=0
S0-chat-oc-open-close: status=PASS expected=PASS planted=- failedPredicates=[] visibleRatio=1000 obscured=0 clipped=0 bottomGap=0 drift=0
S0-chat-oc-open-scroll-close: status=PASS expected=PASS planted=- failedPredicates=[] visibleRatio=1000 obscured=0 clipped=0 bottomGap=0 drift=0
S0-chat-oc-open-pan: status=FAIL expected=FAIL planted=keyboard-obscured failedPredicates=["visibleRatio","keyboardObscuredArea"] visibleRatio=0 obscured=21840000000 clipped=0 bottomGap=0 drift=0
S0-sheet-rv-open: status=FAIL expected=FAIL planted=viewport-clipped failedPredicates=["visibleRatio","bottomGap","anchorDriftMagnitude"] visibleRatio=0 obscured=0 clipped=117000000000 bottomGap=-300000 drift=300000
S0-sheet-rv-open-close: status=PASS expected=PASS planted=- failedPredicates=[] visibleRatio=1000 obscured=0 clipped=0 bottomGap=0 drift=0
S0-sheet-rv-open-scroll-close: status=PASS expected=PASS planted=- failedPredicates=[] visibleRatio=1000 obscured=0 clipped=0 bottomGap=0 drift=0
S0-sheet-rv-open-pan: status=FAIL expected=FAIL planted=viewport-clipped failedPredicates=["visibleRatio","keyboardObscuredArea","bottomGap","anchorDriftMagnitude"] visibleRatio=0 obscured=3900000000 clipped=113100000000 bottomGap=-290000 drift=290000
S0-sheet-rc-open: status=PASS expected=PASS planted=- failedPredicates=[] visibleRatio=1000 obscured=0 clipped=0 bottomGap=0 drift=0
S0-sheet-rc-open-close: status=PASS expected=PASS planted=- failedPredicates=[] visibleRatio=1000 obscured=0 clipped=0 bottomGap=0 drift=0
S0-sheet-rc-open-scroll-close: status=PASS expected=PASS planted=- failedPredicates=[] visibleRatio=1000 obscured=0 clipped=0 bottomGap=0 drift=0
S0-sheet-rc-open-pan: status=PASS expected=PASS planted=- failedPredicates=[] visibleRatio=1000 obscured=0 clipped=0 bottomGap=0 drift=0
S0-sheet-oc-open: status=FAIL expected=FAIL planted=keyboard-obscured failedPredicates=["visibleRatio","keyboardObscuredArea"] visibleRatio=0 obscured=117000000000 clipped=0 bottomGap=0 drift=0
S0-sheet-oc-open-close: status=PASS expected=PASS planted=- failedPredicates=[] visibleRatio=1000 obscured=0 clipped=0 bottomGap=0 drift=0
S0-sheet-oc-open-scroll-close: status=PASS expected=PASS planted=- failedPredicates=[] visibleRatio=1000 obscured=0 clipped=0 bottomGap=0 drift=0
S0-sheet-oc-open-pan: status=FAIL expected=FAIL planted=keyboard-obscured failedPredicates=["visibleRatio","keyboardObscuredArea"] visibleRatio=0 obscured=117000000000 clipped=0 bottomGap=0 drift=0
S0-cta-rv-open: status=FAIL expected=FAIL planted=viewport-clipped failedPredicates=["visibleRatio","bottomGap","anchorDriftMagnitude"] visibleRatio=0 obscured=0 clipped=17184000000 bottomGap=-284000 drift=300000
S0-cta-rv-open-close: status=PASS expected=PASS planted=- failedPredicates=[] visibleRatio=1000 obscured=0 clipped=0 bottomGap=16000 drift=0
S0-cta-rv-open-scroll-close: status=PASS expected=PASS planted=- failedPredicates=[] visibleRatio=1000 obscured=0 clipped=0 bottomGap=16000 drift=0
S0-cta-rv-open-pan: status=FAIL expected=FAIL planted=viewport-clipped failedPredicates=["visibleRatio","bottomGap","anchorDriftMagnitude"] visibleRatio=0 obscured=0 clipped=17184000000 bottomGap=-274000 drift=290000
S0-cta-rc-open: status=PASS expected=PASS planted=- failedPredicates=[] visibleRatio=1000 obscured=0 clipped=0 bottomGap=16000 drift=0
S0-cta-rc-open-close: status=PASS expected=PASS planted=- failedPredicates=[] visibleRatio=1000 obscured=0 clipped=0 bottomGap=16000 drift=0
S0-cta-rc-open-scroll-close: status=PASS expected=PASS planted=- failedPredicates=[] visibleRatio=1000 obscured=0 clipped=0 bottomGap=16000 drift=0
S0-cta-rc-open-pan: status=PASS expected=PASS planted=- failedPredicates=[] visibleRatio=1000 obscured=0 clipped=0 bottomGap=16000 drift=0
S0-cta-oc-open: status=FAIL expected=FAIL planted=keyboard-obscured failedPredicates=["visibleRatio","keyboardObscuredArea"] visibleRatio=0 obscured=17184000000 clipped=0 bottomGap=16000 drift=0
S0-cta-oc-open-close: status=PASS expected=PASS planted=- failedPredicates=[] visibleRatio=1000 obscured=0 clipped=0 bottomGap=16000 drift=0
S0-cta-oc-open-scroll-close: status=PASS expected=PASS planted=- failedPredicates=[] visibleRatio=1000 obscured=0 clipped=0 bottomGap=16000 drift=0
S0-cta-oc-open-pan: status=FAIL expected=FAIL planted=keyboard-obscured failedPredicates=["visibleRatio","keyboardObscuredArea"] visibleRatio=0 obscured=17184000000 clipped=0 bottomGap=16000 drift=0
S0-search-rv-open: status=PASS expected=PASS planted=- failedPredicates=[] visibleRatio=1000 obscured=0 clipped=0 bottomGap=484000 drift=0
S0-search-rv-open-close: status=PASS expected=PASS planted=- failedPredicates=[] visibleRatio=1000 obscured=0 clipped=0 bottomGap=784000 drift=0
S0-search-rv-open-scroll-close: status=PASS expected=PASS planted=- failedPredicates=[] visibleRatio=1000 obscured=0 clipped=0 bottomGap=784000 drift=0
S0-search-rv-open-pan: status=PASS expected=PASS planted=- failedPredicates=[] visibleRatio=1000 obscured=0 clipped=0 bottomGap=494000 drift=10000
S0-search-rc-open: status=PASS expected=PASS planted=- failedPredicates=[] visibleRatio=1000 obscured=0 clipped=0 bottomGap=484000 drift=0
S0-search-rc-open-close: status=PASS expected=PASS planted=- failedPredicates=[] visibleRatio=1000 obscured=0 clipped=0 bottomGap=784000 drift=0
S0-search-rc-open-scroll-close: status=PASS expected=PASS planted=- failedPredicates=[] visibleRatio=1000 obscured=0 clipped=0 bottomGap=784000 drift=0
S0-search-rc-open-pan: status=PASS expected=PASS planted=- failedPredicates=[] visibleRatio=1000 obscured=0 clipped=0 bottomGap=484000 drift=0
S0-search-oc-open: status=PASS expected=PASS planted=- failedPredicates=[] visibleRatio=1000 obscured=0 clipped=0 bottomGap=784000 drift=0
S0-search-oc-open-close: status=PASS expected=PASS planted=- failedPredicates=[] visibleRatio=1000 obscured=0 clipped=0 bottomGap=784000 drift=0
S0-search-oc-open-scroll-close: status=PASS expected=PASS planted=- failedPredicates=[] visibleRatio=1000 obscured=0 clipped=0 bottomGap=784000 drift=0
S0-search-oc-open-pan: status=PASS expected=PASS planted=- failedPredicates=[] visibleRatio=1000 obscured=0 clipped=0 bottomGap=784000 drift=0
S0-edge-clock-regression: status=UNKNOWN expected=UNKNOWN reason=event_clock_regression failedEventId=e2
S0-edge-keyboard-too-tall: status=UNKNOWN expected=UNKNOWN reason=keyboard_height_out_of_range failedEventId=e1
S0-edge-scale-2: status=UNKNOWN expected=UNKNOWN reason=unsupported_scale failedEventId=e1
S0-edge-unknown-mode: status=UNKNOWN expected=UNKNOWN reason=unsupported_mode failedEventId=e1
S0-edge-zero-area: status=INVALID expected=INVALID reason=zero_area_surface failedEventId=null

scenarios: 48, edge cases: 5, steps checked: 134, planted: 12/12, false positives: 0
analysisSha256: a7584d47023c38c19cb7fc9cb71c671744d4917f9a67e1ee9f3c8021375165df
wrote evidence/s0/S0_GEOMETRY_TS.json

checks passed: 627, checks failed: 0

S0 geometry (TS): PASS
EXIT_CODE=0
```

### `npm run s0:oracle` — 退出码 0

```text

> viewportshift@0.1.0 s0:oracle
> node scripts/s0-oracle.mjs

oracle: scenarios=53 statuses={'FAIL': 12, 'PASS': 36, 'UNKNOWN': 4, 'INVALID': 1} analysisSha256=a7584d47023c38c19cb7fc9cb71c671744d4917f9a67e1ee9f3c8021375165df runs=1 uniqueHashes=1
S0-chat-rv-open: status=FAIL expected=FAIL visibleRatio=0 obscured=0 clipped=21840000000 bottomGap=-300000 drift=300000
S0-chat-rv-open-close: status=PASS expected=PASS visibleRatio=1000 obscured=0 clipped=0 bottomGap=0 drift=0
S0-chat-rv-open-scroll-close: status=PASS expected=PASS visibleRatio=1000 obscured=0 clipped=0 bottomGap=0 drift=0
S0-chat-rv-open-pan: status=FAIL expected=FAIL visibleRatio=0 obscured=0 clipped=21840000000 bottomGap=-290000 drift=290000
S0-chat-rc-open: status=PASS expected=PASS visibleRatio=1000 obscured=0 clipped=0 bottomGap=0 drift=0
S0-chat-rc-open-close: status=PASS expected=PASS visibleRatio=1000 obscured=0 clipped=0 bottomGap=0 drift=0
S0-chat-rc-open-scroll-close: status=PASS expected=PASS visibleRatio=1000 obscured=0 clipped=0 bottomGap=0 drift=0
S0-chat-rc-open-pan: status=PASS expected=PASS visibleRatio=1000 obscured=0 clipped=0 bottomGap=0 drift=0
S0-chat-oc-open: status=FAIL expected=FAIL visibleRatio=0 obscured=21840000000 clipped=0 bottomGap=0 drift=0
S0-chat-oc-open-close: status=PASS expected=PASS visibleRatio=1000 obscured=0 clipped=0 bottomGap=0 drift=0
S0-chat-oc-open-scroll-close: status=PASS expected=PASS visibleRatio=1000 obscured=0 clipped=0 bottomGap=0 drift=0
S0-chat-oc-open-pan: status=FAIL expected=FAIL visibleRatio=0 obscured=21840000000 clipped=0 bottomGap=0 drift=0
S0-sheet-rv-open: status=FAIL expected=FAIL visibleRatio=0 obscured=0 clipped=117000000000 bottomGap=-300000 drift=300000
S0-sheet-rv-open-close: status=PASS expected=PASS visibleRatio=1000 obscured=0 clipped=0 bottomGap=0 drift=0
S0-sheet-rv-open-scroll-close: status=PASS expected=PASS visibleRatio=1000 obscured=0 clipped=0 bottomGap=0 drift=0
S0-sheet-rv-open-pan: status=FAIL expected=FAIL visibleRatio=0 obscured=3900000000 clipped=113100000000 bottomGap=-290000 drift=290000
S0-sheet-rc-open: status=PASS expected=PASS visibleRatio=1000 obscured=0 clipped=0 bottomGap=0 drift=0
S0-sheet-rc-open-close: status=PASS expected=PASS visibleRatio=1000 obscured=0 clipped=0 bottomGap=0 drift=0
S0-sheet-rc-open-scroll-close: status=PASS expected=PASS visibleRatio=1000 obscured=0 clipped=0 bottomGap=0 drift=0
S0-sheet-rc-open-pan: status=PASS expected=PASS visibleRatio=1000 obscured=0 clipped=0 bottomGap=0 drift=0
S0-sheet-oc-open: status=FAIL expected=FAIL visibleRatio=0 obscured=117000000000 clipped=0 bottomGap=0 drift=0
S0-sheet-oc-open-close: status=PASS expected=PASS visibleRatio=1000 obscured=0 clipped=0 bottomGap=0 drift=0
S0-sheet-oc-open-scroll-close: status=PASS expected=PASS visibleRatio=1000 obscured=0 clipped=0 bottomGap=0 drift=0
S0-sheet-oc-open-pan: status=FAIL expected=FAIL visibleRatio=0 obscured=117000000000 clipped=0 bottomGap=0 drift=0
S0-cta-rv-open: status=FAIL expected=FAIL visibleRatio=0 obscured=0 clipped=17184000000 bottomGap=-284000 drift=300000
S0-cta-rv-open-close: status=PASS expected=PASS visibleRatio=1000 obscured=0 clipped=0 bottomGap=16000 drift=0
S0-cta-rv-open-scroll-close: status=PASS expected=PASS visibleRatio=1000 obscured=0 clipped=0 bottomGap=16000 drift=0
S0-cta-rv-open-pan: status=FAIL expected=FAIL visibleRatio=0 obscured=0 clipped=17184000000 bottomGap=-274000 drift=290000
S0-cta-rc-open: status=PASS expected=PASS visibleRatio=1000 obscured=0 clipped=0 bottomGap=16000 drift=0
S0-cta-rc-open-close: status=PASS expected=PASS visibleRatio=1000 obscured=0 clipped=0 bottomGap=16000 drift=0
S0-cta-rc-open-scroll-close: status=PASS expected=PASS visibleRatio=1000 obscured=0 clipped=0 bottomGap=16000 drift=0
S0-cta-rc-open-pan: status=PASS expected=PASS visibleRatio=1000 obscured=0 clipped=0 bottomGap=16000 drift=0
S0-cta-oc-open: status=FAIL expected=FAIL visibleRatio=0 obscured=17184000000 clipped=0 bottomGap=16000 drift=0
S0-cta-oc-open-close: status=PASS expected=PASS visibleRatio=1000 obscured=0 clipped=0 bottomGap=16000 drift=0
S0-cta-oc-open-scroll-close: status=PASS expected=PASS visibleRatio=1000 obscured=0 clipped=0 bottomGap=16000 drift=0
S0-cta-oc-open-pan: status=FAIL expected=FAIL visibleRatio=0 obscured=17184000000 clipped=0 bottomGap=16000 drift=0
S0-search-rv-open: status=PASS expected=PASS visibleRatio=1000 obscured=0 clipped=0 bottomGap=484000 drift=0
S0-search-rv-open-close: status=PASS expected=PASS visibleRatio=1000 obscured=0 clipped=0 bottomGap=784000 drift=0
S0-search-rv-open-scroll-close: status=PASS expected=PASS visibleRatio=1000 obscured=0 clipped=0 bottomGap=784000 drift=0
S0-search-rv-open-pan: status=PASS expected=PASS visibleRatio=1000 obscured=0 clipped=0 bottomGap=494000 drift=10000
S0-search-rc-open: status=PASS expected=PASS visibleRatio=1000 obscured=0 clipped=0 bottomGap=484000 drift=0
S0-search-rc-open-close: status=PASS expected=PASS visibleRatio=1000 obscured=0 clipped=0 bottomGap=784000 drift=0
S0-search-rc-open-scroll-close: status=PASS expected=PASS visibleRatio=1000 obscured=0 clipped=0 bottomGap=784000 drift=0
S0-search-rc-open-pan: status=PASS expected=PASS visibleRatio=1000 obscured=0 clipped=0 bottomGap=484000 drift=0
S0-search-oc-open: status=PASS expected=PASS visibleRatio=1000 obscured=0 clipped=0 bottomGap=784000 drift=0
S0-search-oc-open-close: status=PASS expected=PASS visibleRatio=1000 obscured=0 clipped=0 bottomGap=784000 drift=0
S0-search-oc-open-scroll-close: status=PASS expected=PASS visibleRatio=1000 obscured=0 clipped=0 bottomGap=784000 drift=0
S0-search-oc-open-pan: status=PASS expected=PASS visibleRatio=1000 obscured=0 clipped=0 bottomGap=784000 drift=0
S0-edge-clock-regression: status=UNKNOWN expected=UNKNOWN visibleRatio=0 obscured=0 clipped=21840000000 bottomGap=-300000 drift=300000
S0-edge-keyboard-too-tall: status=UNKNOWN expected=UNKNOWN reason=keyboard_height_out_of_range
S0-edge-scale-2: status=UNKNOWN expected=UNKNOWN reason=unsupported_scale
S0-edge-unknown-mode: status=UNKNOWN expected=UNKNOWN reason=unsupported_mode
S0-edge-zero-area: status=INVALID expected=INVALID reason=zero_area_surface

wrote evidence/s0/S0_GEOMETRY_PY.json

checks passed: 117, checks failed: 0

S0 oracle (Python): PASS
EXIT_CODE=0
```

### `npm run s0:determinism` — 退出码 0

```text

> viewportshift@0.1.0 s0:determinism
> node scripts/s0-determinism.mjs

typescript: runs=100 uniqueHashes=1 hash=2f85b424fd3eece3865fd4cc0f27ed4eb02687277db7dfe1930dfa55878769d6
oracle: scenarios=48 statuses={'FAIL': 12, 'PASS': 36} analysisSha256=2f85b424fd3eece3865fd4cc0f27ed4eb02687277db7dfe1930dfa55878769d6 runs=100 uniqueHashes=1
python: runs=100 uniqueHashes=1 hash=2f85b424fd3eece3865fd4cc0f27ed4eb02687277db7dfe1930dfa55878769d6

wrote evidence/s0/S0_DETERMINISM.json
wrote evidence/s0/S0_DETERMINISM_PY.json

checks passed: 6, checks failed: 0

S0 determinism: PASS
EXIT_CODE=0
```

### `npm run s0:gate` — 退出码 0

```text

> viewportshift@0.1.0 s0:gate
> node scripts/s0-gate.mjs

oracle: scenarios=53 statuses={'FAIL': 12, 'PASS': 36, 'UNKNOWN': 4, 'INVALID': 1} analysisSha256=a7584d47023c38c19cb7fc9cb71c671744d4917f9a67e1ee9f3c8021375165df runs=1 uniqueHashes=1
S0-chat-rv-open: parity=MATCH status=FAIL/FAIL expected=FAIL
S0-chat-rv-open-close: parity=MATCH status=PASS/PASS expected=PASS
S0-chat-rv-open-scroll-close: parity=MATCH status=PASS/PASS expected=PASS
S0-chat-rv-open-pan: parity=MATCH status=FAIL/FAIL expected=FAIL
S0-chat-rc-open: parity=MATCH status=PASS/PASS expected=PASS
S0-chat-rc-open-close: parity=MATCH status=PASS/PASS expected=PASS
S0-chat-rc-open-scroll-close: parity=MATCH status=PASS/PASS expected=PASS
S0-chat-rc-open-pan: parity=MATCH status=PASS/PASS expected=PASS
S0-chat-oc-open: parity=MATCH status=FAIL/FAIL expected=FAIL
S0-chat-oc-open-close: parity=MATCH status=PASS/PASS expected=PASS
S0-chat-oc-open-scroll-close: parity=MATCH status=PASS/PASS expected=PASS
S0-chat-oc-open-pan: parity=MATCH status=FAIL/FAIL expected=FAIL
S0-sheet-rv-open: parity=MATCH status=FAIL/FAIL expected=FAIL
S0-sheet-rv-open-close: parity=MATCH status=PASS/PASS expected=PASS
S0-sheet-rv-open-scroll-close: parity=MATCH status=PASS/PASS expected=PASS
S0-sheet-rv-open-pan: parity=MATCH status=FAIL/FAIL expected=FAIL
S0-sheet-rc-open: parity=MATCH status=PASS/PASS expected=PASS
S0-sheet-rc-open-close: parity=MATCH status=PASS/PASS expected=PASS
S0-sheet-rc-open-scroll-close: parity=MATCH status=PASS/PASS expected=PASS
S0-sheet-rc-open-pan: parity=MATCH status=PASS/PASS expected=PASS
S0-sheet-oc-open: parity=MATCH status=FAIL/FAIL expected=FAIL
S0-sheet-oc-open-close: parity=MATCH status=PASS/PASS expected=PASS
S0-sheet-oc-open-scroll-close: parity=MATCH status=PASS/PASS expected=PASS
S0-sheet-oc-open-pan: parity=MATCH status=FAIL/FAIL expected=FAIL
S0-cta-rv-open: parity=MATCH status=FAIL/FAIL expected=FAIL
S0-cta-rv-open-close: parity=MATCH status=PASS/PASS expected=PASS
S0-cta-rv-open-scroll-close: parity=MATCH status=PASS/PASS expected=PASS
S0-cta-rv-open-pan: parity=MATCH status=FAIL/FAIL expected=FAIL
S0-cta-rc-open: parity=MATCH status=PASS/PASS expected=PASS
S0-cta-rc-open-close: parity=MATCH status=PASS/PASS expected=PASS
S0-cta-rc-open-scroll-close: parity=MATCH status=PASS/PASS expected=PASS
S0-cta-rc-open-pan: parity=MATCH status=PASS/PASS expected=PASS
S0-cta-oc-open: parity=MATCH status=FAIL/FAIL expected=FAIL
S0-cta-oc-open-close: parity=MATCH status=PASS/PASS expected=PASS
S0-cta-oc-open-scroll-close: parity=MATCH status=PASS/PASS expected=PASS
S0-cta-oc-open-pan: parity=MATCH status=FAIL/FAIL expected=FAIL
S0-search-rv-open: parity=MATCH status=PASS/PASS expected=PASS
S0-search-rv-open-close: parity=MATCH status=PASS/PASS expected=PASS
S0-search-rv-open-scroll-close: parity=MATCH status=PASS/PASS expected=PASS
S0-search-rv-open-pan: parity=MATCH status=PASS/PASS expected=PASS
S0-search-rc-open: parity=MATCH status=PASS/PASS expected=PASS
S0-search-rc-open-close: parity=MATCH status=PASS/PASS expected=PASS
S0-search-rc-open-scroll-close: parity=MATCH status=PASS/PASS expected=PASS
S0-search-rc-open-pan: parity=MATCH status=PASS/PASS expected=PASS
S0-search-oc-open: parity=MATCH status=PASS/PASS expected=PASS
S0-search-oc-open-close: parity=MATCH status=PASS/PASS expected=PASS
S0-search-oc-open-scroll-close: parity=MATCH status=PASS/PASS expected=PASS
S0-search-oc-open-pan: parity=MATCH status=PASS/PASS expected=PASS
S0-edge-clock-regression: parity=MATCH status=UNKNOWN/UNKNOWN expected=UNKNOWN
S0-edge-keyboard-too-tall: parity=MATCH status=UNKNOWN/UNKNOWN expected=UNKNOWN
S0-edge-scale-2: parity=MATCH status=UNKNOWN/UNKNOWN expected=UNKNOWN
S0-edge-unknown-mode: parity=MATCH status=UNKNOWN/UNKNOWN expected=UNKNOWN
S0-edge-zero-area: parity=MATCH status=INVALID/INVALID expected=INVALID
oracle: scenarios=48 statuses={'FAIL': 12, 'PASS': 36} analysisSha256=2f85b424fd3eece3865fd4cc0f27ed4eb02687277db7dfe1930dfa55878769d6 runs=100 uniqueHashes=1

S0 gate: scenarios=48 parity=53/53 planted=12/12 falsePositives=0 edge=5/5 determinism=100 runs, tsUnique=1, pyUnique=1
analysisSha256: a7584d47023c38c19cb7fc9cb71c671744d4917f9a67e1ee9f3c8021375165df
gateSha256: 65b4b32f4a5298642fd3de5a64441ed7d214e2519d118b8b67a7871ba73aca26
wrote evidence/s0/S0_GATE.json

checks passed: 120, checks failed: 0

S0 gate: PASS (53/53 parity: 48 main + 5 edge, 12/12 planted, 0 false positives, 100 runs / 1 hash)
EXIT_CODE=0
```

## 4. 48 场景清单

| scenario_id | 布局 | 模式 | 预期状态 | 植入错误 |
| --- | --- | --- | --- | --- |
| `S0-chat-rv-open` | chat-input | resizes-visual | FAIL | viewport-clipped |
| `S0-chat-rv-open-close` | chat-input | resizes-visual | PASS | - |
| `S0-chat-rv-open-scroll-close` | chat-input | resizes-visual | PASS | - |
| `S0-chat-rv-open-pan` | chat-input | resizes-visual | FAIL | viewport-clipped |
| `S0-chat-rc-open` | chat-input | resizes-content | PASS | - |
| `S0-chat-rc-open-close` | chat-input | resizes-content | PASS | - |
| `S0-chat-rc-open-scroll-close` | chat-input | resizes-content | PASS | - |
| `S0-chat-rc-open-pan` | chat-input | resizes-content | PASS | - |
| `S0-chat-oc-open` | chat-input | overlays-content | FAIL | keyboard-obscured |
| `S0-chat-oc-open-close` | chat-input | overlays-content | PASS | - |
| `S0-chat-oc-open-scroll-close` | chat-input | overlays-content | PASS | - |
| `S0-chat-oc-open-pan` | chat-input | overlays-content | FAIL | keyboard-obscured |
| `S0-sheet-rv-open` | bottom-sheet | resizes-visual | FAIL | viewport-clipped |
| `S0-sheet-rv-open-close` | bottom-sheet | resizes-visual | PASS | - |
| `S0-sheet-rv-open-scroll-close` | bottom-sheet | resizes-visual | PASS | - |
| `S0-sheet-rv-open-pan` | bottom-sheet | resizes-visual | FAIL | viewport-clipped |
| `S0-sheet-rc-open` | bottom-sheet | resizes-content | PASS | - |
| `S0-sheet-rc-open-close` | bottom-sheet | resizes-content | PASS | - |
| `S0-sheet-rc-open-scroll-close` | bottom-sheet | resizes-content | PASS | - |
| `S0-sheet-rc-open-pan` | bottom-sheet | resizes-content | PASS | - |
| `S0-sheet-oc-open` | bottom-sheet | overlays-content | FAIL | keyboard-obscured |
| `S0-sheet-oc-open-close` | bottom-sheet | overlays-content | PASS | - |
| `S0-sheet-oc-open-scroll-close` | bottom-sheet | overlays-content | PASS | - |
| `S0-sheet-oc-open-pan` | bottom-sheet | overlays-content | FAIL | keyboard-obscured |
| `S0-cta-rv-open` | fixed-cta | resizes-visual | FAIL | viewport-clipped |
| `S0-cta-rv-open-close` | fixed-cta | resizes-visual | PASS | - |
| `S0-cta-rv-open-scroll-close` | fixed-cta | resizes-visual | PASS | - |
| `S0-cta-rv-open-pan` | fixed-cta | resizes-visual | FAIL | viewport-clipped |
| `S0-cta-rc-open` | fixed-cta | resizes-content | PASS | - |
| `S0-cta-rc-open-close` | fixed-cta | resizes-content | PASS | - |
| `S0-cta-rc-open-scroll-close` | fixed-cta | resizes-content | PASS | - |
| `S0-cta-rc-open-pan` | fixed-cta | resizes-content | PASS | - |
| `S0-cta-oc-open` | fixed-cta | overlays-content | FAIL | keyboard-obscured |
| `S0-cta-oc-open-close` | fixed-cta | overlays-content | PASS | - |
| `S0-cta-oc-open-scroll-close` | fixed-cta | overlays-content | PASS | - |
| `S0-cta-oc-open-pan` | fixed-cta | overlays-content | FAIL | keyboard-obscured |
| `S0-search-rv-open` | search-bar | resizes-visual | PASS | - |
| `S0-search-rv-open-close` | search-bar | resizes-visual | PASS | - |
| `S0-search-rv-open-scroll-close` | search-bar | resizes-visual | PASS | - |
| `S0-search-rv-open-pan` | search-bar | resizes-visual | PASS | - |
| `S0-search-rc-open` | search-bar | resizes-content | PASS | - |
| `S0-search-rc-open-close` | search-bar | resizes-content | PASS | - |
| `S0-search-rc-open-scroll-close` | search-bar | resizes-content | PASS | - |
| `S0-search-rc-open-pan` | search-bar | resizes-content | PASS | - |
| `S0-search-oc-open` | search-bar | overlays-content | PASS | - |
| `S0-search-oc-open-close` | search-bar | overlays-content | PASS | - |
| `S0-search-oc-open-scroll-close` | search-bar | overlays-content | PASS | - |
| `S0-search-oc-open-pan` | search-bar | overlays-content | PASS | - |

共 48 个场景：预期 FAIL 12 个（全部为植入错误场景），预期 PASS 36 个。实际结果与预期逐一一致（见 §3 日志与 `S0_GATE.json`）。

## 5. 12 个植入错误检出明细（终态指标，单位 milli-px / (milli-px)²）

| 场景 | 种类 | 首个失败步骤 | 触发谓词 | visibleRatio | obscured | clipped | bottomGap | drift |
| --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| `S0-chat-rv-open` | viewport-clipped | 0 | visibleRatio, bottomGap, anchorDriftMagnitude | 0 | 0 | 21840000000 | -300000 | 300000 |
| `S0-chat-rv-open-pan` | viewport-clipped | 0 | visibleRatio, bottomGap, anchorDriftMagnitude | 0 | 0 | 21840000000 | -290000 | 290000 |
| `S0-chat-oc-open` | keyboard-obscured | 0 | visibleRatio, keyboardObscuredArea | 0 | 21840000000 | 0 | 0 | 0 |
| `S0-chat-oc-open-pan` | keyboard-obscured | 0 | visibleRatio, keyboardObscuredArea | 0 | 21840000000 | 0 | 0 | 0 |
| `S0-sheet-rv-open` | viewport-clipped | 0 | visibleRatio, bottomGap, anchorDriftMagnitude | 0 | 0 | 117000000000 | -300000 | 300000 |
| `S0-sheet-rv-open-pan` | viewport-clipped | 0 | visibleRatio, keyboardObscuredArea, bottomGap, anchorDriftMagnitude | 0 | 3900000000 | 113100000000 | -290000 | 290000 |
| `S0-sheet-oc-open` | keyboard-obscured | 0 | visibleRatio, keyboardObscuredArea | 0 | 117000000000 | 0 | 0 | 0 |
| `S0-sheet-oc-open-pan` | keyboard-obscured | 0 | visibleRatio, keyboardObscuredArea | 0 | 117000000000 | 0 | 0 | 0 |
| `S0-cta-rv-open` | viewport-clipped | 0 | visibleRatio, bottomGap, anchorDriftMagnitude | 0 | 0 | 17184000000 | -284000 | 300000 |
| `S0-cta-rv-open-pan` | viewport-clipped | 0 | visibleRatio, bottomGap, anchorDriftMagnitude | 0 | 0 | 17184000000 | -274000 | 290000 |
| `S0-cta-oc-open` | keyboard-obscured | 0 | visibleRatio, keyboardObscuredArea | 0 | 17184000000 | 0 | 16000 | 0 |
| `S0-cta-oc-open-pan` | keyboard-obscured | 0 | visibleRatio, keyboardObscuredArea | 0 | 17184000000 | 0 | 16000 | 0 |

全部 12 个均为 step 0（键盘打开）即失败，TS 与 Python 两侧均检出（`detected: true`，见 `S0_GATE.json` 各行）。36 个正常场景全部 PASS、误报 0；其中 12 个 open-close / open-scroll-close 场景在 step 0 曾瞬时失败、关闭后恢复，终态 PASS（`firstFailedStepIndex=0`，终态谓词为空）。

## 6. 100 次哈希结果

- 100 次运行（48 主场景）：TS 侧 100 次 1 个哈希、Python 侧 100 次 1 个哈希，两侧一致。
- 100 次确定性哈希：`2f85b424fd3eece3865fd4cc0f27ed4eb02687277db7dfe1930dfa55878769d6`
- 53 场景分析哈希（48 主场景 + 5 边界，TS 与 Python 各自独立算出，完全一致）：`a7584d47023c38c19cb7fc9cb71c671744d4917f9a67e1ee9f3c8021375165df`
- 门禁哈希：`gateSha256: 65b4b32f4a5298642fd3de5a64441ed7d214e2519d118b8b67a7871ba73aca26`（已用独立 Python 脚本重算验证一致）。
- 证据 JSON 中无机器绝对路径（grep 0 命中）。

## 7. S0_GATE.json 全文

```json
{
  "analysisSha256": "a7584d47023c38c19cb7fc9cb71c671744d4917f9a67e1ee9f3c8021375165df",
  "determinism": {
    "runs": 100,
    "tsUniqueHashes": 1,
    "pyUniqueHashes": 1,
    "analysisSha256": "2f85b424fd3eece3865fd4cc0f27ed4eb02687277db7dfe1930dfa55878769d6"
  },
  "edgeCases": [
    {
      "scenarioId": "S0-edge-clock-regression",
      "layoutTemplate": "chat-input",
      "mode": "resizes-visual",
      "expectedStatus": "UNKNOWN",
      "tsStatus": "UNKNOWN",
      "pyStatus": "UNKNOWN",
      "parity": true,
      "plantedErrorKind": null,
      "detected": false,
      "firstFailedStepIndex": 0,
      "failedPredicates": [],
      "finalMetrics": {
        "surfaceArea": 21840000000,
        "keyboardObscuredArea": 0,
        "viewportClippedArea": 21840000000,
        "visibleArea": 0,
        "visibleRatio": 0,
        "bottomGap": -300000,
        "anchorDrift": {
          "dx": 0,
          "dy": 300000,
          "magnitude": 300000
        }
      }
    },
    {
      "scenarioId": "S0-edge-keyboard-too-tall",
      "layoutTemplate": "chat-input",
      "mode": "resizes-visual",
      "expectedStatus": "UNKNOWN",
      "tsStatus": "UNKNOWN",
      "pyStatus": "UNKNOWN",
      "parity": true,
      "plantedErrorKind": null,
      "detected": false,
      "firstFailedStepIndex": null,
      "failedPredicates": [],
      "finalMetrics": null
    },
    {
      "scenarioId": "S0-edge-scale-2",
      "layoutTemplate": "chat-input",
      "mode": "resizes-visual",
      "expectedStatus": "UNKNOWN",
      "tsStatus": "UNKNOWN",
      "pyStatus": "UNKNOWN",
      "parity": true,
      "plantedErrorKind": null,
      "detected": false,
      "firstFailedStepIndex": null,
      "failedPredicates": [],
      "finalMetrics": null
    },
    {
      "scenarioId": "S0-edge-unknown-mode",
      "layoutTemplate": "chat-input",
      "mode": "resizes-unknown",
      "expectedStatus": "UNKNOWN",
      "tsStatus": "UNKNOWN",
      "pyStatus": "UNKNOWN",
      "parity": true,
      "plantedErrorKind": null,
      "detected": false,
      "firstFailedStepIndex": null,
      "failedPredicates": [],
      "finalMetrics": null
    },
    {
      "scenarioId": "S0-edge-zero-area",
      "layoutTemplate": "chat-input",
      "mode": "resizes-visual",
      "expectedStatus": "INVALID",
      "tsStatus": "INVALID",
      "pyStatus": "INVALID",
      "parity": true,
      "plantedErrorKind": null,
      "detected": false,
      "firstFailedStepIndex": null,
      "failedPredicates": [],
      "finalMetrics": null
    }
  ],
  "edgeCasesPassed": 5,
  "edgeCasesTotal": 5,
  "falsePositives": 0,
  "gate": "S0",
  "mismatches": [],
  "parityFailed": 0,
  "parityPassed": 53,
  "plantedErrorsDetected": 12,
  "plantedErrorsTotal": 12,
  "project": "P021",
  "scenarios": [
    {
      "scenarioId": "S0-chat-rv-open",
      "layoutTemplate": "chat-input",
      "mode": "resizes-visual",
      "expectedStatus": "FAIL",
      "tsStatus": "FAIL",
      "pyStatus": "FAIL",
      "parity": true,
      "plantedErrorKind": "viewport-clipped",
      "detected": true,
      "firstFailedStepIndex": 0,
      "failedPredicates": [
        "visibleRatio",
        "bottomGap",
        "anchorDriftMagnitude"
      ],
      "finalMetrics": {
        "surfaceArea": 21840000000,
        "keyboardObscuredArea": 0,
        "viewportClippedArea": 21840000000,
        "visibleArea": 0,
        "visibleRatio": 0,
        "bottomGap": -300000,
        "anchorDrift": {
          "dx": 0,
          "dy": 300000,
          "magnitude": 300000
        }
      }
    },
    {
      "scenarioId": "S0-chat-rv-open-close",
      "layoutTemplate": "chat-input",
      "mode": "resizes-visual",
      "expectedStatus": "PASS",
      "tsStatus": "PASS",
      "pyStatus": "PASS",
      "parity": true,
      "plantedErrorKind": null,
      "detected": false,
      "firstFailedStepIndex": 0,
      "failedPredicates": [],
      "finalMetrics": {
        "surfaceArea": 21840000000,
        "keyboardObscuredArea": 0,
        "viewportClippedArea": 0,
        "visibleArea": 21840000000,
        "visibleRatio": 1000,
        "bottomGap": 0,
        "anchorDrift": {
          "dx": 0,
          "dy": 0,
          "magnitude": 0
        }
      }
    },
    {
      "scenarioId": "S0-chat-rv-open-scroll-close",
      "layoutTemplate": "chat-input",
      "mode": "resizes-visual",
      "expectedStatus": "PASS",
      "tsStatus": "PASS",
      "pyStatus": "PASS",
      "parity": true,
      "plantedErrorKind": null,
      "detected": false,
      "firstFailedStepIndex": 0,
      "failedPredicates": [],
      "finalMetrics": {
        "surfaceArea": 21840000000,
        "keyboardObscuredArea": 0,
        "viewportClippedArea": 0,
        "visibleArea": 21840000000,
        "visibleRatio": 1000,
        "bottomGap": 0,
        "anchorDrift": {
          "dx": 0,
          "dy": 0,
          "magnitude": 0
        }
      }
    },
    {
      "scenarioId": "S0-chat-rv-open-pan",
      "layoutTemplate": "chat-input",
      "mode": "resizes-visual",
      "expectedStatus": "FAIL",
      "tsStatus": "FAIL",
      "pyStatus": "FAIL",
      "parity": true,
      "plantedErrorKind": "viewport-clipped",
      "detected": true,
      "firstFailedStepIndex": 0,
      "failedPredicates": [
        "visibleRatio",
        "bottomGap",
        "anchorDriftMagnitude"
      ],
      "finalMetrics": {
        "surfaceArea": 21840000000,
        "keyboardObscuredArea": 0,
        "viewportClippedArea": 21840000000,
        "visibleArea": 0,
        "visibleRatio": 0,
        "bottomGap": -290000,
        "anchorDrift": {
          "dx": 0,
          "dy": 290000,
          "magnitude": 290000
        }
      }
    },
    {
      "scenarioId": "S0-chat-rc-open",
      "layoutTemplate": "chat-input",
      "mode": "resizes-content",
      "expectedStatus": "PASS",
      "tsStatus": "PASS",
      "pyStatus": "PASS",
      "parity": true,
      "plantedErrorKind": null,
      "detected": false,
      "firstFailedStepIndex": null,
      "failedPredicates": [],
      "finalMetrics": {
        "surfaceArea": 21840000000,
        "keyboardObscuredArea": 0,
        "viewportClippedArea": 0,
        "visibleArea": 21840000000,
        "visibleRatio": 1000,
        "bottomGap": 0,
        "anchorDrift": {
          "dx": 0,
          "dy": 0,
          "magnitude": 0
        }
      }
    },
    {
      "scenarioId": "S0-chat-rc-open-close",
      "layoutTemplate": "chat-input",
      "mode": "resizes-content",
      "expectedStatus": "PASS",
      "tsStatus": "PASS",
      "pyStatus": "PASS",
      "parity": true,
      "plantedErrorKind": null,
      "detected": false,
      "firstFailedStepIndex": null,
      "failedPredicates": [],
      "finalMetrics": {
        "surfaceArea": 21840000000,
        "keyboardObscuredArea": 0,
        "viewportClippedArea": 0,
        "visibleArea": 21840000000,
        "visibleRatio": 1000,
        "bottomGap": 0,
        "anchorDrift": {
          "dx": 0,
          "dy": 0,
          "magnitude": 0
        }
      }
    },
    {
      "scenarioId": "S0-chat-rc-open-scroll-close",
      "layoutTemplate": "chat-input",
      "mode": "resizes-content",
      "expectedStatus": "PASS",
      "tsStatus": "PASS",
      "pyStatus": "PASS",
      "parity": true,
      "plantedErrorKind": null,
      "detected": false,
      "firstFailedStepIndex": null,
      "failedPredicates": [],
      "finalMetrics": {
        "surfaceArea": 21840000000,
        "keyboardObscuredArea": 0,
        "viewportClippedArea": 0,
        "visibleArea": 21840000000,
        "visibleRatio": 1000,
        "bottomGap": 0,
        "anchorDrift": {
          "dx": 0,
          "dy": 0,
          "magnitude": 0
        }
      }
    },
    {
      "scenarioId": "S0-chat-rc-open-pan",
      "layoutTemplate": "chat-input",
      "mode": "resizes-content",
      "expectedStatus": "PASS",
      "tsStatus": "PASS",
      "pyStatus": "PASS",
      "parity": true,
      "plantedErrorKind": null,
      "detected": false,
      "firstFailedStepIndex": null,
      "failedPredicates": [],
      "finalMetrics": {
        "surfaceArea": 21840000000,
        "keyboardObscuredArea": 0,
        "viewportClippedArea": 0,
        "visibleArea": 21840000000,
        "visibleRatio": 1000,
        "bottomGap": 0,
        "anchorDrift": {
          "dx": 0,
          "dy": 0,
          "magnitude": 0
        }
      }
    },
    {
      "scenarioId": "S0-chat-oc-open",
      "layoutTemplate": "chat-input",
      "mode": "overlays-content",
      "expectedStatus": "FAIL",
      "tsStatus": "FAIL",
      "pyStatus": "FAIL",
      "parity": true,
      "plantedErrorKind": "keyboard-obscured",
      "detected": true,
      "firstFailedStepIndex": 0,
      "failedPredicates": [
        "visibleRatio",
        "keyboardObscuredArea"
      ],
      "finalMetrics": {
        "surfaceArea": 21840000000,
        "keyboardObscuredArea": 21840000000,
        "viewportClippedArea": 0,
        "visibleArea": 0,
        "visibleRatio": 0,
        "bottomGap": 0,
        "anchorDrift": {
          "dx": 0,
          "dy": 0,
          "magnitude": 0
        }
      }
    },
    {
      "scenarioId": "S0-chat-oc-open-close",
      "layoutTemplate": "chat-input",
      "mode": "overlays-content",
      "expectedStatus": "PASS",
      "tsStatus": "PASS",
      "pyStatus": "PASS",
      "parity": true,
      "plantedErrorKind": null,
      "detected": false,
      "firstFailedStepIndex": 0,
      "failedPredicates": [],
      "finalMetrics": {
        "surfaceArea": 21840000000,
        "keyboardObscuredArea": 0,
        "viewportClippedArea": 0,
        "visibleArea": 21840000000,
        "visibleRatio": 1000,
        "bottomGap": 0,
        "anchorDrift": {
          "dx": 0,
          "dy": 0,
          "magnitude": 0
        }
      }
    },
    {
      "scenarioId": "S0-chat-oc-open-scroll-close",
      "layoutTemplate": "chat-input",
      "mode": "overlays-content",
      "expectedStatus": "PASS",
      "tsStatus": "PASS",
      "pyStatus": "PASS",
      "parity": true,
      "plantedErrorKind": null,
      "detected": false,
      "firstFailedStepIndex": 0,
      "failedPredicates": [],
      "finalMetrics": {
        "surfaceArea": 21840000000,
        "keyboardObscuredArea": 0,
        "viewportClippedArea": 0,
        "visibleArea": 21840000000,
        "visibleRatio": 1000,
        "bottomGap": 0,
        "anchorDrift": {
          "dx": 0,
          "dy": 0,
          "magnitude": 0
        }
      }
    },
    {
      "scenarioId": "S0-chat-oc-open-pan",
      "layoutTemplate": "chat-input",
      "mode": "overlays-content",
      "expectedStatus": "FAIL",
      "tsStatus": "FAIL",
      "pyStatus": "FAIL",
      "parity": true,
      "plantedErrorKind": "keyboard-obscured",
      "detected": true,
      "firstFailedStepIndex": 0,
      "failedPredicates": [
        "visibleRatio",
        "keyboardObscuredArea"
      ],
      "finalMetrics": {
        "surfaceArea": 21840000000,
        "keyboardObscuredArea": 21840000000,
        "viewportClippedArea": 0,
        "visibleArea": 0,
        "visibleRatio": 0,
        "bottomGap": 0,
        "anchorDrift": {
          "dx": 0,
          "dy": 0,
          "magnitude": 0
        }
      }
    },
    {
      "scenarioId": "S0-sheet-rv-open",
      "layoutTemplate": "bottom-sheet",
      "mode": "resizes-visual",
      "expectedStatus": "FAIL",
      "tsStatus": "FAIL",
      "pyStatus": "FAIL",
      "parity": true,
      "plantedErrorKind": "viewport-clipped",
      "detected": true,
      "firstFailedStepIndex": 0,
      "failedPredicates": [
        "visibleRatio",
        "bottomGap",
        "anchorDriftMagnitude"
      ],
      "finalMetrics": {
        "surfaceArea": 117000000000,
        "keyboardObscuredArea": 0,
        "viewportClippedArea": 117000000000,
        "visibleArea": 0,
        "visibleRatio": 0,
        "bottomGap": -300000,
        "anchorDrift": {
          "dx": 0,
          "dy": 300000,
          "magnitude": 300000
        }
      }
    },
    {
      "scenarioId": "S0-sheet-rv-open-close",
      "layoutTemplate": "bottom-sheet",
      "mode": "resizes-visual",
      "expectedStatus": "PASS",
      "tsStatus": "PASS",
      "pyStatus": "PASS",
      "parity": true,
      "plantedErrorKind": null,
      "detected": false,
      "firstFailedStepIndex": 0,
      "failedPredicates": [],
      "finalMetrics": {
        "surfaceArea": 117000000000,
        "keyboardObscuredArea": 0,
        "viewportClippedArea": 0,
        "visibleArea": 117000000000,
        "visibleRatio": 1000,
        "bottomGap": 0,
        "anchorDrift": {
          "dx": 0,
          "dy": 0,
          "magnitude": 0
        }
      }
    },
    {
      "scenarioId": "S0-sheet-rv-open-scroll-close",
      "layoutTemplate": "bottom-sheet",
      "mode": "resizes-visual",
      "expectedStatus": "PASS",
      "tsStatus": "PASS",
      "pyStatus": "PASS",
      "parity": true,
      "plantedErrorKind": null,
      "detected": false,
      "firstFailedStepIndex": 0,
      "failedPredicates": [],
      "finalMetrics": {
        "surfaceArea": 117000000000,
        "keyboardObscuredArea": 0,
        "viewportClippedArea": 0,
        "visibleArea": 117000000000,
        "visibleRatio": 1000,
        "bottomGap": 0,
        "anchorDrift": {
          "dx": 0,
          "dy": 0,
          "magnitude": 0
        }
      }
    },
    {
      "scenarioId": "S0-sheet-rv-open-pan",
      "layoutTemplate": "bottom-sheet",
      "mode": "resizes-visual",
      "expectedStatus": "FAIL",
      "tsStatus": "FAIL",
      "pyStatus": "FAIL",
      "parity": true,
      "plantedErrorKind": "viewport-clipped",
      "detected": true,
      "firstFailedStepIndex": 0,
      "failedPredicates": [
        "visibleRatio",
        "keyboardObscuredArea",
        "bottomGap",
        "anchorDriftMagnitude"
      ],
      "finalMetrics": {
        "surfaceArea": 117000000000,
        "keyboardObscuredArea": 3900000000,
        "viewportClippedArea": 113100000000,
        "visibleArea": 0,
        "visibleRatio": 0,
        "bottomGap": -290000,
        "anchorDrift": {
          "dx": 0,
          "dy": 290000,
          "magnitude": 290000
        }
      }
    },
    {
      "scenarioId": "S0-sheet-rc-open",
      "layoutTemplate": "bottom-sheet",
      "mode": "resizes-content",
      "expectedStatus": "PASS",
      "tsStatus": "PASS",
      "pyStatus": "PASS",
      "parity": true,
      "plantedErrorKind": null,
      "detected": false,
      "firstFailedStepIndex": null,
      "failedPredicates": [],
      "finalMetrics": {
        "surfaceArea": 117000000000,
        "keyboardObscuredArea": 0,
        "viewportClippedArea": 0,
        "visibleArea": 117000000000,
        "visibleRatio": 1000,
        "bottomGap": 0,
        "anchorDrift": {
          "dx": 0,
          "dy": 0,
          "magnitude": 0
        }
      }
    },
    {
      "scenarioId": "S0-sheet-rc-open-close",
      "layoutTemplate": "bottom-sheet",
      "mode": "resizes-content",
      "expectedStatus": "PASS",
      "tsStatus": "PASS",
      "pyStatus": "PASS",
      "parity": true,
      "plantedErrorKind": null,
      "detected": false,
      "firstFailedStepIndex": null,
      "failedPredicates": [],
      "finalMetrics": {
        "surfaceArea": 117000000000,
        "keyboardObscuredArea": 0,
        "viewportClippedArea": 0,
        "visibleArea": 117000000000,
        "visibleRatio": 1000,
        "bottomGap": 0,
        "anchorDrift": {
          "dx": 0,
          "dy": 0,
          "magnitude": 0
        }
      }
    },
    {
      "scenarioId": "S0-sheet-rc-open-scroll-close",
      "layoutTemplate": "bottom-sheet",
      "mode": "resizes-content",
      "expectedStatus": "PASS",
      "tsStatus": "PASS",
      "pyStatus": "PASS",
      "parity": true,
      "plantedErrorKind": null,
      "detected": false,
      "firstFailedStepIndex": null,
      "failedPredicates": [],
      "finalMetrics": {
        "surfaceArea": 117000000000,
        "keyboardObscuredArea": 0,
        "viewportClippedArea": 0,
        "visibleArea": 117000000000,
        "visibleRatio": 1000,
        "bottomGap": 0,
        "anchorDrift": {
          "dx": 0,
          "dy": 0,
          "magnitude": 0
        }
      }
    },
    {
      "scenarioId": "S0-sheet-rc-open-pan",
      "layoutTemplate": "bottom-sheet",
      "mode": "resizes-content",
      "expectedStatus": "PASS",
      "tsStatus": "PASS",
      "pyStatus": "PASS",
      "parity": true,
      "plantedErrorKind": null,
      "detected": false,
      "firstFailedStepIndex": null,
      "failedPredicates": [],
      "finalMetrics": {
        "surfaceArea": 117000000000,
        "keyboardObscuredArea": 0,
        "viewportClippedArea": 0,
        "visibleArea": 117000000000,
        "visibleRatio": 1000,
        "bottomGap": 0,
        "anchorDrift": {
          "dx": 0,
          "dy": 0,
          "magnitude": 0
        }
      }
    },
    {
      "scenarioId": "S0-sheet-oc-open",
      "layoutTemplate": "bottom-sheet",
      "mode": "overlays-content",
      "expectedStatus": "FAIL",
      "tsStatus": "FAIL",
      "pyStatus": "FAIL",
      "parity": true,
      "plantedErrorKind": "keyboard-obscured",
      "detected": true,
      "firstFailedStepIndex": 0,
      "failedPredicates": [
        "visibleRatio",
        "keyboardObscuredArea"
      ],
      "finalMetrics": {
        "surfaceArea": 117000000000,
        "keyboardObscuredArea": 117000000000,
        "viewportClippedArea": 0,
        "visibleArea": 0,
        "visibleRatio": 0,
        "bottomGap": 0,
        "anchorDrift": {
          "dx": 0,
          "dy": 0,
          "magnitude": 0
        }
      }
    },
    {
      "scenarioId": "S0-sheet-oc-open-close",
      "layoutTemplate": "bottom-sheet",
      "mode": "overlays-content",
      "expectedStatus": "PASS",
      "tsStatus": "PASS",
      "pyStatus": "PASS",
      "parity": true,
      "plantedErrorKind": null,
      "detected": false,
      "firstFailedStepIndex": 0,
      "failedPredicates": [],
      "finalMetrics": {
        "surfaceArea": 117000000000,
        "keyboardObscuredArea": 0,
        "viewportClippedArea": 0,
        "visibleArea": 117000000000,
        "visibleRatio": 1000,
        "bottomGap": 0,
        "anchorDrift": {
          "dx": 0,
          "dy": 0,
          "magnitude": 0
        }
      }
    },
    {
      "scenarioId": "S0-sheet-oc-open-scroll-close",
      "layoutTemplate": "bottom-sheet",
      "mode": "overlays-content",
      "expectedStatus": "PASS",
      "tsStatus": "PASS",
      "pyStatus": "PASS",
      "parity": true,
      "plantedErrorKind": null,
      "detected": false,
      "firstFailedStepIndex": 0,
      "failedPredicates": [],
      "finalMetrics": {
        "surfaceArea": 117000000000,
        "keyboardObscuredArea": 0,
        "viewportClippedArea": 0,
        "visibleArea": 117000000000,
        "visibleRatio": 1000,
        "bottomGap": 0,
        "anchorDrift": {
          "dx": 0,
          "dy": 0,
          "magnitude": 0
        }
      }
    },
    {
      "scenarioId": "S0-sheet-oc-open-pan",
      "layoutTemplate": "bottom-sheet",
      "mode": "overlays-content",
      "expectedStatus": "FAIL",
      "tsStatus": "FAIL",
      "pyStatus": "FAIL",
      "parity": true,
      "plantedErrorKind": "keyboard-obscured",
      "detected": true,
      "firstFailedStepIndex": 0,
      "failedPredicates": [
        "visibleRatio",
        "keyboardObscuredArea"
      ],
      "finalMetrics": {
        "surfaceArea": 117000000000,
        "keyboardObscuredArea": 117000000000,
        "viewportClippedArea": 0,
        "visibleArea": 0,
        "visibleRatio": 0,
        "bottomGap": 0,
        "anchorDrift": {
          "dx": 0,
          "dy": 0,
          "magnitude": 0
        }
      }
    },
    {
      "scenarioId": "S0-cta-rv-open",
      "layoutTemplate": "fixed-cta",
      "mode": "resizes-visual",
      "expectedStatus": "FAIL",
      "tsStatus": "FAIL",
      "pyStatus": "FAIL",
      "parity": true,
      "plantedErrorKind": "viewport-clipped",
      "detected": true,
      "firstFailedStepIndex": 0,
      "failedPredicates": [
        "visibleRatio",
        "bottomGap",
        "anchorDriftMagnitude"
      ],
      "finalMetrics": {
        "surfaceArea": 17184000000,
        "keyboardObscuredArea": 0,
        "viewportClippedArea": 17184000000,
        "visibleArea": 0,
        "visibleRatio": 0,
        "bottomGap": -284000,
        "anchorDrift": {
          "dx": 0,
          "dy": 300000,
          "magnitude": 300000
        }
      }
    },
    {
      "scenarioId": "S0-cta-rv-open-close",
      "layoutTemplate": "fixed-cta",
      "mode": "resizes-visual",
      "expectedStatus": "PASS",
      "tsStatus": "PASS",
      "pyStatus": "PASS",
      "parity": true,
      "plantedErrorKind": null,
      "detected": false,
      "firstFailedStepIndex": 0,
      "failedPredicates": [],
      "finalMetrics": {
        "surfaceArea": 17184000000,
        "keyboardObscuredArea": 0,
        "viewportClippedArea": 0,
        "visibleArea": 17184000000,
        "visibleRatio": 1000,
        "bottomGap": 16000,
        "anchorDrift": {
          "dx": 0,
          "dy": 0,
          "magnitude": 0
        }
      }
    },
    {
      "scenarioId": "S0-cta-rv-open-scroll-close",
      "layoutTemplate": "fixed-cta",
      "mode": "resizes-visual",
      "expectedStatus": "PASS",
      "tsStatus": "PASS",
      "pyStatus": "PASS",
      "parity": true,
      "plantedErrorKind": null,
      "detected": false,
      "firstFailedStepIndex": 0,
      "failedPredicates": [],
      "finalMetrics": {
        "surfaceArea": 17184000000,
        "keyboardObscuredArea": 0,
        "viewportClippedArea": 0,
        "visibleArea": 17184000000,
        "visibleRatio": 1000,
        "bottomGap": 16000,
        "anchorDrift": {
          "dx": 0,
          "dy": 0,
          "magnitude": 0
        }
      }
    },
    {
      "scenarioId": "S0-cta-rv-open-pan",
      "layoutTemplate": "fixed-cta",
      "mode": "resizes-visual",
      "expectedStatus": "FAIL",
      "tsStatus": "FAIL",
      "pyStatus": "FAIL",
      "parity": true,
      "plantedErrorKind": "viewport-clipped",
      "detected": true,
      "firstFailedStepIndex": 0,
      "failedPredicates": [
        "visibleRatio",
        "bottomGap",
        "anchorDriftMagnitude"
      ],
      "finalMetrics": {
        "surfaceArea": 17184000000,
        "keyboardObscuredArea": 0,
        "viewportClippedArea": 17184000000,
        "visibleArea": 0,
        "visibleRatio": 0,
        "bottomGap": -274000,
        "anchorDrift": {
          "dx": 0,
          "dy": 290000,
          "magnitude": 290000
        }
      }
    },
    {
      "scenarioId": "S0-cta-rc-open",
      "layoutTemplate": "fixed-cta",
      "mode": "resizes-content",
      "expectedStatus": "PASS",
      "tsStatus": "PASS",
      "pyStatus": "PASS",
      "parity": true,
      "plantedErrorKind": null,
      "detected": false,
      "firstFailedStepIndex": null,
      "failedPredicates": [],
      "finalMetrics": {
        "surfaceArea": 17184000000,
        "keyboardObscuredArea": 0,
        "viewportClippedArea": 0,
        "visibleArea": 17184000000,
        "visibleRatio": 1000,
        "bottomGap": 16000,
        "anchorDrift": {
          "dx": 0,
          "dy": 0,
          "magnitude": 0
        }
      }
    },
    {
      "scenarioId": "S0-cta-rc-open-close",
      "layoutTemplate": "fixed-cta",
      "mode": "resizes-content",
      "expectedStatus": "PASS",
      "tsStatus": "PASS",
      "pyStatus": "PASS",
      "parity": true,
      "plantedErrorKind": null,
      "detected": false,
      "firstFailedStepIndex": null,
      "failedPredicates": [],
      "finalMetrics": {
        "surfaceArea": 17184000000,
        "keyboardObscuredArea": 0,
        "viewportClippedArea": 0,
        "visibleArea": 17184000000,
        "visibleRatio": 1000,
        "bottomGap": 16000,
        "anchorDrift": {
          "dx": 0,
          "dy": 0,
          "magnitude": 0
        }
      }
    },
    {
      "scenarioId": "S0-cta-rc-open-scroll-close",
      "layoutTemplate": "fixed-cta",
      "mode": "resizes-content",
      "expectedStatus": "PASS",
      "tsStatus": "PASS",
      "pyStatus": "PASS",
      "parity": true,
      "plantedErrorKind": null,
      "detected": false,
      "firstFailedStepIndex": null,
      "failedPredicates": [],
      "finalMetrics": {
        "surfaceArea": 17184000000,
        "keyboardObscuredArea": 0,
        "viewportClippedArea": 0,
        "visibleArea": 17184000000,
        "visibleRatio": 1000,
        "bottomGap": 16000,
        "anchorDrift": {
          "dx": 0,
          "dy": 0,
          "magnitude": 0
        }
      }
    },
    {
      "scenarioId": "S0-cta-rc-open-pan",
      "layoutTemplate": "fixed-cta",
      "mode": "resizes-content",
      "expectedStatus": "PASS",
      "tsStatus": "PASS",
      "pyStatus": "PASS",
      "parity": true,
      "plantedErrorKind": null,
      "detected": false,
      "firstFailedStepIndex": null,
      "failedPredicates": [],
      "finalMetrics": {
        "surfaceArea": 17184000000,
        "keyboardObscuredArea": 0,
        "viewportClippedArea": 0,
        "visibleArea": 17184000000,
        "visibleRatio": 1000,
        "bottomGap": 16000,
        "anchorDrift": {
          "dx": 0,
          "dy": 0,
          "magnitude": 0
        }
      }
    },
    {
      "scenarioId": "S0-cta-oc-open",
      "layoutTemplate": "fixed-cta",
      "mode": "overlays-content",
      "expectedStatus": "FAIL",
      "tsStatus": "FAIL",
      "pyStatus": "FAIL",
      "parity": true,
      "plantedErrorKind": "keyboard-obscured",
      "detected": true,
      "firstFailedStepIndex": 0,
      "failedPredicates": [
        "visibleRatio",
        "keyboardObscuredArea"
      ],
      "finalMetrics": {
        "surfaceArea": 17184000000,
        "keyboardObscuredArea": 17184000000,
        "viewportClippedArea": 0,
        "visibleArea": 0,
        "visibleRatio": 0,
        "bottomGap": 16000,
        "anchorDrift": {
          "dx": 0,
          "dy": 0,
          "magnitude": 0
        }
      }
    },
    {
      "scenarioId": "S0-cta-oc-open-close",
      "layoutTemplate": "fixed-cta",
      "mode": "overlays-content",
      "expectedStatus": "PASS",
      "tsStatus": "PASS",
      "pyStatus": "PASS",
      "parity": true,
      "plantedErrorKind": null,
      "detected": false,
      "firstFailedStepIndex": 0,
      "failedPredicates": [],
      "finalMetrics": {
        "surfaceArea": 17184000000,
        "keyboardObscuredArea": 0,
        "viewportClippedArea": 0,
        "visibleArea": 17184000000,
        "visibleRatio": 1000,
        "bottomGap": 16000,
        "anchorDrift": {
          "dx": 0,
          "dy": 0,
          "magnitude": 0
        }
      }
    },
    {
      "scenarioId": "S0-cta-oc-open-scroll-close",
      "layoutTemplate": "fixed-cta",
      "mode": "overlays-content",
      "expectedStatus": "PASS",
      "tsStatus": "PASS",
      "pyStatus": "PASS",
      "parity": true,
      "plantedErrorKind": null,
      "detected": false,
      "firstFailedStepIndex": 0,
      "failedPredicates": [],
      "finalMetrics": {
        "surfaceArea": 17184000000,
        "keyboardObscuredArea": 0,
        "viewportClippedArea": 0,
        "visibleArea": 17184000000,
        "visibleRatio": 1000,
        "bottomGap": 16000,
        "anchorDrift": {
          "dx": 0,
          "dy": 0,
          "magnitude": 0
        }
      }
    },
    {
      "scenarioId": "S0-cta-oc-open-pan",
      "layoutTemplate": "fixed-cta",
      "mode": "overlays-content",
      "expectedStatus": "FAIL",
      "tsStatus": "FAIL",
      "pyStatus": "FAIL",
      "parity": true,
      "plantedErrorKind": "keyboard-obscured",
      "detected": true,
      "firstFailedStepIndex": 0,
      "failedPredicates": [
        "visibleRatio",
        "keyboardObscuredArea"
      ],
      "finalMetrics": {
        "surfaceArea": 17184000000,
        "keyboardObscuredArea": 17184000000,
        "viewportClippedArea": 0,
        "visibleArea": 0,
        "visibleRatio": 0,
        "bottomGap": 16000,
        "anchorDrift": {
          "dx": 0,
          "dy": 0,
          "magnitude": 0
        }
      }
    },
    {
      "scenarioId": "S0-search-rv-open",
      "layoutTemplate": "search-bar",
      "mode": "resizes-visual",
      "expectedStatus": "PASS",
      "tsStatus": "PASS",
      "pyStatus": "PASS",
      "parity": true,
      "plantedErrorKind": null,
      "detected": false,
      "firstFailedStepIndex": null,
      "failedPredicates": [],
      "finalMetrics": {
        "surfaceArea": 17184000000,
        "keyboardObscuredArea": 0,
        "viewportClippedArea": 0,
        "visibleArea": 17184000000,
        "visibleRatio": 1000,
        "bottomGap": 484000,
        "anchorDrift": {
          "dx": 0,
          "dy": 0,
          "magnitude": 0
        }
      }
    },
    {
      "scenarioId": "S0-search-rv-open-close",
      "layoutTemplate": "search-bar",
      "mode": "resizes-visual",
      "expectedStatus": "PASS",
      "tsStatus": "PASS",
      "pyStatus": "PASS",
      "parity": true,
      "plantedErrorKind": null,
      "detected": false,
      "firstFailedStepIndex": null,
      "failedPredicates": [],
      "finalMetrics": {
        "surfaceArea": 17184000000,
        "keyboardObscuredArea": 0,
        "viewportClippedArea": 0,
        "visibleArea": 17184000000,
        "visibleRatio": 1000,
        "bottomGap": 784000,
        "anchorDrift": {
          "dx": 0,
          "dy": 0,
          "magnitude": 0
        }
      }
    },
    {
      "scenarioId": "S0-search-rv-open-scroll-close",
      "layoutTemplate": "search-bar",
      "mode": "resizes-visual",
      "expectedStatus": "PASS",
      "tsStatus": "PASS",
      "pyStatus": "PASS",
      "parity": true,
      "plantedErrorKind": null,
      "detected": false,
      "firstFailedStepIndex": null,
      "failedPredicates": [],
      "finalMetrics": {
        "surfaceArea": 17184000000,
        "keyboardObscuredArea": 0,
        "viewportClippedArea": 0,
        "visibleArea": 17184000000,
        "visibleRatio": 1000,
        "bottomGap": 784000,
        "anchorDrift": {
          "dx": 0,
          "dy": 0,
          "magnitude": 0
        }
      }
    },
    {
      "scenarioId": "S0-search-rv-open-pan",
      "layoutTemplate": "search-bar",
      "mode": "resizes-visual",
      "expectedStatus": "PASS",
      "tsStatus": "PASS",
      "pyStatus": "PASS",
      "parity": true,
      "plantedErrorKind": null,
      "detected": false,
      "firstFailedStepIndex": null,
      "failedPredicates": [],
      "finalMetrics": {
        "surfaceArea": 17184000000,
        "keyboardObscuredArea": 0,
        "viewportClippedArea": 0,
        "visibleArea": 17184000000,
        "visibleRatio": 1000,
        "bottomGap": 494000,
        "anchorDrift": {
          "dx": 0,
          "dy": -10000,
          "magnitude": 10000
        }
      }
    },
    {
      "scenarioId": "S0-search-rc-open",
      "layoutTemplate": "search-bar",
      "mode": "resizes-content",
      "expectedStatus": "PASS",
      "tsStatus": "PASS",
      "pyStatus": "PASS",
      "parity": true,
      "plantedErrorKind": null,
      "detected": false,
      "firstFailedStepIndex": null,
      "failedPredicates": [],
      "finalMetrics": {
        "surfaceArea": 17184000000,
        "keyboardObscuredArea": 0,
        "viewportClippedArea": 0,
        "visibleArea": 17184000000,
        "visibleRatio": 1000,
        "bottomGap": 484000,
        "anchorDrift": {
          "dx": 0,
          "dy": 0,
          "magnitude": 0
        }
      }
    },
    {
      "scenarioId": "S0-search-rc-open-close",
      "layoutTemplate": "search-bar",
      "mode": "resizes-content",
      "expectedStatus": "PASS",
      "tsStatus": "PASS",
      "pyStatus": "PASS",
      "parity": true,
      "plantedErrorKind": null,
      "detected": false,
      "firstFailedStepIndex": null,
      "failedPredicates": [],
      "finalMetrics": {
        "surfaceArea": 17184000000,
        "keyboardObscuredArea": 0,
        "viewportClippedArea": 0,
        "visibleArea": 17184000000,
        "visibleRatio": 1000,
        "bottomGap": 784000,
        "anchorDrift": {
          "dx": 0,
          "dy": 0,
          "magnitude": 0
        }
      }
    },
    {
      "scenarioId": "S0-search-rc-open-scroll-close",
      "layoutTemplate": "search-bar",
      "mode": "resizes-content",
      "expectedStatus": "PASS",
      "tsStatus": "PASS",
      "pyStatus": "PASS",
      "parity": true,
      "plantedErrorKind": null,
      "detected": false,
      "firstFailedStepIndex": null,
      "failedPredicates": [],
      "finalMetrics": {
        "surfaceArea": 17184000000,
        "keyboardObscuredArea": 0,
        "viewportClippedArea": 0,
        "visibleArea": 17184000000,
        "visibleRatio": 1000,
        "bottomGap": 784000,
        "anchorDrift": {
          "dx": 0,
          "dy": 0,
          "magnitude": 0
        }
      }
    },
    {
      "scenarioId": "S0-search-rc-open-pan",
      "layoutTemplate": "search-bar",
      "mode": "resizes-content",
      "expectedStatus": "PASS",
      "tsStatus": "PASS",
      "pyStatus": "PASS",
      "parity": true,
      "plantedErrorKind": null,
      "detected": false,
      "firstFailedStepIndex": null,
      "failedPredicates": [],
      "finalMetrics": {
        "surfaceArea": 17184000000,
        "keyboardObscuredArea": 0,
        "viewportClippedArea": 0,
        "visibleArea": 17184000000,
        "visibleRatio": 1000,
        "bottomGap": 484000,
        "anchorDrift": {
          "dx": 0,
          "dy": 0,
          "magnitude": 0
        }
      }
    },
    {
      "scenarioId": "S0-search-oc-open",
      "layoutTemplate": "search-bar",
      "mode": "overlays-content",
      "expectedStatus": "PASS",
      "tsStatus": "PASS",
      "pyStatus": "PASS",
      "parity": true,
      "plantedErrorKind": null,
      "detected": false,
      "firstFailedStepIndex": null,
      "failedPredicates": [],
      "finalMetrics": {
        "surfaceArea": 17184000000,
        "keyboardObscuredArea": 0,
        "viewportClippedArea": 0,
        "visibleArea": 17184000000,
        "visibleRatio": 1000,
        "bottomGap": 784000,
        "anchorDrift": {
          "dx": 0,
          "dy": 0,
          "magnitude": 0
        }
      }
    },
    {
      "scenarioId": "S0-search-oc-open-close",
      "layoutTemplate": "search-bar",
      "mode": "overlays-content",
      "expectedStatus": "PASS",
      "tsStatus": "PASS",
      "pyStatus": "PASS",
      "parity": true,
      "plantedErrorKind": null,
      "detected": false,
      "firstFailedStepIndex": null,
      "failedPredicates": [],
      "finalMetrics": {
        "surfaceArea": 17184000000,
        "keyboardObscuredArea": 0,
        "viewportClippedArea": 0,
        "visibleArea": 17184000000,
        "visibleRatio": 1000,
        "bottomGap": 784000,
        "anchorDrift": {
          "dx": 0,
          "dy": 0,
          "magnitude": 0
        }
      }
    },
    {
      "scenarioId": "S0-search-oc-open-scroll-close",
      "layoutTemplate": "search-bar",
      "mode": "overlays-content",
      "expectedStatus": "PASS",
      "tsStatus": "PASS",
      "pyStatus": "PASS",
      "parity": true,
      "plantedErrorKind": null,
      "detected": false,
      "firstFailedStepIndex": null,
      "failedPredicates": [],
      "finalMetrics": {
        "surfaceArea": 17184000000,
        "keyboardObscuredArea": 0,
        "viewportClippedArea": 0,
        "visibleArea": 17184000000,
        "visibleRatio": 1000,
        "bottomGap": 784000,
        "anchorDrift": {
          "dx": 0,
          "dy": 0,
          "magnitude": 0
        }
      }
    },
    {
      "scenarioId": "S0-search-oc-open-pan",
      "layoutTemplate": "search-bar",
      "mode": "overlays-content",
      "expectedStatus": "PASS",
      "tsStatus": "PASS",
      "pyStatus": "PASS",
      "parity": true,
      "plantedErrorKind": null,
      "detected": false,
      "firstFailedStepIndex": null,
      "failedPredicates": [],
      "finalMetrics": {
        "surfaceArea": 17184000000,
        "keyboardObscuredArea": 0,
        "viewportClippedArea": 0,
        "visibleArea": 17184000000,
        "visibleRatio": 1000,
        "bottomGap": 784000,
        "anchorDrift": {
          "dx": 0,
          "dy": 0,
          "magnitude": 0
        }
      }
    }
  ],
  "scenariosTotal": 48,
  "seed": "P021-VIEWPORTSHIFT-S0-2026-11-10",
  "specVersion": "1.0.0",
  "status": "PASS",
  "gateSha256": "65b4b32f4a5298642fd3de5a64441ed7d214e2519d118b8b67a7871ba73aca26"
}
```

## 8. 文件清单及 SHA-256

完整清单与哈希见 `handoff/T003/sha256.txt`（本节为摘要；哈希值以该文件为准）。

### 新建（T003）

- `src/domain/geometry.ts` — TS 矩形几何与场景分析
- `oracle/python/geometry_oracle.py` — 独立 Python Oracle（替换 T001 空桩）
- `tests/fixtures/s0/s0-geometry-01.json` … `s0-geometry-48.json` — 48 场景 fixtures
- `tests/fixtures/s0/s0-edge-clock-regression.json`、`s0-edge-keyboard-too-tall.json`、`s0-edge-scale-2.json`、`s0-edge-unknown-mode.json`、`s0-edge-zero-area.json` — 5 个边界 fixtures
- `scripts/s0-lib.mjs`、`scripts/s0-geometry.mjs`、`scripts/s0-oracle.mjs`、`scripts/s0-determinism.mjs`、`scripts/s0-gate.mjs` — 验收脚本
- `evidence/s0/S0_GATE.json`、`S0_GEOMETRY_TS.json`、`S0_GEOMETRY_PY.json`、`S0_DETERMINISM.json`、`S0_DETERMINISM_PY.json`、`T003_REPORT.md` — 门禁证据与技术报告
- `handoff/T003/` — 本交接包

### 修改（T003）

- `package.json` — 新增 `s0:geometry`、`s0:oracle`、`s0:determinism`、`s0:gate` 四个脚本
- `README.md` — 仅状态行更新为 `SPEC_FROZEN / S0_PASS`

### 未修改（已验证）

- `P021_PROJECT_BOOK.md`、`P021_IMPLEMENTATION_PLAN.md`（规格，SHA 与 T002 记录一致）
- `src/domain/viewport-state.ts`、`scripts/s0-state-machine.mjs`、`tests/fixtures/s0/state-machine-poc-01.json` … `state-machine-poc-08.json`（T002 全部，`sha256sum -c handoff/T002/sha256.txt` 全部 OK）
- `package-lock.json`、`tsconfig.json`、其余源码与 UI 文件

## 9. 修复记录（首次运行曾 FAIL，属实记录）

1. 第一版 `s0:geometry` 的禁令扫描命中了 `geometry.ts` 头注释中写出的 `Math.random` 字样（注释文字，非代码）；改写注释后通过，实现代码未动。
2. `s0:oracle` 第一版把 5 个预期 UNKNOWN/INVALID 的边界用例计入误报而 FAIL；修复为仅对 48 主场景计误报后通过，Oracle 与实现均未动。

## 10. 已知事项 / 交给下游的说明（非未解决项）

1. 未知模式校验在 T003 分析层，不在 T002 状态机层（T002 的 `transition` 不白名单校验 mode 名；正式校验属于 T005）。
2. 场景状态取终态；T008 BFS 的最短见证搜索将采用 any-step 语义。
3. T002 行为原样保留：`resizes-visual` 下 OPEN→PAN→CLOSE 后视觉偏移不复位；48 场景不含该序列，未触及；Python Oracle 按同一行为实现。
4. 48 场景视口固定 390×844；多尺寸覆盖属于 T011。

## 11. 未解决项

NONE（见 `handoff/T003/unresolved_items.md`）。
