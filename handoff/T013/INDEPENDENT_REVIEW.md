# P021 ViewportShift — T013 独立审查报告

- **审查员：** 独立审查会话（与 T001–T012 施工方不同会话；未参与任何施工；
  所有数字亲自重跑，不采信施工方自述）
- **审查对象：** P021 ViewportShift S5 T013，commit `fff40cb`
  （`fff40cb82f971fca384a822401b5934de57d38a8`，T012 已提交）
- **工作目录：** `~/workspace/p021-viewportshift`；审查开始时工作树干净，
  审查结束时工作树除新增 `handoff/T013/` 外仍干净（`git status` 验证）
- **审查时间：** 2026-11-10 ~11:02–11:20 GMT
- **审查方法：** 通读 22 个源文件全文（见 `COVERAGE_MATRIX.csv`，100% READ）；
  抽查 5 个 Python Oracle 文件的关键分支与导入关系；亲自重跑 7 条 T013
  验收命令 + `s0:gate` + `build` + `demo`（日志见 `test_logs/`）；
  独立探针复算冻结语料 INVALID 步数与 golden 节点数字段；
  `git status/diff` 核对改动范围；`sha256sum -c` 核对交接哈希；
  目视 3 张 E2E 截图；核对 `handoff/T011/REVIEW_P2_REGISTER.md` 与
  `handoff/T012/REVIEW.md` 的逐项登记
- **最终结论：** ✅ **FINAL_VERDICT: PASS**（P0 0 / P1 0 / P2 8，
  其中 7 项 open、1 项已裁决保留；P2 均登记，不阻塞）

---

## 1. 验收命令重跑结果（审查员亲自重跑，全部 exit 0）

| # | 命令 | 审查员重跑结果 | exit |
|---|---|---|---|
| 1 | `npm ci` | `added 69 packages in 2s` | 0 |
| 2 | `npm run typecheck` | 无输出（`tsc --noEmit` 干净） | 0 |
| 3 | `npm test` | 全绿，见 §2 回归表 | 0 |
| 4 | `npm run test:oracle` | modes 98 / events 70 / geometry 86 / coverage 165，parity 100% | 0 |
| 5 | `npm run test:e2e` | 55 passed, 0 failed；0 外部请求；real-blob-download；Tab 17 stops | 0 |
| 6 | `npm run test:offline` | 26 passed, 0 failed；三腿 0 外部请求 | 0 |
| 7 | `npm run release:verify` | 15 passed, 0 failed；两次预演构建哈希一致；dist 清单 4 文件 | 0 |

补充（任务书要求核对的回归基线，非验收命令但亲自跑过）：

| 命令 | 结果 | exit |
|---|---|---|
| `npm run s0:gate` | 120/120 PASS（53/53 parity：48 主场景 + 5 边界；12/12 植入检出；0 误报；100 次运行 1 个哈希） | 0 |
| `npm run build` | exit 0（`tsc --noEmit && vite build && vite build --config vite.cli.config.ts`） | 0 |
| `node dist/viewportshift.mjs demo` | status=FAIL；resultSha256=`88f2153a…`；reportSha256=`f329e814…`；witnessLength=1 | 0 |

完整日志：`test_logs/01-npm-ci.log` ~ `test_logs/10-demo.log`。

## 2. 回归基线核对（全部保持）

