# P021 T012 — 独立评审报告

- **评审员：** 独立评审会话（与施工方不同会话；不采信施工方自述，所有数字亲自重跑）
- **评审对象：** P021 ViewportShift S4 T012（E2E/离线/性能/发布预演）
- **工作目录：** `~/workspace/p021-viewportshift/`；基线 HEAD `2bdbc93`（T011 已提交）
- **评审时间：** 2026-11-10 ~10:49–11:05 GMT
- **评审方法：** 通读 `handoff/T012/TASK_REPORT.md`、`changed_files.txt`、`unresolved_items.md`、`sha256.txt` 及全部证据 JSON；亲自重跑 7 条 T012 验收命令 + `npm test` + `s0:gate` + `typecheck` + `demo`；通读 7 个新脚本全文；独立探针验证 Tab 遍历与热区几何；目视 3 张截图；`git status/diff` 核对改动范围；`sha256sum -c` 核对交接哈希
- **最终结论：** ✅ **FINAL_VERDICT: PASS — 建议合并**（P0 0 / P1 0 / P2 4；P2 登记 T013，不阻塞合并）

---

## 1. 验收命令重跑结果（评审员亲自重跑，全部 exit 0）

| # | 命令 | 施工方自述 | 评审员重跑 | 一致 |
|---|---|---|---|---|
| 1 | `npm run test:e2e` | 55/55，exit 0 | **55 passed, 0 failed，exit 0**（耗时 ~9s；`export via real-blob-download; Tab traversal 17 stops`；外部请求 0） | ✅ |
| 2 | `npm run test:offline` | 26/26，exit 0 | **26 passed, 0 failed，exit 0**（耗时 ~5s；三腿 0 外部请求） | ✅ |
| 3 | `npm run test:performance` | 11/11，exit 0 | **11 passed, 0 failed，exit 0**（耗时 ~12s；实测中位数见 §4） | ✅ |
| 4 | `npm run test:perf` | 11 checks 全绿 | **PASS，11 checks，exit 0**（耗时 ~13s；内含一次真实 `test:performance` 重跑） | ✅ |
| 5 | `npm run test:stress` | 15/15，exit 0 | **15 passed, 0 failed，exit 0**（耗时 ~18s；两次干净重建哈希一致、demo ×5、重放 ×100 单哈希） | ✅ |
| 6 | `npm run build` | exit 0 | **exit 0**（耗时 ~7s；13 modules，`dist/viewportshift.mjs 75.94 kB`） | ✅ |
| 7 | `npm run release:verify` | 15/15，exit 0 | **15 passed, 0 failed，exit 0**（耗时 ~15s；两次预演构建哈希一致；`release/` 未创建） | ✅ |

补充：评审员重跑日志存于 `/tmp/review-t012/01-e2e.log` ~ `07-release.log`（临时目录，不进仓库）；关键行与施工方 `handoff/T012/test_logs/01–06` 的计数逐行一致。

**证据确定性：** 评审员重跑后，`evidence/e2e/E2E_TEST.json`、`evidence/offline/OFFLINE_TEST.json`、`evidence/performance/STRESS_TEST.json`、`evidence/release-rehearsal/RELEASE_REHEARSAL.json` 与施工方版本 **逐字节相同**（`diff` 无输出）；截图哈希亦相同。唯一变化的是性能实测值（见 §4），属设计内行为。

---

## 2. 回归数字对照表（全部保持）

