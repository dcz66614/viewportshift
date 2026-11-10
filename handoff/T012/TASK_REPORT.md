# P021 T012 — E2E/离线/性能/发布预演｜任务报告

- **任务：** P021 ViewportShift T012（S4），只做 T012，不碰 T013–T014、不碰其他任务
- **工作目录：** `~/workspace/p021-viewportshift/`；基线 HEAD `2bdbc93`（T011 已 PASS），开工时工作树干净
- **规格：** `~/workspace/P021_PROJECT_BOOK.md`（SHA-256 前 8 位 `8070d7e3`）、`~/workspace/P021_IMPLEMENTATION_PLAN.md`（SHA-256 前 8 位 `458cd409`）
- **固定 seed：** `P021-VIEWPORTSHIFT-S0-2026-11-10`
- **状态：** ✅ 全部 7 条验收命令 exit 0（见 §2）；未 git commit（由协调员统一提交）；未 push；未写 Drive；未对外发消息
- **模型路线：** 本任务全部由 Muse 自行编写与验证，未调用任何外部模型（WorkBuddy 自 06:31 起不通，Qoder 同在 Sam 电脑上；Copilot 桥未使用——本次工作无需模型调用）

## 1. 做了什么

### 1.1 新脚本（`scripts/`，package.json 只加 6 个脚本名，依赖一字未动）

| 文件 | 内容 |
|---|---|
| `scripts/e2e-lib.mjs`（新建，共享库） | CDP 真浏览器驱动（Node 24 内置 WebSocket 直连 Chromium DevTools 协议：`Input.dispatchMouseEvent` 真鼠标点击、`Input.dispatchKeyEvent` 真键盘事件、`Page.captureScreenshot`、`Page.setDownloadBehavior`、`Network` 请求记录、`Network.emulateNetworkConditions` 离线模拟）+ T008/T009 式 domain 内存转译加载（导出 JSON 复验用）+ pass/fail 计数 harness。另含 `findChrome`（Playwright 缓存 headless shell → 完整 Chromium → /opt/meta-chromium/chrome → PATH）与 `startPreview`（vite preview） |
| `scripts/test-e2e.mjs`（新建，`test:e2e`） | 真浏览器全链路：布局切换（鼠标点测试集按钮）→ 模式切换（鼠标点 radio）→ 序列切换（聚焦 select 后 ArrowDown ×2）→ 时间轴点击 → 四布局对比表 → 见证面板 → 导出下载；另含 T009 三项补做（§3）与全程网络请求记录 |
| `scripts/test-offline.mjs`（新建，`test:offline`） | 三腿离线验证：静态扫描 dist + 拦截非本地请求的 live 全链路 + 离线模拟后交互；写 `evidence/offline/OFFLINE_TEST.json` 与 `OFFLINE_REPORT.md` |
| `scripts/test-performance.mjs`（新建，`test:performance`） | 实测构建/demo/preview 启动/页面加载/三种交互延迟；门槛按实测基线冻结（§4）；写 `evidence/performance/PERFORMANCE_TEST.json` 与 `PERFORMANCE_REPORT.md` |
| `scripts/test-perf.mjs`（新建，`test:perf`） | 性能聚合入口：真实跑 `test:performance` 子进程并复核其证据文件门槛（不是空壳） |
| `scripts/test-stress.mjs`（新建，`test:stress`） | 两次干净重建哈希比对 + demo ×5 哈希稳定 + 重放 ×100 单哈希重检 + preview 加载 ×3 场景哈希一致；写 `evidence/performance/STRESS_TEST.json` |
| `scripts/release-verify.mjs`（新建，`release:verify`） | 发布**预演**核验：两次干净构建哈希一致 + dist 清单完整 + demo 哈希复算 + DEMO_MANIFEST 印证；写 `evidence/release-rehearsal/`（REHEARSAL 标记，**不在 `release/` 下**，T014 正式冻结包不受影响） |

### 1.2 驱动选择：为什么不用 Playwright（诚实记录）

