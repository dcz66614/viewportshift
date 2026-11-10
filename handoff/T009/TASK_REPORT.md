# T009 任务报告 — 本地 Web UI 与 SVG 时间轴

**任务：** P021 ViewportShift T009（S3，8h）
**工作目录：** `~/workspace/p021-viewportshift/`（基于 HEAD `3bbaa1b`，S0/S1/S2 已 PASS）
**状态：** 完成，三条验收命令全部 exit 0
**未 git commit / 未 push / 未写 Drive / 未对外发消息**（按任务要求，由协调员统一提交）

## 做了什么

实现本地 Web UI + SVG 时间轴，全部计算只调 domain 纯函数，UI 层无第二套算法：

- `src/ui/scenario.ts`（新建，UI 唯一 domain 接入点）：由 UI 参数组装
  `viewportshift.scenario/v1` 场景（固定 seed
  `P021-VIEWPORTSHIFT-S0-2026-11-10`、固定 100 ms 步进事件序列、
  确定性场景 ID `UI-<模板>-<模式>`），调用 `validateScenario` /
  `evaluateGeometry` / `searchBfs` / `surfaceRectFor` /
  `computeMetrics` / domain canonical JSON；另含展示格式化
  （milli-px → CSS px、面积 → CSS px²、milli-ratio → %，整数运算）、
  五状态文字标签、由重放结果派生顶栏状态、时间轴行构造与选中同步、
  见证前后状态提取、浏览器 SHA-256（WebCrypto，不可用时确定性
  FNV-1a 兜底并标注方法）。
- `src/ui/App.tsx`（新建）+ `src/ui/styles.css`（新建）：首屏横幅写明
  “不需要手机”与“行为模型实验室，不是真实设备兼容性认证”；顶栏
  场景 ID、模式、seed、状态文字标签（`FAIL（失败）`等，不只靠颜色）
  与场景 SHA-256；左侧三合成 UI 模板单选（聊天输入框 / 底部面板 /
  固定 CTA）+ 内置四布局测试集按钮（含搜索栏）+ 三模式单选 +
  合成视口尺寸 / 键盘高度 / 滚动 / 延迟平移参数 + 4 种固定事件序列
  + 四布局对比表（当前模式下四布局重放状态）；导出 JSON 下载
  （domain canonical JSON）；清空恢复默认；URL 查询参数可预设
  模板 / 模式 / 序列 / 数值（供截图与复现用）。
- `src/render/viewportSvg.tsx`（新建）：中央 SVG 视口剖面——布局视口、
  视觉视口、键盘矩形、目标 UI 矩形、期望锚点矩形（绿色虚线）、
  遮挡热区（红色，`rectIntersection` 取自 domain）；下方图例逐项
  标出各矩形坐标与尺寸（CSS px）。
- `src/render/timeline.tsx`（新建）：下方事件时间轴，初始状态 +
  每步事件，每步列出遮挡面积（CSS px²）、可见比例、底部间距
  （CSS px）、位置漂移（CSS px）与状态；每行是原生 `<button>`，
  点击同步更新 SVG 与选中时刻状态 / 几何指标表。
- `src/ui/WitnessPanel.tsx`（新建）：右侧最短失败见证——搜索状态
  文字标签、访问 / 入队 / 剪枝节点数、见证事件序列、首个失败谓词、
  首个失败步骤前后状态、可复算 canonical JSON；`BOUNDED_NO_WITNESS`
  明确写“不代表全空间安全”。
- `src/App.tsx` 改为 re-export `ui/App`；`index.html` 标题改为
  “ViewportShift — 视口潮汐行为模型实验室”；`package.json` 仅加
  `test:ui` 脚本。
- `scripts/test-ui.mjs`（新建）：`npm run test:ui`，见下。

**边界遵守：** 未改 `src/domain/*`、`oracle/*`、`tests/fixtures/s0/*`、
`evidence/s0/*`、S0/S1/S2 的 scripts；未写 `src/io/**`（文件导入导出
与离线 HTML 报告是 T010 的工作）；未碰 T010–T014；上游遗留决策维持
（`resizes-visual` 下 `KEYBOARD_CLOSE` 只恢复 visualHeight、不重置
visualOffsetTop，由 domain 实现，UI 未干预）；运行时零网络、零
LLM/API、零遥测；UI 逻辑无 `Date.now` / `Math.random` / 计时器
（测试脚本扫描验证，见验收数）。

## 验收命令（原文输出）