| 套件 | 基线要求 | 评审员重跑 | 结论 |
|---|---|---|---|
| test:schema | 259/259 | 259 passed, 0 failed | ✅ |
| test:validation | 273/273 | 273 passed, 0 failed | ✅ |
| test:modes | 1159/1159 | 1159 passed, 0 failed | ✅ |
| test:events | 1301/1301 | 1301 passed, 0 failed | ✅ |
| test:event-order | 22/22 | 22 passed, 0 failed | ✅ |
| test:geometry | 629/629 | 629 passed, 0 failed | ✅ |
| test:bfs | 277/277 | 277 passed, 0 failed | ✅ |
| test:bfs:determinism | 4/4 | 4 passed, 0 failed | ✅ |
| test:ui | 202/202 | 202 passed, 0 failed | ✅ |
| test:export | 136/136 | 136/136 | ✅ |
| test:golden | 107/107 | 107 passed, 0 failed | ✅ |
| test:property | 709/709 | 709 passed, 0 failed | ✅ |
| test:mutation | 31/31 | 31 passed, 0 failed（8 mutants 全检出） | ✅ |
| oracle:diff:modes | 98/98 | 98 passed, 0 failed | ✅ |
| oracle:diff:events | 70/70 | 70 passed, 0 failed | ✅ |
| oracle:diff:geometry | 86/86 | 86 passed, 0 failed | ✅ |
| oracle:diff:coverage | 165/165 | parity 165/165 (100%) | ✅ |
| `npm test` 总 | 全绿 exit 0 | **exit 0，全绿**；`checks passed` 序列与施工方 `11-npm-test.log` 的 md5 完全相同 | ✅ |
| `npm run s0:gate` | 120/120，gateSha256 `65b4b32f…` | **120/120 PASS**（53/53 parity、12/12 植入、0 误报、100 次 1 哈希）；`evidence/s0/S0_GATE.json` 的 gateSha256 = `65b4b32f4a5298642fd3de5a64441ed7d214e2519d118b8b67a7871ba73aca26`，不变 | ✅ |
| `npm run typecheck` | exit 0 | exit 0 | ✅ |
| `node dist/viewportshift.mjs demo` | resultSha256 `88f2153a…` / reportSha256 `f329e814…` / 见证长 1 | resultSha256=`88f2153afd19cd19659d48587b7a98286621fff7ca9ae37cec0de6a4e50f6b60`、reportSha256=`f329e8144a234eb46e6eea71dc04fc222e63dec44f3f66192b6c0bf0128d90b8`、witnessLength=1 | ✅ |

`npm test` 日志中 3 处含 `FAIL` 字样的行均为良性（夹具状态标签 `FAIL=5`、断言文本 `PASS result: demo replay status is FAIL`、`PASS report: contains FAIL`），无真实失败。

---

## 3. 改动范围核对（git）

- `git log`：HEAD 仍为 `2bdbc93`（T011），评审未提交、施工方未提交。
- `git status`：唯一已跟踪修改是 `package.json`（+6 脚本名，见下）；其余全部为新增未跟踪文件。
- `git diff package.json`：仅 scripts 段 +6 行（`test:e2e`、`test:offline`、`test:performance`、`test:perf`、`test:stress`、`release:verify`），**依赖一字未动**，与施工方自述一致。
- `git diff --stat`：`package.json | 8 +++++++-`，仅此一文件。
- 新增：7 个脚本（`scripts/e2e-lib.mjs`、`test-e2e.mjs`、`test-offline.mjs`、`test-performance.mjs`、`test-perf.mjs`、`test-stress.mjs`、`release-verify.mjs`）+ 4 组证据 + `handoff/T012/`；共 40 项，与 `changed_files.txt` 一致。
- **`src/`、`oracle/`、S0 fixtures、`evidence/s0/S0_GATE.json` 零改动**（git 无任何相关修改）；上游遗留决策（resizes-visual 下 KEYBOARD_CLOSE 只恢复 visualHeight、不重置 visualOffsetTop）未动，冻结 Oracle 与 modes/events/bfs/UI 行为未动。
- `release/` 未被创建（`ls` 确认不存在），T014 正式冻结包不受影响。

---

## 4. 抽查发现

### 4.1 真实浏览器驱动（非假测试）——通过

- 通读 `scripts/e2e-lib.mjs` 全文：`CdpBrowser` 用 Node 24 内置 WebSocket 直连 Chromium DevTools 协议，`Input.dispatchMouseEvent`（真鼠标点击）、`Input.dispatchKeyEvent`（真键盘）、`Page.captureScreenshot`、`Page.setDownloadBehavior`、`Network` 请求记录、`Network.emulateNetworkConditions` 离线模拟；`makeHarness` 的 `check()` 真计数，`summary()` 在有失败时返回 false，脚本据此置 `process.exitCode = 1`。**无硬编码通过、无固定 exit 0。**
- `findChrome()` 定位的二进制为 Playwright 缓存 `chromium_headless_shell-1254`；评审员核实：`import("playwright")` 在仓库内解析失败（驱动包确实未安装），`package.json` 无 playwright 依赖，`~/.cache/ms-playwright/` 含 chromium 1248/1254 与 headless shell；`test:e2e` 脚本内亦有断言 `playwrightInstalled === false`。CDP 直驱同一份缓存 Chromium（`HeadlessChrome/158.0.8127.18`）的说法属实，禁令（不许新增依赖）下是合理 fallback，且覆盖面（点击/按键/下载/拦截/离线）不缩水。
- 评审员重跑的 `E2E_TEST.json`：`browser: HeadlessChrome/158.0.8127.18`，`totalRequests: 6`（页面 + JS + CSS 各 2 次，系 Tab 遍历段重新导航所致），**`externalRequests: 0`**，`externalUrls: []`。与施工方记录逐字节相同。

