# T009-FIX — TASK_REPORT.md

任务：只修 T009 独立审查的唯一 P1（P1-1）。不碰 8 项 P2（已登记留待 T012/T013），不碰 T010–T014，不改冻结文件。未 git commit（由协调员统一提交），未 push，未写 Drive，未对外发消息。

工作目录：`~/workspace/p021-viewportshift/`（T009 未提交的工作树，HEAD `3bbaa1b`）。

## 1. P1-1 是什么

审查方证据：336 组横扫中 96 组命中（键盘 800 > 布局高 400）；真实渲染 `?keyboardHeight=800&layoutHeight=400` 的 DOM 含 1 处“计算中…”、0 个 timeline-step-* 按钮，同时含 UNKNOWN 与 `keyboard_height_out_of_range`。

根因（协调员已亲自读码核实）：`src/ui/App.tsx` 约 396 行

```tsx
{result === null || row === null || row.state === null ? (<p>计算中…</p>) : ...}
```

把“尚未计算”（`result === null`）与“已算完但无行”（fail-closed 的 UNKNOWN/INVALID，`initialState === null`、`steps === []`、`rows === []`）混为一谈。顶栏 UNKNOWN 文字标签与见证面板原因说明本来就是正确的，故不是假 PASS，但中央区对一个已完成的评估谎称“仍在计算”，且时间轴只留空表、选中时刻区静默消失。

## 2. 复现（修复前行为已用探针确认）

用 UI 场景构造器建键盘 800 / 布局 400 场景（`DEFAULT_UI_PARAMS` + `keyboardHeightCssPx: 800, layoutHeightCssPx: 400`）：

- `evaluation.status === "UNKNOWN"`，`reason === "keyboard_height_out_of_range"`
- `initialState === null`，`steps.length === 0`
- `deriveAnalysisStatus === "UNKNOWN"`，标签 `UNKNOWN（未知）`
- `timelineRows(...).length === 0`，`selectedRow(rows, -1) === null`
- BFS 同样 fail-closed：`status === "UNKNOWN"`，`reason === "keyboard_height_out_of_range"`

即 domain 层早已正确 fail-closed，只有 UI 渲染层把“无行”误报为“计算中”。

## 3. 修了什么（仅 3 个文件）

### `src/ui/App.tsx`

- 新增 `FailClosedNotice({ status, reason })`：渲染状态文字标签（`statusLabel(status)`）+ 原因码（`（原因：keyboard_height_out_of_range）`）+ 一句“评估已完成，该场景超出模型范围，无法绘制视口剖面。”（`data-testid="fail-closed-notice"`）。
- SVG 剖面区：`result === null` 才显示“计算中…”；`result` 已存在但 `row === null || row.state === null` 时显示 `FailClosedNotice`；否则渲染 `ViewportSvg`。原合并条件 `result === null || row === null || row.state === null` 已删除。
- 时间轴调用：向 `Timeline` 传入 `failClosedStatusLabel` 与 `failClosedReason`（取自 `result.analysisStatus` / `result.evaluation.reason`）。
- 选中时刻区：`result !== null && (row === null || row.state === null)` 时渲染带“选中时刻”标题的 `FailClosedNotice`，不再静默消失；`result === null` 时仍为空（真正尚未算出）；有行时保持原有详情不变。
- 未加任何跨字段限制：键盘高度仍可独立调到 800、布局高度仍可独立调到 400，fail-closed 路径保持可观测。

### `src/render/timeline.tsx`

- `TimelineProps` 新增可选 `failClosedStatusLabel` / `failClosedReason`。
- `rows.length === 0` 时不再渲染空表，改为渲染空状态文字（`data-testid="timeline-empty-state"`）：“评估已完成：因 fail-closed（UNKNOWN（未知），原因：keyboard_height_out_of_range），无重放步骤，时间轴为空。”有行时渲染逻辑完全不变。

### `scripts/test-ui.mjs`

- 第 9 节真实渲染冒烟内新增 fail-closed 渲染冒烟：`vite preview` + 缓存的 chromium headless shell，`?keyboardHeight=800&layoutHeight=400`，断言 DOM 含 `UNKNOWN`、`keyboard_height_out_of_range`、fail-closed 说明句、“评估已完成”、“无重放步骤”、“时间轴为空”；断言 0 处“计算中…”、0 个 `timeline-step-*` 按钮、`fail-closed-notice` 出现 2 次（剖面区 + 选中时刻区）。
- 新增第 10 节（P1-1 逻辑 + 渲染逻辑断言）：用 UI 场景构造器建键盘 800 / 布局 400 场景，断言状态 UNKNOWN、原因码 `keyboard_height_out_of_range`、无初始状态且无步骤、时间轴 0 行、选中行 null；断言源码中 P1-1 缺陷模式 `result === null || row === null || row.state === null` 已消失、fail-closed 说明句与原因码引用存在、`FailClosedNotice` 在两处渲染、timeline 空状态文字存在。
- 头部注释同步更新。

## 4. 未改动（核查）

- 未碰 `src/domain/*`、`oracle/*`、`tests/fixtures/s0/*`、`evidence/s0/*`、S0/S1/S2 scripts、其余 UI 文件（`src/ui/scenario.ts`、`WitnessPanel.tsx`、`styles.css`、`src/App.tsx`）、P2 相关项。
- `git status` 显示除 T009 原有未提交内容外，无计划外改动；`evidence/s0/S0_GATE.json` 经 `s0:gate` 重跑后内容未变（未出现在改动列表中）。

## 5. 验收（四条命令全部 exit 0）

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | exit 0（`tsc --noEmit` 无输出） |
| `npm run build` | exit 0（vite build，42 modules，`dist/assets/index-Bt6u45t-.js` 284.83 kB） |
| `npm run test:ui` | exit 0，**202 passed, 0 failed**（新增 18 项断言：逻辑 9 + 渲染冒烟 9） |
| `npm run s0:gate` | exit 0，**PASS 120/120**，gate 哈希 `65b4b32f4a5298642fd3de5a64441ed7d214e2519d118b8b67a7871ba73aca26`（与冻结值 `65b4b32f…` 一致，未变）；53/53 parity、12/12 planted、0 false positives、100 runs / 1 hash |

完整日志见 `test_logs/`（四条命令逐项）。

## 6. 修复后独立验证（test:ui 之外另做一次）

另起 `vite preview`（4174 端口）+ 缓存 headless shell，对 `?keyboardHeight=800&layoutHeight=400` 做独立 DOM 计数：

- “计算中…”：**0**
- `UNKNOWN`：9 处
- `keyboard_height_out_of_range`：5 处
- “评估已完成，该场景超出模型范围，无法绘制视口剖面”：**2 处**（剖面区 + 选中时刻区）
- “无重放步骤”：1 处；“时间轴为空”：1 处
- `fail-closed-notice`：2 处；`timeline-step-*`：**0**

验证后 preview 进程已清理，无残留 vite 进程。

## 7. 文件清单

- 改动文件：`src/ui/App.tsx`、`src/render/timeline.tsx`、`scripts/test-ui.mjs`（见 `changed_files.txt`，逐项 SHA-256 见 `sha256.txt`，仓库根目录可验）
- 交接包：`handoff/T009-FIX/`（本报告、`changed_files.txt`、`test_commands.txt`、`test_logs/`、`sha256.txt`、`unresolved_items.md`）