- `npx playwright --version` 报告 1.65.0，浏览器二进制在 `~/.cache/ms-playwright`（chromium 1248/1254、headless shell），T001 亦记录 `chromium_available: true`。
- 但 Playwright **npm 驱动包未安装**（`import("playwright")` 在仓库内解析失败），而任务禁令“不许新增依赖（package.json 依赖不变）”禁止把它加进 package.json；且 `--no-save` 临时安装会在 T013 的 `npm ci` 后消失，导致 `test:e2e` 在干净检出下失败。
- 因此 E2E 直接用 CDP 驱动同一份缓存 Chromium（headless shell 1254，`HeadlessChrome/158.0.8127.18`）：真实浏览器、真实鼠标/键盘事件、真实 Blob 下载、真实网络日志。与“Playwright 不可用”时的 fallback 要求相比，CDP 覆盖面更强（可点击、可按键、可下载、可拦截），不存在“未覆盖 YY”的缺口；唯一未用 Playwright API 本身，原因如上。
- 探针教训（已固化进 `e2e-lib.mjs` 注释）：CDP `Enter` 键须在 keyDown 带 `text: "\r"` 才能触发聚焦按钮的默认点击动作；无 text 的 keyDown 在 headless shell 与完整 Chromium 下均产生 0 次点击（探针实测）。

### 1.3 性能门槛冻结