### 4.2 T009 三项补做——全部真实完成

| 项 | 核查结果 |
|---|---|
| ① 点击后键盘可见截图 | ✅ 真鼠标点击 `timeline-step-0` 后截图。目视 `e2e-keyboard-visible.png`：overlays-content 下键盘灰块（“键盘 300 CSS px 高”）、橙色目标 UI、图例“遮挡热区（红色）…键盘遮挡面积 21840 CSS px²”俱全；场景为 `UI-chat-input-overlays-content`，FAIL，见证长 1。脚本断言 SVG 含 `#475569` 键盘矩形与 `#dc2626` 热区矩形，评审员重跑通过。 |
| ② 导出按钮真实点击 | ✅ `Page.setDownloadBehavior` + 真实鼠标点击导出按钮；评审员重跑 `export.method: real-blob-download`（未走 `blob-capture-hook` 备用分支），`scenarioSha256: e85dbd57…` 与 Node 复算 `expectedScenarioSha256` 一致，`canonicalRoundTrip: true`。 |
| ③ 真实 Tab 遍历 17 stops | ✅ 评审员重跑复现完全相同的焦点链（idx `[0,3,4,5,6,7,10,11,12,13,14,15,16,17,18,19,20]`，17 stops，`wrapped: false`）。独立探针（CDP 直查页面可聚焦元素）确认：该页面在 `sequence=open` 下恰有 **21 个可聚焦元素**；链中跳过的 idx 1、2、8、9 是未选中的同组 radio（Tab 在 radio 组内只停一站，符合标准行为）；链尾 idx 20（`timeline-step-0`）即最后一个可聚焦元素，之后 Tab 使焦点回到 `BODY`（headless shell 无地址栏可接焦点），故循环以 `info === null` 退出、`wrapped: false`——**这是真实的完整遍历，不是提前终止**。ArrowDown 切模式（rv → rc）与 Enter 触发下载的断言亦在重跑中通过。 |

### 4.3 热区几何（4 项修复之 1）——独立复算确认产品正确

- 施工方称 resizes-visual 下热区应无、遮挡面积 0 是正确几何行为。评审员用 `e2e-lib.mjs` 的 `loadUiDomain` 独立加载冻结 domain，对 `chat-input / open-pan-settled` 重放逐模式复算：**resizes-visual 各步骤 `keyboardObscuredArea = 0`；overlays-content 各步骤 `= 21,840,000,000` milli-px² = 21840 CSS px²**，与 E2E 活页断言（rv `0 CSS px²`、oc `21840 CSS px²`）完全一致。
- 源码佐证：`src/domain/geometry.ts` 注释明确定义 `keyboardObscuredArea = |S ∩ V ∩ K|`，rv 下表面在缩小的视觉视口之外计为裁剪（clipped）而非遮挡；`src/render/viewportSvg.tsx:55–63` 仅当 `hotZone !== null`（S∩K∩V 非空）才绘红色热区。21840 = 390 × 56（目标 UI 矩形 `(0,788), 390 × 56`，截图图例亦然）。
- 其余 3 项修复亦逐一核查：② Tab 循环代码确为“直至焦点 wrap 回早期 stop 才停”，无导出按钮处 break；③ `pressKey`/`pressEnter` 确带 `text/unmodifiedText: "\r"`，且重跑中 Enter 真实触发下载；④(a) bundle 内 `fetch(` 经评审员独立 grep 确为**唯一 1 处**，上下文是 Vite modulepreload polyfill（取 `<link rel="modulepreload">` 的 href），URL 字面量恰为 5 个已知标识符（4 个 w3.org 命名空间 + `https://react.dev/errors/`）；④(b) 离线 Leg 2 导出哈希 `f3daec4b…`（overlays-content）与 Leg 3 `a6fa92fc…`（resizes-visual）不同是正确的（模式不同），Leg 3 改为独立复验（重 canonical 化 + 哈希重算 + 场景 id）合理。**4 项修复均未放宽产品断言**，均为测试侧修正。

### 4.4 性能门槛冻结——规则如实执行，见 P2-3