| 套件 | 基线要求 | 审查员重跑 | 结论 |
|---|---|---|---|
| test:schema | 259/259 | checks passed: 259, failed: 0 | ✅ |
| test:validation | 273/273 | checks passed: 273, failed: 0 | ✅ |
| test:modes | 1159/1159 | checks passed: 1159, failed: 0 | ✅ |
| test:events | 1301/1301 | checks passed: 1301, failed: 0 | ✅ |
| test:event-order | 22/22 | checks passed: 22, failed: 0 | ✅ |
| test:geometry | 629/629 | checks passed: 629, failed: 0 | ✅ |
| test:bfs | 277/277 | checks passed: 277, failed: 0 | ✅ |
| test:bfs:determinism | 4/4 | checks passed: 4, failed: 0 | ✅ |
| test:ui | 202/202 | 202 passed, 0 failed | ✅ |
| test:export | 136/136 | 136/136 | ✅ |
| test:golden | 107/107 | checks passed: 107, failed: 0 | ✅ |
| test:property | 709/709 | checks passed: 709, failed: 0 | ✅ |
| test:mutation | 31/31 | checks passed: 31, failed: 0 | ✅ |
| oracle:diff:modes | 98/98 | checks passed: 98, failed: 0；parity 41/41 | ✅ |
| oracle:diff:events | 70/70 | checks passed: 70, failed: 0；parity 27/27 | ✅ |
| oracle:diff:geometry | 86/86 | checks passed: 86, failed: 0；parity 34/34 | ✅ |
| oracle:diff:coverage | 165/165 | coverage parity: 165/165 (100%) | ✅ |
| test:coverage P2 验证 | — | passed: 33, failed: 0 | ✅ |
| `npm test` 总 | 全绿 exit 0 | `npm test: PASS — full suite green`，exit 0 | ✅ |
| `s0:gate` | 120/120，gateSha256 `65b4b32f…` | 120/120 PASS；`evidence/s0/S0_GATE.json` 的 gateSha256 = `65b4b32f4a5298642fd3de5a64441ed7d214e2519d118b8b67a7871ba73aca26`，与基线一字不变 | ✅ |
| demo 哈希 | resultSha256 `88f2153a…` / reportSha256 `f329e814…` / 见证长 1 | resultSha256=`88f2153afd19cd19659d48587b7a98286621fff7ca9ae37cec0de6a4e50f6b60`、reportSha256=`f329e8144a234eb46e6eea71dc04fc222e63dec44f3f66192b6c0bf0128d90b8`、witnessLength=1 | ✅ |

`npm test` 日志中含 `FAIL` 字样的行均为良性（夹具状态标签 `FAIL=5`、
断言文本 `PASS result: demo replay status is FAIL`、`PASS report: contains FAIL`），
无真实失败。审查员本次未跑 `test:performance`（不在 7 条验收命令内），
故未改写性能证据文件；`git status` 全程干净。

## 3. P0 / P1 / P2 清单

### P0（0 条）

无。7 条验收命令全部 exit 0 且数字经重跑复现；无数字造假；回归全保持；
Oracle parity 100%；false PASS 0（见 §3.4 的三项独立判断）。

### P1（0 条）

无。

### P2（8 条：7 项 open + 1 项已裁决保留）

- **T013-P2-1（新，open）：时间轴行状态忽略 `GeometryStep.status`。**
  证据：`src/ui/scenario.ts:339–393`（`TimelineRow` 接口与 `timelineRows`
  不含 status 字段，映射时丢弃 `step.status`）；
  `src/render/timeline.tsx:100–104`（状态列 `failed ? "FAIL（失败）" : "PASS（通过）"`，
  只看 `failedPredicates`）。
  影响：评估以合同违规（UNKNOWN）或零面积（INVALID）终止时，末行会显示
  “PASS（通过）”，尽管顶栏状态正确显示 UNKNOWN/INVALID 且 `FailClosedNotice`
  存在。实际可达性极低：合同检查是构造定理、UI 参数范围（布局高 ≥400、
  键盘高 ≤800 等）使零面积不可达；`test:ui` 对 fail-closed 只覆盖“零行”情形，
  未覆盖“末行非 OK”情形。处置：另开修复任务（行状态应优先显示步骤 status，
  末行非 OK 时不显示 PASS），修后重审 UI；不阻塞本次 PASS。
- **T013-P2-2（新，open）：`result === null` 的短暂加载窗口顶栏默认显示 UNKNOWN 标签。**
  证据：`src/ui/App.tsx:236`（`const status = result !== null ? result.analysisStatus : "UNKNOWN"`）。
  属实，但为异步计算完成前的一瞬态，且同一行场景哈希处同时显示“计算中…”；
  不影响任何已完成评估的正确性。处置：另开修复任务（加载窗口改显示“计算中”
  标签），妆容级，不阻塞。
