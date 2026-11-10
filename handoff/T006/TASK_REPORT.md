# T006 任务报告 — 延迟平移与滚动事件模型

- 任务：P021 ViewportShift T006（S1，4h）
- 起点：HEAD `4e9529a`（T005 已提交），开始前 `git status` 干净，HEAD 核对一致。
- 规格：`~/workspace/P021_PROJECT_BOOK.md`（SHA 8070d7e3…）、`~/workspace/P021_IMPLEMENTATION_PLAN.md`（SHA 458cd409…）；S0 证据 `evidence/s0/S0_GATE.json`（status PASS）。
- 状态：**完成，三个验收命令全部通过，S0 门禁重跑仍为 PASS，无回归。**
- 工作目录：`~/workspace/p021-viewportshift/`；未提交（留待主控 review + commit）。未对外发消息、未上传 GitHub、未写 Drive、未 push。
- 模型调用：本任务未调用任何外部模型（全部工作由本会话直接完成），未使用任何 key。

## 1. 做了什么

### 1.1 `src/domain/events.ts`（新增，事件模型层）

建立在 T004 Schema（只读导入，未改动）与 T005 正式求值器 `modes.ts`（只读导入，未改动其模式语义）之上的纯函数事件模型层：

- **入口**：`evaluateEvents(input, scenarioSha256)` 先用 T004 `validateScenario` 校验（INVALID / UNKNOWN 输入不进入状态机，状态为 null、步数为空，与 T005 一致）；仅 VALID 场景进入重放。
- **逐事件转移**：`evaluateEventTransition()` 调用 T005 `evaluateModeTransition()`（PoC 转移 + §4.2 契约检查），再叠加本层事件检查；任一检查失败 → 该步 UNKNOWN（`event_model_violation:<检查名>`），重放停止，状态保持为事件之前。
- **事件检查**（`eventChecksFor`，固定顺序）：通用三项（`ev_clock_advanced`、`ev_clock_monotonic`、`ev_mode_unchanged`）+ 按事件类型：open（可见/pending 不变/scroll 不变）、close（隐藏/偏移保留/pending 保留/scroll 不变）、SCROLL（applied 与报告一致/非负/视觉不动/pending 不变）、PAN（在界内/applied 与报告一致/pending 即 applied/尺寸不变/scroll 不变）、SETTLED（pending 清零/其余不变）。
- **延迟平移夹紧**（`panClamp` / `clampBoundsFor`）：界按 pan 前状态算，`maxLeft = max(0, layoutWidth − visualWidth)`，`maxTop = max(0, layoutHeight − visualHeight)`；每步记录 requested/applied、界、clamped、clampReason（措辞与 PoC 完全一致：`dx clamped to [0, N]` / `dy clamped to [0, N]`），并汇总进 `clampEvidence`。MVP 注记：`visualWidth` 恒等于 `layoutWidth`（无 pinch zoom、scale 固定 1），故 `maxLeft` 在全部三种模式下恒为 0，任何非零水平平移都会被完全夹紧——这是模型的推论而非错误，fixture 已钉住。
- **滚动报告**（`scrollClamp`）：SCROLL 只更新独立滚动偏移、下界为 0；以与 PanReport 同形的 `ScrollReport` 记录 requested/applied 与夹紧原因（`dx clamped to [0, +inf)`）。
- **SETTLED 生命周期**：`pendingPan` 自最近一次 PAN 起保留，直到下一次 `VIEWPORT_SETTLED` 清零；close 不触碰 pendingPan。
- **延迟平移不是第四模式**：每步断言 `ev_mode_unchanged`；mode 字段永不被 pan 改动。
- 导出：`evaluateEvents` / `evaluateScenarioEvents` / `evaluateEventTransition` / `eventChecksFor` / `clampBoundsFor` / `panClamp` / `scrollClamp` / `canonicalEventJson` / `EVENTS_VERSION="events/v1"`。

### 1.2 `oracle/python/events_oracle.py`（新增，独立 Python Events Oracle）

