# P021 ViewportShift — T002 状态机 PoC 报告

- **任务：** T002 三模式视口状态机 PoC（S0，实施计划 §5）
- **结论：** T002 通过。`npm run s0:state-machine` 退出码 0（8 个 PoC 文件、9 个 case、68 项检查全部通过）；`npm run typecheck` 退出码 0。
- **输入：** T001 骨架、项目书 §4.1–§4.3、实施计划 §0–§5。
- **不做：** 无 UI、无真实浏览器接入；Oracle 仍为 T001 空桩，未修改（SHA-256 与 T001 记录一致）。

## 1. 交付物

| 文件 | 说明 |
| --- | --- |
| `src/domain/viewport-state.ts` | 确定性视口状态机：纯函数 `transition` / `replay` / `initialState` / `canonicalStateJson` |
| `tests/fixtures/s0/state-machine-poc-01.json` … `state-machine-poc-08.json` | 8 个 PoC fixture（9 个 case，见 §3） |
| `scripts/s0-state-machine.mjs` | 验收脚本：真实加载 fixture、真实重放、逐字段断言 |
| `package.json` | 新增 `s0:state-machine` 脚本（其余脚本未变） |
| `evidence/s0/T002_REPORT.md` | 本报告 |

## 2. 实现契约（项目书 §4.1–§4.3）

- **单位：** 定点整数，1 单位 = 1/1000 CSS px（例：390 CSS px = 390000）。所有判定比较均为整数比较；domain 代码中无浮点比较、无 `parseFloat` / `Number.EPSILON` / `toFixed`（grep 验证，见 §5）。
- **状态字段（§4.2 全量）：** `layoutWidth/Height`、`visualOffsetLeft/Top`、`visualWidth/Height`、`keyboardRect`、`keyboardVisible`、`scrollX/Y`、`mode`、`pendingPan`、`eventClock`。
- **转移：** 纯函数 `nextState = transition(currentState, event, mode, profile)`；`replay` 按 fixture 数组顺序处理事件，`atMs` 单调不减（相等时间戳保持数组顺序）；输入对象永不突变（深冻结输入重放验证通过，`initial-unchanged=true`）。
- **scale 固定为 1：** 非 1 返回 UNKNOWN（`unsupported_scale`），不静默 reinterpret。
- **无 wall clock / timer 依赖：** domain 代码不含 `Date.now` / `setTimeout` / `setInterval` / `setImmediate` / `Math.random` / `randomUUID` / `new Date(` / `performance.now`（验收脚本静态扫描 + 独立 grep 双重验证）。

### 2.1 三模式契约（键盘高度 h，全高 H = 844000）

| 模式 | KEYBOARD_OPEN（h = 300000） | KEYBOARD_CLOSE |
| --- | --- | --- |
| `resizes-visual` | 布局不变 390000×844000；视觉视口 390000×544000；键盘矩形 `{x:0, y:544000, w:390000, h:300000}` | 视觉视口精确恢复 390000×844000 |
| `resizes-content` | 布局视口缩为 390000×544000；视觉视口跟随布局视口（390000×544000，偏移归零）；键盘矩形位于新布局视口正下方（`y:544000`） | 布局视口精确恢复 390000×844000 |
| `overlays-content` | 布局与视觉视口尺寸均不动（390000×844000）；仅出现键盘矩形 `{x:0, y:544000, w:390000, h:300000}` | 尺寸不动，键盘矩形消失 |

### 2.2 已冻结的建模选择（供 T003 Oracle 对照时复核）

以下几点项目书未逐字规定，本 PoC 按最保守的字面解读冻结，并在代码注释中标明；若 T003 认为应改，需在 S0 Gate 前以任务卡变更、不得静默改预期：

