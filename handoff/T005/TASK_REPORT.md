# T005 任务报告 — 三种视口模式正式求值器

- 任务：P021 ViewportShift T005（S1，5h）
- 起点：HEAD `5618fa3`（T004 已提交），开始前 `git status` 干净，HEAD 核对一致。
- 规格：`~/workspace/P021_PROJECT_BOOK.md`（SHA 8070d7e3…）、`~/workspace/P021_IMPLEMENTATION_PLAN.md`（SHA 458cd409…）；S0 证据 `evidence/s0/S0_GATE.json`（status PASS）。
- 状态：**完成，两个验收命令全部通过，S0 门禁重跑仍为 PASS，无回归。**
- 工作目录：`~/workspace/p021-viewportshift/`；未提交（留待主控 review + commit）。未对外发消息、未上传 GitHub、未写 Drive、未 push。
- 模型调用：本任务未调用任何外部模型（全部工作由本会话直接完成），未使用任何 key。

## 1. 做了什么

### 1.1 `src/domain/modes.ts`（新增，正式求值器）

纯函数求值器，输入 `viewportshift.scenario/v1` 场景 → 输出逐事件状态转移结果。建立在 T004 Schema（`types.ts` + `validate.ts`，只读导入，未改动）与 T002 PoC 状态机（`viewport-state.ts`，只读导入，未改动）之上，对 PoC 的升级全部是按项目书的硬化，不是静默改算术：

1. **模式白名单 fail-closed**：`evaluateModeTransition()` 先查三模式白名单，未知模式返回 UNKNOWN（`unsupported_mode`），不进入状态机。PoC 的 `transition()` 本身不白名单模式名，未知模式会落入 `overlays-content` 分支（T003 已在分析层绕过，T005 现在求值器层正式拥有该检查）。
2. **Schema 优先入口**：`evaluateModes(input, scenarioSha256)` 先用 T004 `validateScenario` 校验；结构问题 → INVALID，合规但超模型范围 → UNKNOWN（按项目书 §3.4），仅 VALID 场景进入状态机。`reason` 取首个校验 issue 的 code，完整 issue 列表保留在 `validationIssues` 中供 Oracle 逐字段比对。INVALID/UNKNOWN 输入不产生状态、步数为空（与 `types.ts`“下游只接收 VALID 场景”的约定一致）。
3. **逐事件模式契约检查**：每次成功转移后，按项目书 §4.2 验证该模式 + 事件的契约（布局/视觉/键盘矩形关系、滚动独立性、平移夹紧、pendingPan 生命周期、时钟推进）。任一检查失败 → 该步 UNKNOWN（`mode_contract_violation:<检查名>`），重放停止，状态保持为事件之前。检查为 (prev, next, event, mode) 的纯谓词，全部整数等式。
4. **确定性规范化输出**：`canonicalModeJson` 与 S0 几何模块相同的排序键、无空格规范化，场景哈希与分析哈希可与 Python Oracle 逐字节比对。
5. **延迟平移不是第四模式**：`DELAYED_VISUAL_PAN` 只移动视觉偏移（夹紧）、记录 `pendingPan`，永不改变 `mode` 字段；每步都断言 `mode_unchanged`（runner 显式检查）。

导出：`evaluateModes` / `evaluateScenarioModes` / `evaluateModeTransition` / `contractChecksFor` / `canonicalModeJson` / `isStandardMode` / `MODES_VERSION="modes/v1"`。

### 1.2 与 S0 PoC 不一致处（以项目书为准；以下行为均按项目书沉默、保留 PoC 原样，并以 fixture 钉住）

项目书 §4.2 未规定下述细节，T005 不做重新设计，全部保留 PoC 行为：

- `resizes-visual` 下 `KEYBOARD_CLOSE` 只恢复 `visualHeight`，**不重置 `visualOffsetTop`**：键盘打开期间做过平移再关闭，视觉矩形在关闭后仍带偏移（fixture `modes-rv-open-pan-close.json` 钉住：关闭后 `visualHeight=844000`、`visualOffsetTop=100000`、`pendingPan={0,100000}`）。
- `resizes-content` 下 `KEYBOARD_OPEN` 将视觉偏移清零。
- 无键盘时 `KEYBOARD_CLOSE` 幂等，仅时钟推进。
- `SCROLL` 只更新独立滚动偏移（下限 0），永不移动视觉偏移。
- `resizes-content` 二次打开按“完整高度 − 新高度”绝对重算（非增量），`resizes-visual` 同理。

### 1.3 `oracle/python/modes_oracle.py`（新增，独立 Python 模式 Oracle）

自包含实现，不导入 TS 代码、不导入 S0 几何 Oracle（仅标准库 `argparse/hashlib/json/re/sys/pathlib`）：T004 验证器的完整镜像（固定检查顺序、错误码、消息文本、规范化默认值）、T002 状态机镜像、§4.2 契约检查镜像（检查名与顺序与 TS 完全一致）、CLI（`--files/--out/--repeat`，与 `geometry_oracle.py` 同款接口）。`evaluate_modes` / `evaluate_fixtures` 与 TS 的 `ModeEvaluation` 文档逐字段同构。

