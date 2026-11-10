# T002 — 三模式视口状态机 PoC TASK_REPORT

- **项目：** P021 ViewportShift（`viewportshift`）
- **任务：** T002（S0，三模式视口状态机 PoC）。只做 T002，未碰 T003–T014 的业务内容。
- **输入：** T001 骨架、项目书 §4.1–§4.3、实施计划 §0–§5；规格文件仅读取，未修改。
- **结论：** T002 通过。`npm run s0:state-machine` 退出码 0（8 个 PoC 文件、9 个 case、68 项检查全部通过，两次运行输出一致）；`npm run typecheck` 退出码 0。

## 做了什么

1. 通读项目书 §4.1–§4.3（坐标系、视口状态机、事件字母表）与实施计划 §0–§5 的 T002 任务卡，再动手。
2. 新建 `src/domain/viewport-state.ts`：确定性纯函数状态机（`initialState` / `transition` / `replay` / `canonicalStateJson`）。
   - 定点整数：1 单位 = 1/1000 CSS px；全部判定为整数比较；无浮点比较、无 `parseFloat` / `Number.EPSILON` / `toFixed`。
   - 状态字段按项目书 §4.2 全量：layoutWidth/Height、visualOffsetLeft/Top、visualWidth/Height、keyboardRect、keyboardVisible、scrollX/Y、mode、pendingPan、eventClock。
   - 三模式契约：resizes-visual 只缩视觉视口；resizes-content 缩布局视口、视觉视口跟随；overlays-content 尺寸不动、仅键盘矩形遮挡。
   - 事件：KEYBOARD_OPEN、KEYBOARD_CLOSE、SCROLL、DELAYED_VISUAL_PAN、VIEWPORT_SETTLED；`atMs` 单调不减，相同时间戳按 fixture 数组顺序；SCROLL 只改 scrollX/Y、不动视觉偏移；DELAYED_VISUAL_PAN 夹紧到合法范围并报告 requested/applied 与 clamp 原因；VIEWPORT_SETTLED 清零 pendingPan。
   - scale 固定为 1，非 1 返回 UNKNOWN；`atMs` 倒退、键盘高度越界、未知事件类型均返回 UNKNOWN 且状态保持不变（fail-closed）；重放停在首个 UNKNOWN 事件。
   - 无 wall clock / timer 依赖：不含 `Date.now` / `setTimeout` / `setInterval` / `setImmediate` / `Math.random` / `randomUUID` / `new Date(` / `performance.now`。
3. 新建 8 个 PoC fixture（`tests/fixtures/s0/state-machine-poc-01.json` … `-08.json`，共 9 个 case）：三种模式 × 键盘开/关全覆盖，含 1 个 DELAYED_VISUAL_PAN 夹紧案例（POC-07：requested (500000, 400000) → applied (0, 300000)）与 1 个 UNKNOWN 案例（POC-08：scale=2 与时钟倒退两个子 case）。
4. 新建验收脚本 `scripts/s0-state-machine.mjs`：用项目自带 TypeScript devDependency 转译 domain 模块后真实导入，加载 8 个 fixture、每 case 重放 2 次并比对规范化状态 JSON（确定性），逐字段断言终态（13 字段）、status、reason、failedEventId、pan 报告，另做三模式横向差异断言与 domain 源码禁令扫描；全部通过才 exit 0，无空脚本/固定 exit 0。
5. `package.json` 仅新增 `s0:state-machine` 脚本；无依赖变化，`package-lock.json` 未改。
6. 写 `evidence/s0/T002_REPORT.md`：含三模式契约表、7 条已冻结建模选择（供 T003 Oracle 对照）、8 个 PoC 清单与断言结果、验收命令逐条输出原文。
7. 施工中发现并修复一个验收脚本自身缺陷：第一版用 `JSON.stringify` 直接比较嵌套对象，键顺序不同导致 10 项误报 FAIL（值全部正确，实现代码未动）；改为键排序规范化比较后通过。首次失败输出仅在终端回显，未落盘日志，见证据报告 §5 如实记录。