```
$ npm run typecheck
> viewportshift@0.1.0 typecheck
> tsc --noEmit
（无错误，exit 0）

$ npm run build
> viewportshift@0.1.0 build
> tsc --noEmit && vite build
vite v7.3.8 building client environment for production...
✓ 42 modules transformed.
dist/index.html                   0.44 kB │ gzip:  0.33 kB
dist/assets/index-Zih-ycei.css    1.47 kB │ gzip:  0.69 kB
dist/assets/index-Duurj_YI.js   283.81 kB │ gzip: 85.73 kB
✓ built in 1.81s
（exit 0）

$ npm run test:ui
> viewportshift@0.1.0 test:ui
> node scripts/test-ui.mjs
test:ui — 184 passed, 0 failed
（exit 0）
```

完整日志：`handoff/T009/test_logs/`（`typecheck.log`、`build.log`、`test-ui.log`）。

## 测试数（`npm run test:ui`：184 断言，0 失败）

- 模板切换：4 布局均 VALID、seed 与单位正确、表面矩形互不相同；
  三合成 UI 为测试集前三项。
- 模式切换：同一聊天输入框 open 场景在三模式下重放；
  `resizes-visual` 与 `overlays-content` 均为 FAIL（与 S0 夹具一致），
  `resizes-content` 不同；视觉视口高分别为 544000 / 844000 milli-px。
- 事件点击同步：时间轴初始行 + 每步的 state / metrics / 失败谓词
  与 domain 评估逐项 deepEqual；未知序号回落首行。
- 状态文字：5 状态标签各异且含状态码；派生状态：谓词触发→FAIL、
  无事件→PASS、零面积→INVALID、未知模式→UNKNOWN。
- 格式化：`formatCssPx` / `formatAreaCssPx2` / `formatRatioPercent`
  各 3–4 例（含负值与小数）。
- 确定性：重复构建 / 重放 / BFS 的 canonical JSON 哈希相同。
- BFS 见证：默认场景 FAIL、见证长 1（`KEYBOARD_OPEN`）、见证重放
  复现首个失败谓词、前后状态非空；无效输入→INVALID 无见证；
  4 模板 × 3 模式 sweep：每项状态有定义，FAIL 有见证，
  `BOUNDED_NO_WITNESS` 无见证，sweep 中至少出现 1 例有界无见证。
- 禁用词扫描：`src/ui/**`、`src/render/**`、`src/App.tsx` 无
  `Date.now` / `Math.random` / `setTimeout` / `parseFloat` /
  `toFixed` 等禁用词；SVG 热区用 domain 的 `rectIntersection`；
  UI 逻辑层无自研几何 / 状态机 / 搜索函数。
- 真实渲染冒烟：`vite preview`（`--host 127.0.0.1`）+
  `~/.cache/ms-playwright` 缓存的 chromium headless shell
  `--dump-dom`：DOM 含“不需要手机”、实验室声明、状态文字、
  模板名、时间轴、见证面板、CSS px、场景 ID 与 seed；
  `?template=bottom-sheet&mode=overlays-content` 切换验证通过；
  4 张截图均 > 10 KB（见 `screenshots/`）。
- 另：`npm run s0:gate` 复跑仍 PASS（120/120，53/53 parity、12/12
  植入、0 误报、100 次 1 hash），无回归。
- 测试证据：`evidence/ui/UI_TEST.json`（断言数 + 截图 SHA-256）。

**修过的一个真实问题：** 首版 `vite preview` 默认绑 `localhost`，
本机只解析到 IPv6，`127.0.0.1:4173` 连不上（curl 000）；测试脚本
改加 `--host 127.0.0.1` 后通过。另修过一次 1280 px 下右侧见证面板
横向溢出被裁（表格撑宽网格）：加 `min-width: 0`、段落任意换行、
表格横向滚动容器，复核截图已无裁切。

## 改动文件

见 `handoff/T009/changed_files.txt` 与 `sha256.txt`
（`sha256sum -c handoff/T009/sha256.txt` 全 OK）。
改动：`index.html`、`package.json`（仅加 `test:ui` 脚本）、
`src/App.tsx`；新增：`src/ui/`（`scenario.ts`、`App.tsx`、
`WitnessPanel.tsx`、`styles.css`）、`src/render/`（`viewportSvg.tsx`、
`timeline.tsx`）、`scripts/test-ui.mjs`、`evidence/ui/UI_TEST.json`。

## 未解决项

见 `handoff/T009/unresolved_items.md`（5 项，均为 T012 E2E 可补的
交互验证缺口，非阻塞）。