自包含实现，不导入 TS 代码、不导入 S0 几何 Oracle 与 modes Oracle（仅标准库）。复用 modes Oracle 的 T004 验证器镜像、T002 状态机镜像与 §4.2 契约检查镜像（检查名与顺序与 TS 完全一致），新增事件层镜像：`clamp_bounds_for` / `pan_clamp` / `scroll_clamp` / `event_checks_for` / `evaluate_event_transition` / `evaluate_scenario_events` / `evaluate_events`，CLI（`--files/--out/--repeat`，与 modes Oracle 同款接口）。输出文档与 TS `EventTrace` 逐字段同构（含 `scrollReports` 与 `clampEvidence`）。

### 1.3 事件轨迹 fixtures：`tests/fixtures/events/`（27 个）

全部为合成数据、固定 seed `P021-VIEWPORTSHIFT-S0-2026-11-10`、基准视口 390×844 CSS px（chat-input 布局）、键盘 300000 milli-px。22 OK / 4 UNKNOWN / 1 INVALID：

| 类别 | Fixtures |
|---|---|
| 夹紧上界 | pan 恰好命中上界 300000（exact-top，不夹紧）、超限 400000→300000（over-top）、pan 至上限 500000（= maxPanMilli，允许，夹紧至 300000） |
| 夹紧下界 | 负向 pan −50000→0（negative）、下→上精确回 0（down-up-exact） |
| 水平夹紧 | dx=50000 全夹紧（maxLeft=0，`dx clamped to [0, 0]`）、dx=0 精确通过 |
| 无平移空间 | resizes-content / overlays-content / 零键盘高度下 maxTop=0，pan 全夹紧 |
| 滚动 | scroll 后 pan 互不干扰、负向 scroll 双轴夹紧至 0、下→上精确回 0 |
| 时序 | 等时间戳保序、单调时间轴（open→scroll→pan→settled→close）、时钟倒退 UNKNOWN（验证器先拦截，见 §5） |
| settled/关闭 | pan 后 settled 清 pendingPan 不动偏移、close 后 settled、空闲 settled、空闲 close |
| 遗留决策 | pan 后 close 仍带偏移（见下）、重开后 pan 恰好 300000 |
| fail-closed | pan 超限（500001 > maxPanMilli）、事件超限（9 > maxEvents 8）、未知事件类型、重复事件 id |

每个 OK fixture 含手写终态期望、逐事件 pan/scroll 报告期望、逐事件 event/contract 检查名列表、逐 pan 步夹紧界与 clamp 证据行。Fixture 生成脚本为一次性工具，位于 `/tmp/gen_events_fixtures.py`（未入版本库）；生成后全部 27 个终态已逐项手核（见 §5）。

### 1.4 脚本与 package.json

- `scripts/t006-lib.mjs`：T006 域加载（内存转译 types/validate/viewport-state/modes/events）、fixture 清单、Python Events Oracle 调用、规范化哈希。
- `scripts/test-events.mjs`（`npm run test:events`）：断言 fixture 数、seed、手写期望（状态/reason/failedEventId/failedStepIndex/终态/pan 与 scroll 报告/检查名/夹紧界/clamp 证据）、mode 不变、两次运行同一哈希、禁 token 扫描；写 `evidence/events/EVENTS_TS.json` 与 `evidence/events/CLAMP_EVIDENCE.json`（20 行夹紧证据）。
- `scripts/test-event-order.mjs`（`npm run test:event-order`）：脚本内构造场景，断言等时间戳保序、时钟单调推进、时钟倒退 fail-closed（验证层 + 直接重放层两级）、事件顺序改变轨迹（先 pan 后 open 与先 open 后 pan 的夹紧界不同）、全量 fixture 两次运行逐字节一致、同一场景两次重放逐字节一致。
- `scripts/oracle-diff-events.mjs`（`npm run oracle:diff:events`）：TS 与 Python 对同一 27 个 fixture 逐字段差分（`diffPaths`，任一 mismatch 即 fail，无忽略清单），断言 27/27 parity、分析哈希相等；写 `evidence/events/EVENTS_PY.json`、`evidence/events/EVENTS_DIFF.json`。
- `package.json`：仅新增 `test:events`、`test:event-order`、`oracle:diff:events` 三个脚本（保持原单行格式，diff 仅 1 行）。

## 2. 上游遗留决策

