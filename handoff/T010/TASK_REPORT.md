# P021 T010 — TASK_REPORT.md

任务：JSON 导入导出与离线报告（S3，5h）。只做 T010，不碰 T011–T014，不改冻结文件。
基线：HEAD 94e61ba（T009 已 PASS），工作树干净。未 git commit（由协调员统一提交），未 push，未写 Drive，未对外发消息。

## 1. 做了什么

### src/io/json.ts（新建）
- 场景 / 结果 JSON 导入与导出，复用冻结 domain：`validateScenario`（T004）与 `canonicalJson`（geometry.ts），不自写第二套校验/几何/搜索逻辑。
- 导入 fail-closed：非字符串输入、非法 JSON、>1 MiB（1,048,576 字节）、嵌套深度 >32、JSON 值总数 >10,000 均拒绝；INVALID / UNKNOWN 场景按 validator 原 issue codes 拒绝。
- 结果信封（`viewportshift.scenario/v1` + `io/v1`）导入时校验：schemaVersion / ioVersion、analysisStatus 枚举、嵌入场景必须 VALID、`scenarioSha256` 必须等于规范化场景 JSON 的哈希（哈希函数由调用方注入，io 层保持纯函数、浏览器可用）、evaluation / BFS 块须与场景在 id / seed / mode 上一致。
- Round-trip：导出为 validator 规范化场景的 canonical JSON，export → import → export 字节一致，SHA-256 可复算。
- 导入文本只作 JSON 数据解析，绝不执行：含 script 标签 / eval / Function 字样的字符串按惰性数据处理，报告侧再转义。

### src/io/report.ts（新建）
- 自包含离线 HTML 报告纯函数：场景 ID、模式、seed、状态文字、内联 SVG 视口剖面（布局/视觉视口、键盘、目标 UI、期望锚点、遮挡热区，均由 domain 整数算出）、事件时间轴、关键数值、最短失败见证（事件序列、首个失败步骤、触发谓词、搜索上限与节点数）、可复算性说明。
- 零 CDN、零远程资源：无 script / link / img / iframe / object / embed 元素，无远程引用、无 CSS `@import` / `url(`；唯一 style 为内联 `<style>`，唯一图形为内联 SVG。`findExternalReferences()` 供验收扫描。
- 文本安全转义：全部输入来源字符串经 `escapeHtml`（& < > " '）后才进入文档；不拼接输入为可执行 HTML。
- 数值格式化全部整数数学（milli-CSS-px → CSS px），与 `src/ui/scenario.ts` 同规则。

### src/io/demo.ts（新建）
- 内置合成 Demo 场景：聊天输入框 390×56 CSS px（底部锚定）、布局视口 390×844、键盘 300 CSS px、`overlays-content`、冻结 seed、单事件 `KEYBOARD_OPEN`（demo-e1，100 ms）。纯数据，无时钟/随机/IO。

### src/cli.ts（新建）+ vite.cli.config.ts（新建）
- `node dist/viewportshift.mjs demo [--out <dir>]`：载入内置合成场景 → 导出 canonical JSON → 重新导入（Demo 自身走一遍 round-trip）→ 重放（`evaluateGeometry`）→ BFS（`searchBfs`）→ 写 canonical 结果 JSON、离线 HTML 报告、`DEMO_MANIFEST.json`（三文件 SHA-256）到确定目录（默认 `demo-output/`），退出码 0。未知命令 / 参数错误 exit 非 0。
- 构建接线：`npm run build` = `tsc --noEmit && vite build && vite build --config vite.cli.config.ts`；CLI 以 vite lib 单独打包为 `dist/viewportshift.mjs`（`emptyOutDir: false`，不破坏 Web 应用输出；`node:` 内建保持 external）。`package.json` 只加了 `build:cli` 与 `test:export` 脚本。
- 说明：本仓库无 `@types/node`，CLI 的三个 `node:` 导入带 `// @ts-ignore`（运行时由 vite lib 解析），`process` 在文件内最小声明；其余 domain / io 逻辑仍完整受 `tsc` 检查。

### scripts/t010-lib.mjs（新建）+ scripts/test-export.mjs（新建）
- `t010-lib.mjs`：沿用既有模式（TypeScript 内存转译 domain + UI + io 模块、扁平化导入改写），供验收脚本使用；另有 io 层禁用词表。
- `test-export.mjs`（`npm run test:export`）：见 §2。

### README.md（改写）
- 首屏明确“不需要手机”与“行为模型实验室，不是真实设备兼容性认证”。
- 一条命令跑合成 Demo、Demo 产物表与可复算哈希、三模式对比表（同一聊天输入框、同一键盘展开事件的实测数值）、最短失败序列与遮挡数值示例、JSON 导入导出与离线报告说明、本地 Web UI 说明。

### 未改动
`src/domain/*`、`oracle/*`、`tests/fixtures/s0/*`、`evidence/s0/*`、S0/S1/S2/T009 的 scripts 与 `src/ui`、`src/render`（T009 UI 导出面板只做 JSON 下载，保持不动；T010 只读 domain 的 canonical JSON 函数）。上游遗留决策维持：`resizes-visual` 下 `KEYBOARD_CLOSE` 只恢复 visualHeight、不重置 visualOffsetTop。

## 2. 验收（全部 exit 0，实测输出见 handoff/T010/test_logs/）