- **T011-P2-1（承接，open）：Golden `expected.bfs` 缺 `nodesVisited` / `nodesEnqueued`。**
  证据：24 个 golden 夹具 0/24 含这两个字段（审查员探针复算）；
  对照：15 个 BFS 夹具 15/15 含有；比较器 `scripts/t011-lib.mjs:392–399`
  （`checkBfsExpected`）已支持在字段存在时比对节点数。
  影响：golden 运行不钉住搜索代价，但最短性/见证本身已被 witness +
  witnessLength 钉住，正确性不受影响。处置：纯数据修复任务（给 24 个
  golden 夹具补两个字段，无需改比较器），不阻塞。
- **T012-P2-1（承接，open）：性能证据哈希随运行再生，`handoff/T012/sha256.txt` 校验 2 项 FAILED。**
  证据：审查员本次 `sha256sum -c handoff/T012/sha256.txt` 复现：
  仅 `evidence/performance/PERFORMANCE_TEST.json` 与 `PERFORMANCE_REPORT.md`
  FAILED，其余全部 OK。机制：`test:performance` 每次运行重写这两份文件
  （仅实测值变）。审查员本次未跑 `test:performance`，该 FAILED 为 T012
  审查员重跑后遗留的已知状态，非本次造成（`git status` 干净可证）。
  处置（三选一，由协调员/T014 定）：(a) 将随运行再生的证据文件移出
  `sha256.txt`，改为校验其门槛/断言等稳定字段；或 (b) 把 `sha256.txt` 的
  生成作为验收跑的最后一步；或 (c) 接受并在任务报告中注明。不阻塞。
- **T012-P2-2（承接，open）：`evidence/e2e/downloads/` 未保留主流程的 resizes-visual 导出文件。**
  证据：目录现存唯一文件为 Enter 测试的
  `UI-chat-input-resizes-content.viewportshift.json`（`98f83754…`）；
  而 `evidence/e2e/E2E_TEST.json` 的 `export.file` 登记为
  `UI-chat-input-resizes-visual.viewportshift.json`（哈希 `e85dbd57…`），
  该文件不在磁盘上。哈希本身经审查员重跑复算验证无误
  （`scenarioSha256 = expectedScenarioSha256`，`canonicalRoundTrip: true`）。
  处置：导出后立即把主流程文件复制到独立留存名，或 Enter 测试改用另一
  下载目录，使 JSON 记录与磁盘文件一一对应。不阻塞。
- **T012-P2-3（承接，open）：性能门槛全部由下限决定，2×中位数规则从未生效，门偏松。**
  证据：`evidence/performance/PERFORMANCE_TEST.json`：门槛 build 120000 /
  demo 10000 / preview 10000 / page load 5000 / 交互 1000 ms；
  实测中位数 build 6444 / demo 94 / preview 558 / page load 229 /
  交互 ~162–165 ms；2×中位数（12888 / 188 / 1116 / 458 / ~330）均远低于下限，
  余量 6–102 倍（最小为交互项 ~6.1 倍，最大为 demo 项 ~106 倍，按 T012 口径
  6–102 倍）。规则本身是任务卡授权的且执行无误。
  处置：T014 复核下限是否应收紧（例如以 2×中位数为 operative 门槛、下限仅作
  兜底），或在报告中注明门槛的松紧含义。不阻塞。
- **T012-P2-4（承接，open）：`evidence/release-rehearsal/RELEASE_MANIFEST.json`
  与 `RELEASE_REHEARSAL.json` 内容完全相同。**
  证据：`cmp` 无差异；sha256 均为
  `4e5daf554e0488ce0bc90ada94f167fcdf06f27208ed2f015360937f9a07f68b`。
  处置：T014 只保留一份规范文件（另一份改为引用或删除），避免双份漂移。不阻塞。