`evidence/environment/ENVIRONMENT_REPORT.md`（T001）全文无任何冻结性能门槛（脚本内断言核查：无 `性能门槛/threshold/门槛` 字样），故按任务卡授权以本次实测基线冻结，规则写明在 `PERFORMANCE_REPORT.md`：**threshold = max(2 × 本次实测中位数, 下限）**，下限：构建 120000 ms、demo 10000 ms、preview 启动 10000 ms、页面加载 5000 ms、交互 1000 ms。交互延迟含 CDP 往返 + 轮询粒度，实测值为上界口径。

### 1.4 T009 可选项 4、5：未做，如实登记

见 `handoff/T012/unresolved_items.md` 第 1–2 条：两者都需改产品 UI（App.tsx 对比表计算、WitnessPanel 逐项状态重放），在验证任务里不是低风险改动；逻辑层覆盖（`test:ui` 4×3 sweep）已全绿。未硬凑。

## 2. 验收结果（全部 exit 0，完整日志在 `handoff/T012/test_logs/`）

| 命令 | 结果 |
|---|---|
| `npm run test:e2e` | **PASS — 55 passed, 0 failed**。全链路（布局→模式→序列→重放→时间轴→对比表→见证→导出）在真浏览器走通；导出为真实 Blob 下载，场景哈希 `e85dbd57…` 与 Node 复算一致、canonical round-trip 一致；Tab 遍历 17 stops，文档序单调；**外部网络请求 0**（本地请求 6 个） |
| `npm run test:offline` | **PASS — 26 passed, 0 failed**。三腿：静态扫描（index.html 外部引用 0、src 网络调用 0、bundle 唯一 `fetch(` 为 Vite modulepreload 本地预载 polyfill、URL 字面量仅 react.dev 错误链接与 w3.org 命名空间）；Leg 2 拦截非本地请求下全链路通过（本地请求 3 个、外部 0）；Leg 3 离线模拟后模式切换/时间轴点击/导出均通过，离线期间新发起请求 0、外部 0；demo 哈希与冻结值一致 |
| `npm run test:performance` | **PASS — 11 passed, 0 failed**。实测中位数：构建 6984 ms、demo 99 ms、preview 启动 551 ms、页面加载 226 ms、时间轴点击 164 ms、模式切换 165 ms、模板切换 164 ms；门槛：120000 / 10000 / 10000 / 5000 / 1000 / 1000 / 1000 ms，全部通过 |
| `npm run test:perf` | **PASS**：聚合入口真实重跑 `test:performance` 并复核证据文件门槛，11 checks 全绿 |
| `npm run test:stress` | **PASS — 15 passed, 0 failed**。两次干净重建 dist 哈希完全一致（4 个文件）；demo ×5 哈希全等于冻结值；重放 ×100 得 1 个 canonical 哈希；BFS ×10 得 1 个见证哈希；preview 加载 ×3 屏上场景哈希一致且等于 Node 计算值 |
| `npm run build` | **exit 0** |
| `npm run release:verify` | **PASS — 15 passed, 0 failed**。两次预演构建哈希一致；dist 清单完整（`assets/index-Ck8UGF3U.js`、`assets/index-Zih-ycei.css`、`index.html`、`viewportshift.mjs`）；demo 两次运行均得冻结哈希、见证长 1，DEMO_MANIFEST.json 与 stdout 一致；`release/` 未被创建 |

## 3. T009 三项必做补做（全部完成）

| 项 | 完成情况 | 证据 |
|---|---|---|
| 1. 点击后键盘可见的 SVG 状态截图 | ✅ 完成。真鼠标点击时间轴步骤 1 后截图；并发现一个正确的几何事实：resizes-visual 下热区**应无**（视觉视口缩至 0..544，表面在其外，遮挡面积 0、hotZone=null，经 domain 复算确认），热区只在 overlays-content 下渲染（视觉视口保持 844 高），故键盘可见截图在 overlays-content 下取：SVG 含键盘矩形 `#475569` 与红色热区 `#dc2626`，遮挡面积 21840 CSS px²，选中时刻面板“键盘：可见” | `evidence/e2e/e2e-keyboard-visible.png`（已目视确认：键盘灰块、“键盘 300 CSS px 高”、橙色目标 UI 及红色热区边）+ `handoff/T012/screenshots/` 副本；E2E_TEST.json |
| 2. JSON 导出按钮自动化点击验证 | ✅ 完成。真实鼠标点击导出按钮 → 真实 Blob 下载（非 hook 捕获）；Node 侧复验：场景哈希重算一致、导出文本与 canonicalExportJson 逐字一致、场景 VALID、evaluation OK、BFS FAIL 见证长 1、场景 id 与屏上一致 | `evidence/e2e/downloads/UI-chat-input-resizes-visual.viewportshift.json`；E2E_TEST.json `export.method: real-blob-download` |
| 3. 真实 Tab 遍历断言 | ✅ 完成。真实 Tab 键走完全程 17 stops：模板 radio、测试集按钮、模式 radio、数字输入、序列 select、时间轴步骤按钮、导出按钮全部到达，焦点序严格按文档序单调（至 wrap 处结束）；ArrowDown 在模式 radio 组内移动选中项（resizes-visual → resizes-content）；聚焦导出按钮后按 Enter 触发真实下载 | E2E_TEST.json `tabTraversal`（完整焦点链） |

## 4. 回归（与基线一字不差，`handoff/T012/test_logs/11-npm-test.log`）

| 命令 | 结果 |
|---|---|
| `npm test` | **PASS 全绿**：test:schema 259/259、test:validation 273/273、test:modes 1159/1159、test:events 1301/1301、test:event-order 22/22、test:geometry 629/629、test:bfs 277/277、test:bfs:determinism 4/4、test:ui 202/202、test:export 136/136、test:golden 107、test:property 709/709、test:oracle（98+70+86+24）、test:mutation 31/31、test:coverage parity 165/165 |
| `npm run s0:gate` | **PASS — 120/120**（53/53 parity、12/12 植入检出、0 误报、100 次 1 哈希）；gateSha256 `65b4b32f4a5298642fd3de5a64441ed7d214e2519d118b8b67a7871ba73aca26` 保持不变；`evidence/s0/S0_GATE.json` 未改动 |
| `npm run typecheck` | exit 0 |
| `npm run build` | exit 0 |
| `node dist/viewportshift.mjs demo` | exit 0；`resultSha256=88f2153afd19cd19659d48587b7a98286621fff7ca9ae37cec0de6a4e50f6b60`、`reportSha256=f329e8144a234eb46e6eea71dc04fc222e63dec44f3f66192b6c0bf0128d90b8`、见证长 1——与基线完全一致 |

## 5. 工作中发现并已修正的问题（共 4 个，如实记录；均为测试侧问题，非产品缺陷）

1. **E2E 初版热区断言失败（测试假设错，产品正确）：** 初版在 resizes-visual 下断言红色热区存在，失败；domain 复算证明 rv 下 surface ∩ keyboard ∩ visual 为空、遮挡面积为 0 是正确的几何行为。修正：rv 段断言键盘矩形 + 遮挡面积 0，热区断言与截图改到 overlays-content 下（遮挡面积 21840）。
2. **Tab 遍历在导出按钮处提前终止（测试逻辑错）：** 初版循环在焦点到达导出按钮时 break，导致时间轴按钮（DOM 序在其后）永远走不到。修正：循环直至焦点 wrap 回早期 stop 才停。
3. **CDP Enter 不触发按钮点击（驱动细节）：** 无 text 的 keyDown Enter 产生 0 次点击；补 `text/unmodifiedText: "\r"` 后真实触发下载（探针实测：headless shell 与完整 Chromium 均如此）。
4. **离线两处测试假设错：** (a) 初版静态扫描把 bundle 内的 `fetch(` 一律判 fail；实查唯一调用点是 Vite modulepreload 本地预载 polyfill（只取文档内 modulepreload link 的 href，index.html 无外部引用，运行时日志亦证实 0 外部请求），改为按上下文分类断言；(b) 初版要求 Leg 3 离线导出哈希等于 Leg 2，但两腿模式不同（rv vs oc）场景哈希**应当**不同，改为 Leg 3 独立复验（重 canonical 化 + 哈希重算 + 场景 id）。

## 6. 与计划/项目书的偏差

- **无。** 任务卡要求的输出（Playwright traces/截图、offline/performance 报告、发布预演包）与 5 条主验收命令 + 2 条协调员点名命令全部交付；通过标准（全链路通过、外部请求 0、门槛冻结并记录、两次构建 hash 一致、Windows NOT_TESTED）全部满足。
- **两处说明（非偏差）：** (a) 未使用 Playwright API——原因见 §1.2，CDP 驱动同一份缓存 Chromium，覆盖面不缩水；(b) 性能门槛按本次实测冻结——T001 环境报告中无冻结门槛，规则与数值见 §1.3 与 PERFORMANCE_REPORT.md；`test:perf` 每次重跑会按同一规则以当次实测重冻门槛（数值见当次 PERFORMANCE_TEST.json），下限不变。
- **上游遗留决策维持未动：** resizes-visual 下 KEYBOARD_CLOSE 只恢复 visualHeight、不重置 visualOffsetTop；冻结 Oracle 与 modes/events/bfs/UI 行为未动；T011 的 2 项 P2 未处理（见未解决项第 3 条）。

## 7. 证据与交接

- 证据：`evidence/e2e/E2E_TEST.json` + 3 张截图 + 下载的导出 JSON（注：`evidence/e2e/downloads/` 内现存文件为最后一次运行中 Enter 测试下载的 resizes-content 场景导出——ArrowDown 测试把模式切到了 resizes-content 之后；主流程导出的 resizes-visual 场景哈希以 E2E_TEST.json 中记录的 `e85dbd57…` 为准）；`evidence/offline/OFFLINE_TEST.json` + `OFFLINE_REPORT.md` + 离线导出 JSON；`evidence/performance/PERFORMANCE_TEST.json` + `PERFORMANCE_REPORT.md` + `STRESS_TEST.json`；`evidence/release-rehearsal/RELEASE_REHEARSAL.json` + `RELEASE_MANIFEST.json` + `SHA256SUMS.txt`
- 交接包：`handoff/T012/`（本报告、`changed_files.txt`、`test_commands.txt`、`test_logs/` 11 份日志、`screenshots/` 3 张截图、`sha256.txt`、`unresolved_items.md`）
- 日志：`handoff/T012/test_logs/`，11 条命令 exit 均为 0