- `evidence/environment/ENVIRONMENT_REPORT.md` 经评审员 grep 确认：`性能门槛|threshold|门槛` 出现 0 次；`test-performance.mjs` 开头亦有同样断言（若报告日后出现门槛则直接失败），本次冻结合法。
- 规则 `threshold = max(2 × 实测中位数, 下限)` 在代码中如实实现（`freeze = (measured, floor) => Math.max(2 * measured, floor)`）；下限与报告一致（构建 120000、demo 10000、preview 启动 10000、页面加载 5000、交互 1000 ms）。
- 两次实测对照（施工方 → 评审员重跑）：构建 7075 → 6444 ms、demo 98 → 94 ms、preview 启动 538 → 558 ms、页面加载 221 → 229 ms、时间轴点击 178 → 162 ms、模式切换 171 → 165 ms、模板切换 164 → 164 ms；**冻结门槛两次完全相同**（120000 / 10000 / 10000 / 5000 / 1000 / 1000 / 1000）。实测值稳定、量级一致，无造假迹象。门槛偏松的问题见 P2-3。

### 4.5 离线三腿——通过

- Leg 1 静态扫描：`dist/index.html` 外部引用 0、`src/**` 网络调用 0、bundle 唯一 `fetch(` 为 modulepreload polyfill（§4.3 已独立验证）、URL 字面量仅 5 个已知标识符。
- Leg 2（Fetch 拦截非本地请求）：本地请求 3、外部 0，全链路通过，导出哈希重算一致。
- Leg 3（`Network.emulateNetworkConditions(offline)` 后交互）：离线期间新发起请求 0、外部 0，模式切换/时间轴点击/导出均通过；demo 哈希与冻结值一致。
- 评审员重跑 `OFFLINE_TEST.json` 与施工方逐字节相同。

### 4.6 截图与断言一致性——通过（附一处说明）

- 3 张截图均已目视：`e2e-main-flow.png`（初始加载 rv / FAIL / 种子正确）、`e2e-keyboard-visible.png`（§4.2）、`e2e-tab-focus-export.png`（导出按钮带蓝色焦点框，时间轴表遮挡面积 0，rv 下无热区——与断言一致）。
- 说明（非问题）：键盘可见截图中红色热区矩形绘于橙色目标 UI 之下（`viewportSvg.tsx` 先绘 hotZone、后绘 surface），故视觉上只露一条红色边。这是 T009 产品渲染顺序的选择，不属 T012 改动范围；脚本断言（SVG 含 `#dc2626` 矩形）本身为真。

### 4.7 T009 可选项 4、5 登记 T013——合理

- 选项 4（3×4 对比矩阵）需改 `src/ui/App.tsx` 对比表计算与 DOM；选项 5（见证逐项展开）需新增 `scenario.ts`/`WitnessPanel.tsx` 重放逻辑；两者均非低风险改动，在以验证为主的 T012 内不做、如实登记是正确的。逻辑层覆盖（`test:ui` 4×3 sweep）全绿，E2E 另在 overlays-content 下验证对比表 4 行齐全。

### 4.8 其余脚本抽查——通过

- `test-perf.mjs`：真实以子进程重跑 `test:performance` 并复核证据文件门槛，非空壳；失败时 exit 1。
- `test-stress.mjs`：两次干净重建哈希比对、demo ×5、重放 ×100、preview ×3 均为真实工作；评审员重跑 `STRESS_TEST.json` 逐字节相同。
- `release-verify.mjs`：两次干净构建哈希一致、dist 清单（4 文件）、demo 哈希复算、`DEMO_MANIFEST.json` 印证、index.html 无外部引用；评审员重跑 `RELEASE_REHEARSAL.json` 逐字节相同。唯一冗余见 P2-4。

---

## 5. P0 / P1 / P2 清单

### P0（0 条）

无。7 条验收命令全部 exit 0 且数字经重跑复现；无数字造假；真实浏览器与离线断言均成立；回归全保持。

### P1（0 条）

无。门槛冻结规则如实执行；4 项测试修复均未放宽产品断言；证据与断言一致（除 P2-2 的留存缺口外）。

### P2（4 条，均登记 T013，不阻塞合并）