- **T007-P2-2（承接，已裁决保留）：`src/domain/geometry-eval.ts` 的 INVALID 步分支。**
  决定：**保留为防御性代码，不删除**（裁决见 §4）。本项经裁决关闭，无需修复任务。

### 明确不计为缺陷的项

- **顶栏状态永不可能是 BOUNDED_NO_WITNESS**（T009 提示之一）：属实，但不是缺陷。
  `deriveAnalysisStatus`（`src/domain/analysis-status.ts:28–37`）只由几何评估派生，
  返回值域为 PASS/FAIL/UNKNOWN/INVALID；BFS 状态另在见证面板完整报告
  （`src/ui/WitnessPanel.tsx:38–40, 88–94`：`bfsStatusLabel(bfs.status)` 含
  BOUNDED_NO_WITNESS 标签与“不代表全空间安全”说明）。符合任务卡对两类状态的
  分离设计。
- **T009 审查 8 项 P2 的其余 5 项**：逐字原文不在仓库快照中（`handoff/T009/` 内无
  `REVIEW.md`；`handoff/T011/REVIEW_P2_REGISTER.md` §C 已如实标注），审查员
  **不编造逐字文本**，报告中如实写“原文缺失、无法逐项核对”（见 §7）。
  上述三点（顶栏状态、时间轴行状态、result===null 短暂窗口）是协调员摘要提示
  中可独立验证的全部内容，已逐项核对完毕；其余条目无证据表明存在缺陷，
  也不计入 P2。
- `src/cli.ts` 顶部一段说明性注释残留（`printHelp` 之前的
  “Derive the top-bar analysis status …”段落，无对应函数）：无害的过期注释，
  不计缺陷。
- `sha256HexBrowser` 的 FNV-1a 回退（`src/ui/scenario.ts`）：仅在 WebCrypto
  不可用时生效，且回退方法经 `shaMethod` 在状态栏明示；真实浏览器走 SHA-256
 （E2E 通过），不计缺陷。

## 4. T007 P2-2 裁决：保留 INVALID 步分支为防御性代码，不删除

分支位置：`src/domain/geometry-eval.ts:225–247`（`evaluateScenarioGeometry` 内，
`computed.status !== "OK"` 时记步 `status: "INVALID"` 并停止评估）。

审查员独立验证的不可达论证：

1. `computeMetrics`（`src/domain/geometry.ts:323–340`）仅在 surface 宽/高非整数
   或 ≤0 时返回 INVALID（`zero_area_surface`）。
2. `surfaceRectFor`（`src/domain/geometry.ts:222–236`）的宽/高直接取自
   `layout.widthMilli / heightMilli`；`validateScenario`
   （`src/domain/validate.ts:236–253`）对零面积布局记 `zero_area_surface`
   （INVALID），已校验场景的 surface 恒为正面积。
3. 全部仓内调用路径均先过校验：`evaluateGeometry`（校验后才调
   `evaluateScenarioGeometry`）；`searchBfsScenario`（`src/domain/bfs.ts:469`）
   只对已校验场景调前缀评估。无任何仓内路径可把未校验场景送入该分支。
4. 观测佐证（审查员独立探针 `test_logs/probe-corpus-p2-5.mjs`）：
   冻结语料 58 个夹具（geometry 34 + golden 24），共 50 个步骤，
   INVALID 步 = 0、UNKNOWN 步 = 0，与 T011 的数字一致；
   `test:coverage` P2 验证 33/33 通过（含 P2-5 观测检查）。

保留理由：`evaluateScenarioGeometry` 是导出函数，未来调用方可能传入未校验的
`Scenario` 对象；该分支是该路径上唯一的 fail-closed 守卫。删除它不会带来
任何可观测收益，只会让未来回归静默通过；保留成本为一个已有观测测试覆盖的、
构造上不可达的分支。**不得为凑数删代码。** 本项经裁决关闭。

## 5. T007 P2-1 复核：接受 Python Oracle 分层现状成立