1. **SCROLL 只改 `scrollX/Y`，不动视觉视口偏移**（项目书 §4.1：滚动偏移是独立状态字段，不得与 VV offset 混为一谈）。滚动下限夹紧到 0；无内容高度建模，故无上限。
2. **`pendingPan` = 最近一次 `DELAYED_VISUAL_PAN` 的 applied 位移**，直至 `VIEWPORT_SETTLED` 清零。延迟平移不改变 mode 标识（不是第四种模式）。
3. **键盘关闭/初始状态的 `keyboardRect`**：零高度矩形，位于布局视口底边（`{x:0, y:layoutHeight, w:layoutWidth, h:0}`），`keyboardVisible=false`。关闭时键盘的屏幕几何仍有记录，遮挡判定由 T003 几何按模式语义决定。
4. **重复 KEYBOARD_OPEN**：按高度差量（delta）调整，已打开时再次打开替换键盘高度而非叠加；`resizes-content` 下的全高按 `layoutHeight + 当前键盘高度` 还原后校验 `h` 的范围。
5. **键盘高度越界**（`< 0` 或 `> 全高`）返回 UNKNOWN（`keyboard_height_out_of_range`）；`atMs` 倒退返回 UNKNOWN（`event_clock_regression`），重放停在首个 UNKNOWN 事件并返回该事件前的状态；未知事件类型返回 UNKNOWN。
6. **DELAYED_VISUAL_PAN 夹紧**：偏移夹紧到 `[0, layout-visual]`；报告 `requested/applied` 与 `clampReason`（格式：`dx clamped to [0, <maxLeft>]; dy clamped to [0, <maxTop>]`，仅列被夹紧的轴）。
7. **已关闭时再 KEYBOARD_CLOSE**：幂等，仅推进 `eventClock`。

## 3. 8 个 PoC 清单（全部通过）

初始布局均为 390000×844000（390×844 CSS px）；键盘高度 300000（300 CSS px）。

| PoC | 模式 | 事件序列 | 断言结果 |
| --- | --- | --- | --- |
| POC-01-RV-OPEN | resizes-visual | OPEN@100 | 终态 13 字段全匹配：布局 844000 不变，视觉 544000，键盘可见 |
| POC-02-RC-OPEN | resizes-content | OPEN@100 | 终态 13 字段全匹配：布局 544000，视觉 544000，键盘矩形 y=544000 |
| POC-03-OC-OPEN | overlays-content | OPEN@100 | 终态 13 字段全匹配：布局/视觉均 844000 不动，仅键盘矩形出现 |
| POC-04-RV-OPEN-CLOSE | resizes-visual | OPEN@100, CLOSE@200 | 终态 13 字段全匹配：视觉视口精确恢复 844000 |
| POC-05-RC-OPEN-CLOSE | resizes-content | OPEN@100, CLOSE@200 | 终态 13 字段全匹配：布局视口精确恢复 844000 |
| POC-06-OC-OPEN-SCROLL-CLOSE-SETTLED | overlays-content | OPEN@100, SCROLL@150 (dy=100000), CLOSE@200, SETTLED@250 | 终态 13 字段全匹配：`scrollY=100000`，视觉偏移恒为 0，键盘已关 |
| POC-07-RV-OPEN-PAN-CLAMP-SETTLED | resizes-visual | OPEN@100, PAN@200 (dx=500000, dy=400000), SETTLED@300 | **夹紧案例**：requested (500000, 400000) → applied (0, 300000)，`clamped=true`，`clampReason="dx clamped to [0, 0]; dy clamped to [0, 300000]"`；settled 后 `pendingPan` 归零，视觉偏移 (0, 300000) |
| POC-08-UNKNOWN | resizes-visual | case A：scale=2 下 OPEN@100；case B：OPEN@200 后 SCROLL@100（时钟倒退） | **UNKNOWN 案例**：case A `unsupported_scale`，状态保持初始态；case B `event_clock_regression`，重放停在 e2，终态为 OPEN 后的状态；均 fail-closed，未改状态 |