### 1.4 模式边界 fixtures：`tests/fixtures/modes/`（41 个）

全部为合成数据、固定 seed `P021-VIEWPORTSHIFT-S0-2026-11-10`、基准视口 390×844 CSS px（chat-input 布局）。每种模式均有正例 / 负例 / 边界例：

| 模式 | 正例 | 负例 | 边界例 |
|---|---|---|---|
| resizes-visual（13） | open、open-close、reopen、open-scroll | open 的 `notFinal` 控制（终态不得等于 resizes-content 的布局缩小 / overlays-content 的视觉不变） | h=0、h=844000（=布局高）、close-when-closed、pan 精确夹紧、pan 超限夹紧、等时间戳、scroll 负向夹紧到 0、pan 后 close |
| resizes-content（8） | open、open-close、reopen、open-scroll | open 的 `notFinal` 控制 | h=0、h=844000（布局高→0）、close-when-closed、pan 无空间夹紧 |
| overlays-content（8） | open、open-close、reopen、open-scroll | open 的 `notFinal` 控制 | h=0、h=844000、close-when-closed、pan 无空间夹紧 |

另 12 个 fail-closed：8 UNKNOWN（未知模式、未知事件类型、scale=2、时钟倒退、键盘超高、事件超限、平移超限、未知模板）+ 4 INVALID（缺 mode、零面积、非整数、重复事件 id）。每个 OK fixture 含手写终态期望（逐字段）、`notFinal` 模式混淆控制、逐事件契约检查名列表、平移报告期望（5 个 pan fixture）。

### 1.5 脚本与 package.json

- `scripts/t005-lib.mjs`：T005 域加载（内存转译 types/validate/viewport-state/modes）、fixture 清单、Python Modes Oracle 调用、规范化哈希。
- `scripts/test-modes.mjs`（`npm run test:modes`）：断言 fixture 数、seed、手写期望（状态/reason/failedEventId/failedStepIndex/终态/notFinal/检查名/平移报告）、mode 不变、两次运行同一哈希、禁 token 扫描；写 `evidence/modes/MODES_TS.json`。
- `scripts/oracle-diff-modes.mjs`（`npm run oracle:diff:modes`）：TS 与 Python 对同一 41 个 fixture 逐字段差分（`diffPaths`，任一 mismatch 即 fail，无忽略清单），断言 41/41 parity、分析哈希相等；写 `evidence/modes/MODES_PY.json`、`evidence/modes/MODES_DIFF.json`。
- `package.json`：仅新增 `test:modes` 与 `oracle:diff:modes` 两个脚本（保持原单行格式，diff 仅 1 行）。

## 2. 改了哪些文件

见 `handoff/T005/changed_files.txt` 与 `sha256.txt`。清单：

- 新增：`src/domain/modes.ts`、`oracle/python/modes_oracle.py`、`scripts/t005-lib.mjs`、`scripts/test-modes.mjs`、`scripts/oracle-diff-modes.mjs`、`tests/fixtures/modes/`（41 个 JSON）、`evidence/modes/`（3 个 JSON）、`handoff/T005/`。
- 修改：`package.json`（仅 +2 脚本）。
- **未动**：`src/domain/types.ts`、`validate.ts`、`viewport-state.ts`、`geometry.ts`（T004 冻结 Schema 与 S0 代码零改动）；`tests/fixtures/s0/`、`evidence/s0/`、`oracle/python/geometry_oracle.py` 零改动（`git status` 验证为空）。

## 3. 验收命令逐条输出（原文关键行）

### `npm run typecheck` — exit 0

```text
> viewportshift@0.1.0 typecheck
> tsc --noEmit
```

### `npm run test:modes` — exit 0，checks 1159/1159

```text
fixtures: 41, steps checked: 47, contract checks: 417, OK=29 UNKNOWN=8 INVALID=4
analysisSha256: c0ab0d487bda99bc1d495a8d0c04dd6faafee29d9c25e7edc1e115513dcd7cf7
wrote evidence/modes/MODES_TS.json

checks passed: 1159, checks failed: 0

Modes (TS): PASS
```

抽样行：

```text
T005-rv-open: status=OK expected=OK reason=- steps=1 layoutH=844000 visualH=544000 kb={"x":0,"y":544000,"width":390000,"height":300000} visible=true scrollY=0 offsetTop=0
T005-rc-open: status=OK expected=OK reason=- steps=1 layoutH=544000 visualH=544000 kb={"x":0,"y":544000,"width":390000,"height":300000} visible=true scrollY=0 offsetTop=0
T005-oc-open: status=OK expected=OK reason=- steps=1 layoutH=844000 visualH=844000 kb={"x":0,"y":544000,"width":390000,"height":300000} visible=true scrollY=0 offsetTop=0
T005-unknown-mode: status=UNKNOWN expected=UNKNOWN reason=unsupported_mode steps=0 states=null
T005-scale-2: status=UNKNOWN expected=UNKNOWN reason=unsupported_scale steps=0 states=null
```

### `npm run oracle:diff:modes` — exit 0，parity 41/41，checks 98/98