- `oracle/python/geometry_full_oracle.py:83` 导入 `modes_oracle` 作重放/校验层，
  矩形几何在本文件内独立重写；`oracle/python/bfs_oracle.py:66–73` 导入同侧
  events / geometry_full / modes Oracle，搜索本身（字母表、队列顺序、去重键、
  界限、fail-closed limits）独立实现。
- TS 侧完全对称：`geometry-eval.ts` 复用同侧 `modes.ts`；
  `bfs.ts` 复用同侧 `geometry-eval.ts` / `events.ts`。
- 两侧之间零共享代码、零调用：TS 文件无任何 Python 导入，Python 文件无任何
  TS 导入；两侧只共享只读夹具、字段名与 canonical JSON 定义。
- 交叉检查真实有效：`test:oracle` 四组差分 98/70/86/165 全部 100% parity，
  且含哈希逐字段比对（modes 41/41、events 27/27、geometry 34/34、
  coverage 165/165）；`evidence/coverage/ORACLE_PARITY_REPORT.json` 的
  `layeringNote` 如实记载该分层。
- 结论：**T011 的接受成立，维持现状。** 计划 §6.1 的“不共享算法模块、
  不相互调用”约束的是两侧之间，同侧分层不在其禁止范围，且与 TS 侧对称。

## 6. T010 四项 P2 复核：逐项代码核对，全部已修属实

| 编号 | 核对结果（只看代码） |
|---|---|
| T010 P2-1（导出重算比对） | ✅ 已修。`src/io/json.ts:641–691`：`exportResultJson` 用 `sha256HexPure(canonicalJson(校验后场景))` 重算并与传入值比对，不一致返回 `import_hash_mismatch` 拒绝；`sha256HexPure`（285 行起）为纯 TS SHA-256，无 Node 内建导入。 |
| T010 P2-2（analysis-status 抽取共享） | ✅ 已修。`src/domain/analysis-status.ts` 为唯一定义；`src/cli.ts:22` 与 `src/ui/scenario.ts`（重导出）均导入它；`test:coverage` P2-8 断言通过；行为一字未变（顶栏状态只由几何评估派生，永不返回 BOUNDED_NO_WITNESS，见 §3 明确不计项）。 |
| T010 P2-3（去掉 3× @ts-ignore） | ✅ 已修。`src/node-shims.d.ts` 提供三个 Node 内建的最小本地声明；全仓 grep：`src/` 内已无 `@ts-ignore` 字面；未新增任何依赖；`typecheck` 与 `build` 均 exit 0。 |
| T010 P2-4（审查原文归档） | ✅ 已修。`handoff/T011/REVIEW_P2_REGISTER.md`（16,755 字节）在仓内：§A 为逐字原文（出处理标），§C 明确标注非逐字部分，不编造。 |

## 7. T009 八项 P2 复核：三点可验证已核对，其余原文缺失

- **可验证的三点**（协调员摘要提示 + 审查员独立读代码）：
  1. 顶栏状态永不可能是 BOUNDED_NO_WITNESS：**属实，不是缺陷**（见 §3）。
  2. 时间轴行状态忽略 `GeometryStep.status`：**属实，P2**（T013-P2-1，
     `src/ui/scenario.ts` + `src/render/timeline.tsx`）。不影响分析本身的
     正确性（顶栏状态正确），只影响末行标签。
  3. 状态栏在 `result === null` 的短暂加载窗口默认显示 UNKNOWN 标签：
     **属实，妆容级 P2**（T013-P2-2，`src/ui/App.tsx:236`）；同一行哈希处
     同时显示“计算中…”，自纠正于一次异步计算内。
- **其余条目：原文缺失、无法逐项核对。** T009 独立审查的逐字原文不在仓库
  快照中（`handoff/T009/` 内无 `REVIEW.md`；`REVIEW_P2_REGISTER.md` §C 已
  如实标注）。审查员不编造逐字文本，也不据摘要推导其余条目。除上述三点外，
  本次审查未发现可归入 T009 名下的其他缺陷；如终审持有 T009 审查原文，
  请提供后补核。