每个 case 均重放 2 次，规范化状态 JSON 完全一致（确定性）；每 case 断言：status、reason、failedEventId、全部 13 个终态字段、pan 报告；另有 4 项三模式横向差异断言（§2.1 的三行数值 + 三模式键盘矩形相同）。总计 68 项检查，0 失败。

## 4. 验收命令逐条输出原文

完整日志见 `handoff/T002/test_logs/`。

### `npm run typecheck` — 退出码 0

```text
> viewportshift@0.1.0 typecheck
> tsc --noEmit
EXIT_CODE=0
```

### `npm run s0:state-machine` — 退出码 0（两次运行输出完全一致）

```text
> viewportshift@0.1.0 s0:state-machine
> node scripts/s0-state-machine.mjs

POC-01-RV-OPEN/open-300: status=OK fields=all-match determinism=identical
POC-02-RC-OPEN/open-300: status=OK fields=all-match determinism=identical
POC-03-OC-OPEN/open-300: status=OK fields=all-match determinism=identical
POC-04-RV-OPEN-CLOSE/open-300-close: status=OK fields=all-match determinism=identical
POC-05-RC-OPEN-CLOSE/open-300-close: status=OK fields=all-match determinism=identical
POC-06-OC-OPEN-SCROLL-CLOSE-SETTLED/open-scroll-close-settled: status=OK fields=all-match determinism=identical
POC-07-RV-OPEN-PAN-CLAMP-SETTLED/open-pan-clamp-settled: status=OK fields=all-match determinism=identical
POC-08-UNKNOWN/unsupported-scale-2: status=UNKNOWN fields=all-match determinism=identical
POC-08-UNKNOWN/event-clock-regression: status=UNKNOWN fields=all-match determinism=identical

PoC fixtures: 8, cases: 9, checks passed: 68, checks failed: 0

S0 state-machine: PASS
EXIT_CODE=0
```

## 5. 额外验证（非验收清单，仅作诚实核查）

- **首次运行曾 FAIL（已修复，属实记录）：** 第一版验收脚本用 `JSON.stringify` 直接比较嵌套对象，键顺序不同导致 10 项“字段不匹配”误报（值全部正确，状态机实现本身无错）。修复为键排序的规范化比较后通过；实现代码未动。首次失败输出仅出现在终端回显中，未落盘为日志文件（当时尚未开始 tee 记录），此处如实记录、不虚构日志。
- **禁令 grep（独立复核）：** `grep -nE "Date\.now|setTimeout|setInterval|setImmediate|Math\.random|randomUUID|new Date\(|performance\.now" src/domain/viewport-state.ts` 无匹配（exit 1，即 0 命中）；`parseFloat|Number.EPSILON|toFixed` 同样 0 命中。
- **输入不可变性：** 深冻结的初始状态 + 事件数组重放后，初始状态规范化 JSON 保持不变（`initial-unchanged=true`），退出码 0。
- **`npm run build`（额外 sanity）：** 退出码 0，`dist/` 构建成功（1.50s）。
- **规格与 Oracle 未修改：** `P021_PROJECT_BOOK.md` / `P021_IMPLEMENTATION_PLAN.md` 在 T002 中仅读取，未写入；T001 的 `sha256.txt` 未收录规格文件（规格为既有文件、非 T001 产物），故无 T001 基线可比对，此处如实说明而非虚构比对通过。Oracle `oracle/python/geometry_oracle.py` SHA-256 `3717a4cc…` 与 T001 记录完全一致，未修改。

## 6. 未解决项

无（见 `handoff/T002/unresolved_items.md`：NONE）。§2.2 的 7 条建模选择是已冻结的 PoC 决定、不是未解决项；T003 实现 Oracle 时须按同一语义对照，若有分歧以任务卡变更处理。

## 7. 下一步

T002 完成，可进入 T003（几何 Oracle PoC 与 S0 Gate）。T003 需用本报告 §2.2 的语义实现独立 Python Oracle 并逐字段对照；48 场景门禁仍待 T003 完成。