| 命令 | 结果 |
|---|---|
| `npm run build` | exit 0（tsc + Web 应用 + CLI；`dist/index.html`、`dist/assets/*` 完好，新增 `dist/viewportshift.mjs` 72.55 kB） |
| `node dist/viewportshift.mjs demo` | exit 0（见 §3） |
| `npm run test:export` | exit 0，**136/136 checks passed** |
| `npm run s0:gate`（回归，非 T010 验收命令） | exit 0，PASS：120/120（53/53 parity：48 main + 5 edge，12/12 planted，0 false positives，100 runs / 1 hash）；`evidence/s0/S0_GATE.json` 内容未变 |

`npm run test:export` 的 136 项检查覆盖：
- Round-trip：Demo 场景 + 12 个 UI 组合（4 模板 × 3 模式）export → parse → export 字节一致、哈希一致；结果信封 export → parse → export 字节一致。
- 篡改拒绝：顶层 `scenarioSha256` 篡改为全 0 → `import_hash_mismatch` 拒绝；嵌入场景 mode 篡改 → 拒绝。
- Fail-closed：畸形 JSON、空串、数组/字符串/数字/null 根、超 1 MiB 文档、40 层嵌套、10,002 节点、重复事件 id、9 事件超限（maxEvents 8）、`"390px"` 单位字符串、无效场景导出——全部拒绝；恰为 1 MiB 的空白填充文档仍可导入。
- 恶意字符串为数据非代码：`scenario_id = "<script>alert(1)</script>"`、`seed` 含 eval/Function 文本可导入；报告含 `&lt;script&gt;` 且不含 `<script`，外部引用扫描为空。
- 离线报告：含场景 ID、模式、seed、FAIL 状态文字、SVG 剖面、时间轴、见证、最短失败序列与关键数值；外部引用扫描 0 项，无 script / link / img 元素，无远程引用。
- Demo 产物：CLI 两次运行输出完全一致；manifest 三哈希均可独立复算；结果 JSON 文件本身即 canonical 且可重新导入。
- 禁用词扫描：`src/io/**` 无 `Date.now` / `Math.random` / 计时器 / `fetch(` / `XMLHttpRequest` / `WebSocket` / `eval(` / `new Function` / `http://` / `https://` / `node:`。

## 3. Demo 实测结果

```
demo: scenario=DEMO-chat-input-overlays-content status=FAIL
demo: scenarioSha256=b3bc29aa2e21970964eb26959848ebf76c2d0019dcb6c21aed65d27f113048e2
demo: resultSha256=88f2153afd19cd19659d48587b7a98286621fff7ca9ae37cec0de6a4e50f6b60
demo: reportSha256=f329e8144a234eb46e6eea71dc04fc222e63dec44f3f66192b6c0bf0128d90b8
demo: witnessLength=1
demo: wrote demo-output/viewportshift-demo.json
demo: wrote demo-output/viewportshift-demo-report.html
demo: wrote demo-output/DEMO_MANIFEST.json
```

Demo 最终数值（`overlays-content`）：键盘遮挡面积 **21840 CSS px²**，可见比例 **0%**，可见面积 0 CSS px²，底部间距 0 CSS px；最短失败序列 1 个事件：`KEYBOARD_OPEN`（demo-e1，100 ms，keyboardHeight 300000 milli-px），触发谓词 `visibleRatio, keyboardObscuredArea`。

三模式对比实测（同一聊天输入框、同一键盘展开事件；写入 README）：
`resizes-visual` FAIL（可见 0%，遮挡 0，裁剪 21840 CSS px²，底部间距 −300 CSS px，见证 1 步）；
`resizes-content` PASS（可见 100%，见证无，`BOUNDED_NO_WITNESS`）；
`overlays-content` FAIL（可见 0%，遮挡 21840 CSS px²，见证 1 步）。

## 4. 过程备注

- 初版 `test-export` 136 项中 4 项失败，均为测试或注释问题、非产品缺陷，已修正并复测通过：(a) 字符串 `replace` 篡改哈希只换掉了 `bfs` 块内的第一个出现处，改为对象级精确篡改顶层字段；(b) 报告断言针用了错误的 `"viewport剖面"`，报告原文为“视口剖面”；(c) `src/io/json.ts` 两处注释含 `node:` 字面，改写注释以通过 io 层禁用词扫描。
- `demo-output/` 与 `dist/` 均在 `.gitignore` 内；Demo 产物保留在工作区确定路径，未提交。
- 证据：`evidence/io/EXPORT_TEST.json`（136/136，含三哈希）。

## 5. 未解决项

见 `handoff/T010/unresolved_items.md`：无 T010 阻塞项；两项说明（CLI 的 `@ts-ignore` 与 `dist/` 内 CLI 产物为构建生成物）。

## 6. 上游遗留清单（只记录、不处理；按任务要求原样抄录）

> 另请注意（只记录、不处理）：S2 独立审查遗留 6 项 P2 与 T009 独立审查遗留 8 项 P2（含顶栏状态永不可能是 BOUNDED_NO_WITNESS、时间轴行状态忽略 GeometryStep.status 等）已登记留待 T011/T013；T009 另有复核观察一项（状态栏在 result === null 的短暂加载窗口默认显示 UNKNOWN 标签，T009 原有行为）——这些都不是 T010 的任务，不要顺手改，但不要把它们埋掉：在 TASK_REPORT.md 末尾原样抄录这份清单即可。

说明：上述清单按任务原文逐字抄录。S2 / T009 独立审查的 P2 明细条目文本不在本仓库快照中（仓库内 `handoff/T008/unresolved_items.md`、`handoff/T009/unresolved_items.md`、`handoff/T009-FIX/unresolved_items.md` 均未逐条列出这 6 + 8 项 P2），T010 未改动其中任何一项，也未重新推导条目细节；明细以独立审查报告原文为准，留待 T011/T013 处理。