```text
modes oracle: fixtures=41 statuses={'UNKNOWN': 8, 'INVALID': 4, 'OK': 29} analysisSha256=c0ab0d487bda99bc1d495a8d0c04dd6faafee29d9c25e7edc1e115513dcd7cf7 runs=1 uniqueHashes=1
wrote evidence/modes/MODES_DIFF.json
parity: 41/41, mismatches: 0
ts analysisSha256: c0ab0d487bda99bc1d495a8d0c04dd6faafee29d9c25e7edc1e115513dcd7cf7
py analysisSha256: c0ab0d487bda99bc1d495a8d0c04dd6faafee29d9c25e7edc1e115513dcd7cf7

checks passed: 98, checks failed: 0

Modes oracle diff: PASS
```

全部 41 个 fixture 均为 `parity=true`（逐字段 identical，含 `validationIssues` 的 code/path/message、`scenarioSha256`、逐事件状态、panReport、contractChecks）。

### 回归（全部 exit 0）

| 命令 | 结果 |
|---|---|
| `npm run test:schema` | PASS，checks 259/259 |
| `npm run test:validation` | PASS，checks 273/273 |
| `npm run s0:state-machine` | exit 0 |
| `npm run s0:geometry` | exit 0 |
| `npm run s0:oracle` | exit 0 |
| `npm run s0:determinism` | exit 0 |
| `npm run s0:gate` | **PASS**，checks 120/120（见下） |
| `npm run build` | exit 0 |

### S0 门禁重跑结果（`npm run s0:gate`，必须仍为 PASS）

```text
S0 gate: scenarios=48 parity=53/53 planted=12/12 falsePositives=0 edge=5/5 determinism=100 runs, tsUnique=1, pyUnique=1
analysisSha256: a7584d47023c38c19cb7fc9cb71c671744d4917f9a67e1ee9f3c8021375165df
gateSha256: 65b4b32f4a5298642fd3de5a64441ed7d214e2519d118b8b67a7871ba73aca26
wrote evidence/s0/S0_GATE.json

checks passed: 120, checks failed: 0

S0 gate: PASS (53/53 parity: 48 main + 5 edge, 12/12 planted, 0 false positives, 100 runs / 1 hash)
```

即：**48/48 parity、12/12 检出、0 误报、100 次运行 1 个哈希**，与 T004 提交时的门禁哈希完全一致（`gateSha256 65b4b32f…`、`analysisSha256 a7584d47…` 未变），无回归。`evidence/s0/` 文件重跑后字节一致，`git status` 无修改。

## 4. 测试总数与通过数

- `test:modes`：1159 个检查，1159 通过，0 失败（41 fixtures / 47 步 / 417 个契约检查；29 OK / 8 UNKNOWN / 4 INVALID）。
- `oracle:diff:modes`：98 个检查，98 通过，0 失败（41/41 parity，0 mismatch；TS 与 Python 分析哈希相同：`c0ab0d48…d7cf7`）。
- 回归：`test:schema` 259/259、`test:validation` 273/273、`s0:gate` 120/120。

## 5. 开发中发现并修复的两个问题（已修复，均有回归覆盖）

1. **Python `canonical_json` 不处理 float**：`modes-invalid-non-integer.json` 含 `390000.5`，Python Oracle 首次运行抛 `TypeError`。修复：`modes_oracle.py` 的 `canonical_json` 接受 float（`json.dumps`，与 TS `JSON.stringify` 对该值的输出一致）。S0 的 `geometry_oracle.py` 未动（S0 fixtures 无 float，不受影响）。
2. **两个脚本的按模式计数把 fail-closed 也算进去了**：`test-modes.mjs` 与 `oracle-diff-modes.mjs` 初版按 `mode` 字段计数，resizes-visual 计为 23 而非 13（10 个 fail-closed fixture 的 mode 也是 resizes-visual）。修复：改为只计 `expected.status === "OK"` 的 fixture。parity 本身始终是 41/41，不受影响。

## 6. 未解决项

**无。**

说明性记录（非未解决项，供 T006 参考）：

- §1.2 列出的 PoC 保留行为（尤其 resizes-visual 关闭后 `visualOffsetTop` 不重置）是项目书未规定的建模选择，T005 按“以项目书为准、项目书沉默则保留 PoC”处理并以 fixture 钉住；若 T006（延迟平移与滚动事件模型）认为关闭时应重置偏移，需由 T006 另行决策并同步更新 PoC、modes 契约检查与相关 fixture，不得静默改值。
- `evaluateModes` 对校验失败的输入不做部分重放（无步骤轨迹，只有 reason + issues）；S0 边缘用例的逐步重放行为仍由 `s0:gate` 覆盖。
- `modes_oracle.py` 的 `canonical_json` 对 float 的处理只在已出现的 `390000.5` 这类常规值上与 TS 一致；极端 float 表示（科学计数法、-0）在 modes fixtures 中不存在，未作额外断言。
- fixture 生成脚本为一次性工具，位于 `/tmp/gen_modes_fixtures.py`（未入版本库）；fixtures 本身已入 `tests/fixtures/modes/`，期望值全部手写在该脚本的表里。