**决策：维持（MAINTAIN）T005 保留的 PoC 行为——`resizes-visual` 下 `KEYBOARD_CLOSE` 只恢复 `visualHeight`，不重置 `visualOffsetTop`。**

理由：

1. **改动在任务约束下不可行且无必要**：两份冻结 Oracle 均镜像了该行为（`modes_oracle.py` 的 rv close 检查 `rv_offsets_unchanged`、`geometry_oracle.py` 的 rv close 分支），而 T006 任务明文禁止改动这两个 Oracle 文件。只改 TypeScript 一侧会立刻破坏 modes 差分 41/41 与 S0 门禁；改 Oracle 则违反任务禁令。二选一的前提下，维持是唯一与全部约束相容的选择。
2. **S0 门禁钉住了 PoC 转移算术**：S0 gate 哈希（`65b4b32f…`）依赖该行为；改动会使 S0 证据失效，需重做 S0——超出 T006 授权范围。
3. **保留的偏移是可观测、确定性的**：它不是未定义行为，而是被 fixture 钉住的确定性状态（T005 `modes-rv-open-pan-close.json` 与本任务 `events-rv-open-pan-close-retained.json` 一致：关闭后 `visualOffsetTop=100000`、`pendingPan={0,100000}`）。

**明确的后果（已写入 `events.ts` 头注释与本节，不作隐藏）**：关闭后保留的偏移可能超出关闭后的合法 pan 界（高度恢复后 `layoutHeight − visualHeight = 0`）。这不是夹紧违规——夹紧界只约束 pan 步、按 pan 前状态计算；但从该保留偏移出发的后续 pan 会按恢复后的界夹紧，本任务以 `events-rv-reopen-pan.json` 钉住（重开后 pan +200000 自 100000 恰好命中 300000，不夹紧）。`VIEWPORT_SETTLED` 在关闭后清 `pendingPan`，但不移动保留的偏移（`events-rv-open-pan-close-settled.json` 钉住：`pendingPan={0,0}`、`visualOffsetTop=100000`）。

**未改动的文件**：`src/domain/viewport-state.ts`（PoC）、`src/domain/modes.ts`（T005 求值器）、`tests/fixtures/modes/` 全部零改动；`modes-rv-open-pan-close.json` 的期望保持原值。本任务的事件检查 `ev_close_offsets_retained` / `ev_close_pending_retained` 将该行为显式断言为契约，而非默许。

## 3. 改了哪些文件

见 `handoff/T006/changed_files.txt` 与 `sha256.txt`。清单：

- 新增：`src/domain/events.ts`、`oracle/python/events_oracle.py`、`scripts/t006-lib.mjs`、`scripts/test-events.mjs`、`scripts/test-event-order.mjs`、`scripts/oracle-diff-events.mjs`、`tests/fixtures/events/`（27 个 JSON）、`evidence/events/`（4 个 JSON）、`handoff/T006/`。
- 修改：`package.json`（仅 +3 脚本）。
- **未动**：`src/domain/types.ts`、`validate.ts`、`viewport-state.ts`、`modes.ts`、`geometry.ts`（T004 冻结 Schema、T005 求值器与 S0 代码零改动）；`tests/fixtures/s0/`、`evidence/s0/`、`oracle/python/geometry_oracle.py`、`oracle/python/modes_oracle.py` 零改动（`git status` 验证为空）。

## 4. 验收命令逐条输出（原文关键行）

### `npm run typecheck` — exit 0

```text
> viewportshift@0.1.0 typecheck
> tsc --noEmit
```

### `npm run test:events` — exit 0，checks 1301/1301

```text
fixtures: 27, steps checked: 57, event checks: 390, contract checks: 473, pan steps: 20, clamped: 8, OK=22 UNKNOWN=4 INVALID=1
analysisSha256: b76fe8f4f659475a3e69739fdd9cd3bbd686de29f6847c2464ec29dc4c807951
wrote evidence/events/EVENTS_TS.json
wrote evidence/events/CLAMP_EVIDENCE.json (20 clamp rows)

checks passed: 1301, checks failed: 0

Events (TS): PASS
```

抽样行：