## 验收命令逐条输出原文

完整日志见 `handoff/T002/test_logs/`。逐条结果如下：

### 1. `npm run s0:state-machine` — 退出码 0（两次运行输出完全一致）

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

### 2. `npm run typecheck` — 退出码 0

```text
> viewportshift@0.1.0 typecheck
> tsc --noEmit
EXIT_CODE=0
```

### 额外验证（非验收清单，仅作诚实核查）

- 禁令 grep：`Date.now|setTimeout|setInterval|setImmediate|Math.random|randomUUID|new Date\(|performance.now` 与 `parseFloat|Number.EPSILON|toFixed` 在 domain 代码中均为 0 命中。
- 输入不可变性：深冻结的初始状态 + 事件数组重放后，初始状态规范化 JSON 不变（`initial-unchanged=true`），退出码 0。
- `npm run build`（额外 sanity）：退出码 0，构建成功（1.50s）。
- 规格与 Oracle 未修改：规格文件 T002 仅读取；T001 的 `sha256.txt` 未收录规格文件（既有文件、非 T001 产物），故无 T001 基线可比对，此处如实说明。Oracle `oracle/python/geometry_oracle.py` SHA-256 与 T001 记录完全一致（`3717a4cc…`），未修改。

## 8 个 PoC 清单及断言结果

| PoC | 模式 | 关键断言 |
| --- | --- | --- |
| POC-01-RV-OPEN | resizes-visual | OPEN 后布局 844000 不变、视觉 544000，13 字段全匹配 |
| POC-02-RC-OPEN | resizes-content | OPEN 后布局 544000、视觉 544000、键盘矩形 y=544000，13 字段全匹配 |
| POC-03-OC-OPEN | overlays-content | OPEN 后布局/视觉均 844000 不动、仅键盘矩形出现，13 字段全匹配 |
| POC-04-RV-OPEN-CLOSE | resizes-visual | CLOSE 后视觉视口精确恢复 844000 |
| POC-05-RC-OPEN-CLOSE | resizes-content | CLOSE 后布局视口精确恢复 844000 |
| POC-06-OC-OPEN-SCROLL-CLOSE-SETTLED | overlays-content | scrollY=100000，视觉偏移恒为 0，键盘已关 |
| POC-07-RV-OPEN-PAN-CLAMP-SETTLED | resizes-visual | 夹紧：requested (500000, 400000) → applied (0, 300000)，`clampReason="dx clamped to [0, 0]; dy clamped to [0, 300000]"`，settled 后 pendingPan 归零 |
| POC-08-UNKNOWN | resizes-visual | scale=2 → `unsupported_scale`，状态保持初始态；时钟倒退 → `event_clock_regression`，停在 e2 |

## 文件清单及 SHA-256

见 `changed_files.txt` 与 `sha256.txt`。其中：

| 文件 | SHA-256（前 16 位） |
| --- | --- |
| src/domain/viewport-state.ts | `e32b77c02605f255…` |
| scripts/s0-state-machine.mjs | `9bf872831294099f…` |
| tests/fixtures/s0/state-machine-poc-01.json | `c9144d13b184aac0…` |
| tests/fixtures/s0/state-machine-poc-08.json | `f2233e71228c39d7…` |
| package.json | `34a83ac8a9200dcd…` |
| evidence/s0/T002_REPORT.md | `6e2b3b310e19a0e4…` |

完整 16 文件 SHA-256 见 `sha256.txt`。

## 未解决项

见 `unresolved_items.md`：NONE。证据报告 §2.2 的 7 条建模选择是已冻结的 PoC 决定、不是未解决项；T003 实现 Oracle 时须按同一语义对照，若有分歧以任务卡变更处理，不得静默改预期。

## 下一步

T002 完成，可进入 T003（几何 Oracle PoC 与 S0 Gate）。T003 需按本报告 §2.2 的语义实现独立 Python Oracle 并逐字段对照；48 场景门禁仍待 T003 完成。