- T009 的 5 项未解决项（交互验证缺口，见 `REVIEW_P2_REGISTER.md` §A.5 逐字原文）
  中，前 3 项（点击后键盘可见截图、导出按钮真实点击、真实 Tab 遍历）已由
  T012 E2E 真实完成并经本次重跑复现（55/55）；后 2 项即下节可选项 4、5。

## 8. T009 可选项 4 与 5 的决定：正式登记为不做

- **可选项 4（3×4 对比矩阵）：不做。** 现状：`src/ui/App.tsx` 对比表为
  当前模式 × 四布局。改为 3 模式 × 4 布局需改对比表计算与 DOM（`App.tsx`
  的 `compare` 计算目前按当前模式重放四模板）。逻辑层覆盖已存在：
  `test:ui` 4 模板 × 3 模式 sweep 全绿，E2E 另在 overlays-content 下验证
  对比表 4 行齐全。收益为展示性，改动非低风险，且会使 T012 E2E 证据失效、
  需重审。登记为后续 UI 任务的可选项，不阻塞 T013/T014。
- **可选项 5（见证逐项展开）：不做。** 现状：`src/ui/WitnessPanel.tsx`
  只展开首个失败步骤的前后状态 + canonical JSON。逐项展开需新增
  `scenario.ts` / `WitnessPanel.tsx` 重放逻辑，非低风险。任务卡要求
  （事件序列、首个失败谓词、前后状态、可复算 JSON）已满足；见证长度 > 1 时
  各步骤状态可由 canonical JSON 复算。登记为后续 UI 任务的可选项，不阻塞。
- 两项均非“低风险改动”，在以验证为主的 T013 内不做是正确的；审查员
  本人亦不得改代码（任务禁令），故以正式登记为准。

## 9. 上游遗留决策复核：维持（MAINTAIN），不改

决策：`resizes-visual` 下 `KEYBOARD_CLOSE` 只恢复 `visualHeight`，
不重置 `visualOffsetTop`。

审查员核对冻结 Oracle 是否确实与该决策一致——**一致**：

| 一侧 | 证据 |
|---|---|
| TS 转移 | `src/domain/viewport-state.ts:355–375`：rv close 只改 `visualHeight`（+h），其余 `...current` 保留 |
| TS 模式检查 | `src/domain/modes.ts:283–310`：`rv_offsets_unchanged` 要求 close 后偏移不变 |
| TS 事件检查 | `src/domain/events.ts`：`ev_close_offsets_retained` / `ev_close_pending_retained` |
| TS 几何 | `src/domain/geometry-eval.ts` 头注：保留偏移表现为非零 anchorDrift 与正 bottomGap（夹具 T007-scen-06） |
| Python modes Oracle | `oracle/python/modes_oracle.py:~785–800`：rv close 只恢复 `visualHeight`，不碰 `visualOffsetTop`；另有 `rv_offsets_unchanged` 检查 |
| Python events Oracle | `oracle/python/events_oracle.py:~791` 起：同上 |
| 夹具 | `tests/fixtures/events/events-rv-open-pan-close-retained.json`：close 后 `visualOffsetTop=100000`、`visualHeight=844000`、`pendingPan={dx:0,dy:100000}` |
| 项目书 | 对此保持沉默（§140 只描述 open 时缩小视觉视口）；决策记载于 modes/events 头注与 T005 报告 |

建议：**维持**。改动将破坏 modes parity 98/98、events 70/70、geometry 86/86
与 S0 gate 120/120（gate 哈希 `65b4b32f…` 将变），需规格修订 + 新 S0；
是否改由终审定，T013 不擅自改代码。

## 10. 隐私与诚实性核查

- **本地运行、无个人数据、无外部网络请求：** 通过。`src/` 全仓 grep 无
  `fetch(`/网络/时钟/随机调用；`test:offline` 26/26（三腿外部请求均为 0）；
  `test:e2e` 55/55（`externalRequests: 0`，6 个请求全为本地 127.0.0.1
  页面/JS/CSS）；离线静态扫描唯一 `fetch(` 为 Vite modulepreload polyfill，
  URL 字面量仅 5 个已知标识符；全部夹具为合成数据，零真人、无真实设备。