```text
T006-rv-open-pan-close-retained: status=OK expected=OK reason=- steps=3 layoutH=844000 visualH=844000 kb={"x":0,"y":844000,"width":390000,"height":0} visible=false scrollY=0 offsetTop=100000 pendingPan={"dx":0,"dy":100000}
T006-rv-open-pan-exact-top: status=OK expected=OK reason=- steps=2 layoutH=844000 visualH=544000 kb={"x":0,"y":544000,"width":390000,"height":300000} visible=true scrollY=0 offsetTop=300000 pendingPan={"dx":0,"dy":300000}
T006-rv-reopen-pan: status=OK expected=OK reason=- steps=5 layoutH=844000 visualH=544000 kb={"x":0,"y":544000,"width":390000,"height":300000} visible=true scrollY=0 offsetTop=300000 pendingPan={"dx":0,"dy":200000}
T006-clock-regression: status=UNKNOWN expected=UNKNOWN reason=event_clock_regression steps=0 states=null
```

### `npm run test:event-order` — exit 0，checks 22/22

```text
checks passed: 22, checks failed: 0

Event order: PASS
```

### `npm run oracle:diff:events` — exit 0，parity 27/27，checks 70/70

```text
events oracle: fixtures=27 statuses={'UNKNOWN': 4, 'OK': 22, 'INVALID': 1} analysisSha256=b76fe8f4f659475a3e69739fdd9cd3bbd686de29f6847c2464ec29dc4c807951 runs=1 uniqueHashes=1
wrote evidence/events/EVENTS_DIFF.json
parity: 27/27, mismatches: 0
ts analysisSha256: b76fe8f4f659475a3e69739fdd9cd3bbd686de29f6847c2464ec29dc4c807951
py analysisSha256: b76fe8f4f659475a3e69739fdd9cd3bbd686de29f6847c2464ec29dc4c807951

checks passed: 70, checks failed: 0

Events oracle diff: PASS
```

全部 27 个 fixture 均为 `parity=true`（逐字段 identical，含 `validationIssues`、逐事件状态、pan/scroll 报告、clampBounds、event/contract 检查名、`clampEvidence`）。

### 回归（全部 exit 0）

| 命令 | 结果 |
|---|---|
| `npm run test:schema` | PASS，checks 259/259 |
| `npm run test:validation` | PASS，checks 273/273 |
| `npm run test:modes` | PASS，checks 1159/1159 |
| `npm run oracle:diff:modes` | PASS，checks 98/98，parity 41/41 |
| `npm run s0:state-machine` | PASS，checks 68/68 |
| `npm run s0:geometry` | PASS，checks 627/627 |
| `npm run s0:oracle` | PASS，checks 117/117 |
| `npm run s0:determinism` | PASS，checks 6/6 |
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

即：**48/48 parity、12/12 检出、0 误报、100 次运行 1 个哈希**，与 T005 提交时的门禁哈希完全一致（`gateSha256 65b4b32f…`、`analysisSha256 a7584d47…` 未变），无回归。`evidence/s0/` 文件重跑后字节一致，`git status` 无修改。

## 5. 开发中发现并修复的一个问题（已修复，有回归覆盖）

**时钟倒退 fixture 的期望层级错误**：初版 `events-clock-regression.json` 按“重放中途 UNKNOWN”（带失败步与失败前状态）写期望，但 T004 验证器在重放前就已拦截时钟倒退（`event_clock_regression` 是验证层 UNKNOWN），`evaluateEvents` 返回验证层 fail-closed 形（steps []、states null）——与 T005 的 `modes-clock-regression.json` 行为一致。修复：fixture 期望改为验证层 fail-closed 形；同时 `test:event-order` 增加两级覆盖——`evaluateEvents` 层断言验证器先拦截，`evaluateScenarioEvents` 直接调用层断言重放本身也会在倒退事件处停止并保留倒退前状态。`test:events` 保留了中途失败分支的断言（防御性，未被当前 fixture 触发）。

Fixture 终态手核：27 个 fixture 的终态与报告已逐项对照手工计算——精确命中上界（300000，不夹紧）、超限夹紧（400000→300000）、负向夹紧（−50000→0）、dx 全夹紧（`dx clamped to [0, 0]`）、rc/oc/零键盘 maxTop=0、close 保留偏移 100000、重开后 pan 恰好 300000、scroll 下→上精确回 0、等时间戳保序——均一致。