- **P2-1：`handoff/T012/sha256.txt` 对两份性能证据文件校验失败——可接受的设计，非 T012 缺陷。**  verdict：**非缺陷，流程问题**。`test-performance.mjs` 每次运行都会重写 `evidence/performance/PERFORMANCE_TEST.json` 与 `PERFORMANCE_REPORT.md`（实测时间不同）。评审员在重跑**前**执行 `sha256sum -c` 即已复现：恰好这两项 FAILED，其余 39 项全部 OK；重跑后 diff 证实差异**仅在实测值**（构建 7075→6444 ms 等），门槛、规则、断言数完全相同。协调员重跑后校验失败是同一机制。处理建议（三选一，T013 定）：(a) 将随运行再生的证据文件移出 `sha256.txt`，改为校验其门槛/断言等稳定字段；或 (b) 把 `sha256.txt` 的生成作为验收跑的最后一步；或 (c) 接受“性能证据哈希每次运行都变”并在 `TASK_REPORT` 中注明。**注意：评审员本次重跑已再次改写这两份文件（当前内容为评审员重跑值，门槛不变）；合并前无需手工恢复。**
- **P2-2：`evidence/e2e/downloads/` 未保留主流程的 resizes-visual 导出文件。** verdict：**证据留存缺口，记录级**。目录现存唯一文件为 Enter 测试下载的 `UI-chat-input-resizes-content.viewportshift.json`（哈希 `98f83754…`，与 `sha256.txt` 一致，两次运行确定性相同）；而 `E2E_TEST.json` 中 `export.file` 登记的是 `UI-chat-input-resizes-visual.viewportshift.json`（哈希 `e85dbd57…`），该文件被脚本在 Enter 测试前清空下载目录时删除。施工方在 `TASK_REPORT.md` §7 已如实披露此事；哈希本身经评审员重跑复算验证无误（`scenarioSha256` 与 `expectedScenarioSha256` 一致、`canonicalRoundTrip: true`）。建议 T013：导出后立即把主流程文件复制到独立留存名，或 Enter 测试改用另一下载目录，使 JSON 记录与磁盘文件一一对应。
- **P2-3：性能门槛全部由下限决定，2×中位数规则从未生效，门偏松。** verdict：**设计说明，记录级**。两次实测中 2×中位数均远低于下限（构建 2×6444=12888 < 120000；demo 2×94=188 < 10000；页面加载 2×229=458 < 5000；交互 2×~165≈330 < 1000），门槛相对实测的余量为 6–102 倍，冻结门槛只能捕捉灾难性退化。规则本身是任务卡授权的且执行无误，不构成失败；但建议 T013 复核下限是否应收紧（例如以 2×中位数为 operative 门槛、下限仅作兜底），或在报告中注明门槛的松紧含义。
- **P2-4：`evidence/release-rehearsal/RELEASE_MANIFEST.json` 与 `RELEASE_REHEARSAL.json` 内容完全相同。** verdict：**冗余，记录级**。`release-verify.mjs` 将同一 manifest 对象写了两份（sha256 均为 `4e5daf55…`）。建议 T013/T014 只保留一份规范文件（另一份改为引用或删除），避免双份漂移。

### 明确不计为缺陷的项

- T011 的 2 项 P2（Golden 节点数、geometry-eval INVALID 分支）：按任务卡要求属 T013，T012 未处理正确，**不计为 T012 缺陷**。
- Windows NOT_TESTED：已如实记录（各证据文件 `windowsTested: "NOT_TESTED"`），不得写 PASS，处理正确。
- 未用 Playwright API：原因（驱动包未安装 + 禁止新增依赖 + `npm ci` 后临时安装会消失）已核实属实；CDP 直驱同一份缓存 Chromium，覆盖面不缩水，**不计为缺陷**。
- 评审员重跑中 `wrapped: false`（§4.2）：已探针证实为 headless shell 下焦点出页即回 BODY 的真实行为，遍历本身完整，**不计为缺陷**。

---

## 6. 最终结论

- **FINAL_VERDICT: PASS**
- **P0 0 / P1 0 / P2 4**（P2-1 性能证据哈希随运行再生、P2-2 E2E 下载留存缺口、P2-3 门槛下限主导偏松、P2-4 发布预演 manifest 双份冗余；全部登记 T013）
- **建议合并。** 7 条验收命令评审员重跑全部 exit 0、数字与施工方一致；18 组回归数字全保持，gate 哈希与 demo 冻结哈希不变；改动范围与自述一致（仅 package.json +6 脚本名，src/oracle/S0 零改动）；真实浏览器、离线三腿、T009 三项补做、4 项测试修复均经独立验证成立。
- 合并后待办（协调员/T013）：按 P2-1 选定性能证据的哈希处理方式；P2-2/P2-4 的留存与去重；P2-3 的下限复核；T009 可选项 4/5 与 T011 的 2 项 P2 仍登记在 T013。