- **UI 文案不宣称真机兼容性认证：** 通过。`src/ui/App.tsx` 横幅：
  “行为模型实验室，不是真实设备兼容性认证。模拟结果不等价于任何厂商浏览器的
  完整实现，不能替代真机测试。”离线报告（`src/io/report.ts`）含同一声明。
  全仓未发现把模拟模型称为认证的文案。
- **Windows 如实标 NOT_TESTED：** 通过。各证据文件
  （E2E / OFFLINE / PERFORMANCE / STRESS / RELEASE_REHEARSAL / RELEASE_MANIFEST）
  的 `windowsTested` 均为 `"NOT_TESTED"`；无一处写 PASS。

## 11. 发布证据核查与 T014 冻结条件

- `evidence/release-rehearsal/` 三文件自洽：`SHA256SUMS.txt` 的 4 条 dist 哈希
  与 `RELEASE_REHEARSAL.json` 的 dist 清单逐项一致；`buildsIdentical: true`；
  demo 哈希与冻结值一致；`kind` 明确标注为 REHEARSAL、非 T014 正式冻结。
  唯一问题是 T012-P2-4 的双份相同文件（见 §3）。
- **T014 冻结尚不具备条件：** `scripts/deterministic_zip.py` 不存在，
  `package.json` 无 `release:freeze` 脚本，`release/` 目录不存在。
  按任务书，这属于 T014 的工作范围，**不是 T013 的缺陷项**，在此注明。
  T013 PASS 后，由 T014 新建上述工具再执行冻结；`release/` 未被本次审查创建。
- 改动范围核对：审查开始与结束时 `git status` 均干净（除新增 `handoff/T013/`）；
  审查员未修改任何源码、夹具、Oracle 或证据文件，未 commit，未 push，
  未碰 GitHub/Drive，未对外发消息。`git log` HEAD 仍为 `fff40cb`。

## 12. 分批审查包与覆盖

- `REVIEW_PACK_01.md`：域核心（types/validate/viewport-state/modes/events）
- `REVIEW_PACK_02.md`：几何内核 + BFS + Python Oracle
- `REVIEW_PACK_03.md`：IO / CLI / 导出 / 离线报告
- `REVIEW_PACK_04.md`：UI / 渲染 / 见证面板（含 3 张截图目视）
- `REVIEW_PACK_05.md`：测试 / 证据 / 隐私 / 发布预演
- 源文件覆盖：22/22 READ（`COVERAGE_MATRIX.csv`）；另抽查 5 个 Python Oracle
  文件的关键分支与导入关系、tests/fixtures 的关键夹具
  （golden 24、BFS 15、events 保留偏移夹具、geometry 34）。
- 不能读取的证据（明确列出）：T009 独立审查 8 项 P2 的逐字原文
  （`handoff/T009/` 内无 `REVIEW.md`；其余 5 项无法逐项核对，见 §7）；
  除此之外，本次审查需要读取的证据均已读取。T007/T008 独立审查报告原文
  亦不在仓库快照中（`handoff/T007/`、`handoff/T008/` 内无 `REVIEW.md`），
  但其 P2 已由 `REVIEW_P2_REGISTER.md` §A 逐字归档，本次据该归档核对，
  不属未读证据。

## 13. 最终结论

- **FINAL_VERDICT: PASS**
- **P0 0 / P1 0 / P2 8**（7 项 open：T013-P2-1、T013-P2-2、T011-P2-1、
  T012-P2-1、T012-P2-2、T012-P2-3、T012-P2-4；1 项已裁决保留：T007-P2-2）
- **建议：** T013 通过，可进入 T014。7 项 open P2 均为记录级/妆容级，
  不阻塞冻结；其中 T012-P2-1/P2-4 与 T013-P2-1/P2-2 宜在 T014 前或后
  由独立修复任务处理并重审对应范围；T009 可选项 4/5 已正式登记为不做；
  上游遗留决策维持不变，由终审定。