## 6. 夹紧证据（逐项 requested/applied 对照）

完整 20 行见 `evidence/events/CLAMP_EVIDENCE.json`。要点：

| 场景 | 请求 (dx, dy) | 应用 (dx, dy) | 界 (maxLeft, maxTop) | 夹紧 |
|---|---|---|---|---|
| rv-open-pan-exact-top | (0, 300000) | (0, 300000) | (0, 300000) | 否（恰好命中上界） |
| rv-open-pan-over-top | (0, 400000) | (0, 300000) | (0, 300000) | 是 `dy clamped to [0, 300000]` |
| rv-open-pan-negative | (0, −50000) | (0, 0) | (0, 300000) | 是 `dy clamped to [0, 300000]` |
| rv-open-pan-down-up-exact | (0, 100000) / (0, −100000) | 全部应用 | (0, 300000) | 否 / 否（恰好回 0） |
| rv-open-pan-dx-clamped | (50000, 0) | (0, 0) | (0, 300000) | 是 `dx clamped to [0, 0]` |
| rv-open-pan-dx-zero-exact | (0, 50000) | (0, 50000) | (0, 300000) | 否 |
| rc-open-pan-no-room | (0, 100000) | (0, 0) | (0, 0) | 是 `dy clamped to [0, 0]` |
| oc-open-pan-no-room | (0, 100000) | (0, 0) | (0, 0) | 是 `dy clamped to [0, 0]` |
| rv-open-zero-kb-pan | (0, 100000) | (0, 0) | (0, 0) | 是 `dy clamped to [0, 0]` |
| rv-pan-at-limit | (0, 500000) | (0, 300000) | (0, 300000) | 是（500000 = maxPanMilli，允许但夹紧） |
| rv-reopen-pan（第 4 步） | (0, 200000) | (0, 200000) | (0, 300000) | 否（自保留偏移 100000 恰好命中 300000） |
| 其余 9 行 | 全部应用 | 与请求一致 | (0, 300000) | 否 |

8 个夹紧步、12 个未夹紧步；上/下界恰好命中与超限均有 fixture 覆盖。

## 7. 测试总数与通过数

- `test:events`：1301 个检查，1301 通过，0 失败（27 fixtures / 57 步 / 390 个事件检查 / 473 个契约检查；22 OK / 4 UNKNOWN / 1 INVALID；20 个 pan 步，8 个夹紧）。
- `test:event-order`：22 个检查，22 通过，0 失败（等时间戳保序、时钟单调、倒退两级 fail-closed、顺序改变轨迹、两次运行逐字节一致）。
- `oracle:diff:events`：70 个检查，70 通过，0 失败（27/27 parity，0 mismatch；TS 与 Python 分析哈希相同：`b76fe8f4…07951`）。
- 回归：`test:schema` 259/259、`test:validation` 273/273、`test:modes` 1159/1159、`oracle:diff:modes` 98/98、`s0:gate` 120/120。

## 8. 未解决项

**无。**

说明性记录（非未解决项，供 T007 参考）：

- §2 的遗留决策后果：`resizes-visual` 关闭后保留的 `visualOffsetTop` 可能超出关闭后的合法 pan 界；T007 几何计算（`bottomGap` 等）从状态原样取数时应注意该状态是合法的模型状态（非夹紧违规），不得将其“修正”为 0。
- `evaluateScenarioEvents` 直接调用时绕过验证：时钟倒退等验证层拦截项在该层表现为重放中途 UNKNOWN；`evaluateEvents`（验证优先）是唯一公开的完整入口，下游应使用它。
- `events_oracle.py` 的 `canonical_json` 对 float 的处理继承自 `modes_oracle.py`（T005 修复），只在已出现的常规值上与 TS 一致；极端 float 表示在 events fixtures 中不存在，未作额外断言。
- fixture 生成脚本为一次性工具，位于 `/tmp/gen_events_fixtures.py`（未入版本库）；fixtures 本身已入 `tests/fixtures/events/`，期望值已逐项手核。
