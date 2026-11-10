# P021 T011 — Golden/变异/属性/Oracle 差分测试｜任务报告

- **任务：** P021 ViewportShift T011（S4），只做 T011，不碰 T012–T014、不碰其他任务
- **工作目录：** `~/workspace/p021-viewportshift/`；基线 HEAD `b540c10`（T010 已 PASS），工作树干净
- **规格：** `~/workspace/P021_PROJECT_BOOK.md`（SHA-256 前 8 位 `8070d7e3`）、`~/workspace/P021_IMPLEMENTATION_PLAN.md`（SHA-256 前 8 位 `458cd409`）
- **固定 seed：** `P021-VIEWPORTSHIFT-S0-2026-11-10`
- **状态：** ✅ 全部验收命令 exit 0（见 §5）；未 git commit（由协调员统一提交）；未 push；未写 Drive；未对外发消息
- **模型路线：** 本任务全部由 Muse 自行编写与验证，未调用任何外部模型（WorkBuddy 自 06:31 起不通，Qoder 同在 Sam 电脑上；Copilot 桥 /health 在任务开始时为 ok:true，但本次工作无需模型调用，未使用）

## 1. 做了什么

### 1.1 新夹具（手算期望值，冻结后不再改动）

| 目录 | 内容 |
|---|---|
| `tests/fixtures/golden/`（24 个） | 三模式 × 四模板单键盘展开（12 个）+ 延迟平移/平移后关闭/滚动/零键盘/满键盘/负向平移/平移后稳定（8 个）+ fail-closed（未知模式、scale=2、零面积、时钟倒退，4 个）。每个夹具含手算的几何期望（终态 metrics、触发谓词、步数）与 BFS 期望（状态、见证事件、失败谓词、limitReached、保留 limits） |
| `tests/fixtures/bfs/`（新增 4 个） | T008 P2-3：`initial-state-rv-chat.json`、`initial-state-rc-search.json`（初始态谓词分支，witness 为空、`firstFailedStepIndex: -1`）、`prefix-trigger-oc-chat.json`、`prefix-trigger-rv-chat.json`（前缀触发分支）。文件名刻意不以 `bfs-` 开头，`test:bfs` 仍只计 11 个 T008 夹具，277 数不变 |
| `tests/fixtures/mutations/`（8 个） | 变异定义（目标文件 + 精确 find/replace + 检出夹具）：M01 三重交集→成对交集、M02 bottomGap 变号、M03 rv 关闭重置偏移、M04 字母表顺序互换、M05 去重键改为朴素求和、M06 可见面积不扣遮挡、M07 平移夹紧为 0、M08 BFS 深度差一 |
| `tests/fixtures/properties/`（7 个） | 属性定义：不变和、比率下取整、确定性、BFS 最短性、fail-closed、平移夹紧、随机场景 Oracle parity |

### 1.2 新脚本与新 Oracle

| 文件 | 内容 |
|---|---|
| `oracle/python/bfs_oracle.py`（新建，T008 P2-1） | 独立 Python BFS Oracle：搜索逻辑（字母表、长度优先队列、全状态去重键、前缀处理、深度/节点上限、fail-closed limits）按契约独立实现，不导入/调用任何 TS；单步过渡与矩形几何复用同侧 Python Oracle（与 `geometry_full_oracle.py` 复用 `modes_oracle.py` 的分层对称）。CLI `--files/--out/--repeat` 与其余 Oracle 一致 |
| `scripts/t011-lib.mjs`（新建） | T011 共享库：domain 内存转译加载（含变异用的临时副本覆盖机制，磁盘源码永不被变异）、夹具加载、独立指标重推导、Golden/BFS 共享检查器、Python Oracle 调用 |
| `scripts/test-golden.mjs`（新建，`test:golden`） | 24 个 Golden：手算期望逐项比对 + runner 侧独立重推导终态指标 + 见证经几何评估重放复核 |
| `scripts/test-property.mjs`（新建，`test:property`） | 固定 seed 属性测试（mulberry32 PRNG 由 seed 字符串派生；`--seed` 必须等于冻结 seed，否则拒绝） |
| `scripts/test-mutation.mjs`（新建，`test:mutation`） | 变异测试：先跑未变异基线（必须全过，否则中止），再逐个变异在临时副本上跑 Golden + BFS 全集；find 必须恰好出现一次；跑后校验磁盘源码字节不变 |
| `scripts/oracle-diff-coverage.mjs`（新建，`oracle:diff:coverage`） | 覆盖集差分：依次跑通三个既有 diff（modes 41 / events 27 / geometry 34），再做 BFS 覆盖差分（39 夹具：11 T008 + 4 分支 + 24 Golden）与 Golden 几何差分（24 夹具）；写出 `evidence/coverage/ORACLE_PARITY_REPORT.json` |
| `scripts/test-oracle.mjs`（新建，`test:oracle`） | 四个 Oracle diff 的聚合入口 |
| `scripts/test-coverage.mjs`（新建，`test:coverage`） | 覆盖集聚合入口：先做 P2 验证段（§4），再跑 Golden + 属性 + Oracle + 变异 |
| `scripts/test-all.mjs`（新建，`npm test`） | 全量测试套件：全部已有 `test:*` 脚本 + 本任务新增的全部测试脚本 |
| `package.json` | 只加 7 个脚本（`test`、`test:golden`、`test:property`、`test:oracle`、`test:mutation`、`test:coverage`、`oracle:diff:coverage`）；依赖不变；保持原 pretty 格式 |

### 1.3 P2 处理（共 10 项，8 修 + 1 接受备案 + 1 登记 T013）

| 编号 | 处理 | 证据 |
|---|---|---|
| T008 P2-1 Python BFS parity | **已修**：见 §1.2 `bfs_oracle.py`；39 夹具 TS/Python 逐字段一致，含最短性（witness 长度与暴力枚举一致，属性测试另有 30 组随机最短性验证）、tie-break、BOUNDED_NO_WITNESS 边界 | `evidence/coverage/ORACLE_PARITY_REPORT.json`（bfsCoverage 39/39） |
| T008 P2-2 fail-closed limits 区分 | **已修**：`src/domain/bfs.ts` 新增 `limitsFromRawInput`；逐字段保留合法 limits，非法字段回退默认并记入 `limitsFallbackReason`（与 Python Oracle 字符串完全一致）；`validationIssues` 中仍有 `invalid_limits`/`missing_field` 原因。`test:bfs` 277/277、`test:bfs:determinism` 4/4 不变（该 runner 不断言 fail-closed 的 limits 值；基线已核实） | `test:coverage` P2 验证段 4 组回退用例 + TS/Python 对照；`evidence/bfs/BFS_TS.json` 分析哈希变为 `c457c9db…`（仅 fail-closed 结果变化：limits 由默认 8 恢复为夹具的 3，并新增 `limitsFallbackReason: null`） |
| T008 P2-3 初始态/前缀分支 fixture | **已修**：见 §1.1，4 个新夹具 | Golden/BFS 覆盖差分 39/39 |
| T008 P2-4 bfs.ts 头注修正 | **已修**：只改注释。原文（git HEAD 第 47–50 行）称碰撞对为 depth-2 且“witness 被找到”；按 T008 报告 §3 修正为 depth-3 碰撞对（A=`[OPEN150, OPEN150, OPEN300]`、B=`[OPEN150, PAN300, PAN-300]`），且 dedup fixture 本身为 BOUNDED_NO_WITNESS、无 witness | `src/domain/bfs.ts` 头注 |
| T007 P2-2 geometry-eval.ts 死代码分支 | **登记到 T013，未改代码**：静态论证——经 T004 校验的场景 surface 宽/高恒为正整数，`computeMetrics` 在场景重放中永不返回 INVALID，故 `evaluateScenarioGeometry` 内的 INVALID 步分支不可达；冻结语料观测：几何 + Golden 全部 58 个夹具、50 个步骤中 INVALID 步为 0（`test:coverage` P2 验证段）；直接夹具的 INVALID 由 `evaluateDirectGeometry` 覆盖，不走该分支 | `handoff/T011/unresolved_items.md` 第 1 条 |
| T007 P2-1 Python Oracle 分层 | **接受现状，备案**：未改任何 Oracle 文件既有逻辑；备案见报告的 `layeringNote` | `evidence/coverage/ORACLE_PARITY_REPORT.json` |
| T010 P2-1 信封完整性 | **已修**：`src/io/json.ts` 新增纯 TS SHA-256（`sha256HexPure`，FIPS 180-4，无新依赖、无 Node 内建导入，浏览器可用；已对 Node crypto 校验 6 组输入，含空串、长串、多字节、Demo 场景 JSON）；`exportResultJson` 重算 `scenarioSha256` 并比对，不一致返回 `import_hash_mismatch` 拒绝导出 | `test:export` 136/136；demo 哈希不变；`test:coverage` P2 验证段含篡改哈希/篡改 mode 拒绝用例 |
| T010 P2-2 deriveAnalysisStatus 复刻 | **已修**：新建 `src/domain/analysis-status.ts`，CLI 与 UI 共用同一纯函数；行为一字未变（状态只由几何评估派生，故永不返回 BOUNDED_NO_WITNESS——BFS 状态另在见证面板/信封中报告）；`scripts/t010-lib.mjs` 与 `scripts/test-ui.mjs` 的加载清单已同步加入新模块 | `test:ui` 202/202、`test:export` 136/136、demo 哈希不变 |
| T010 P2-3 @ts-ignore | **已修**：新建 `src/node-shims.d.ts`（仅覆盖 CLI 用到的三个 Node 内建的最小本地类型声明），去掉 `src/cli.ts` 三处 ignore 指令；未新增任何依赖；`src/` 与 `scripts/` 内已无该指令字面 | `typecheck` exit 0、`build` exit 0 |
| T010 P2-4 可追溯性缺口 | **已修**：`handoff/T011/REVIEW_P2_REGISTER.md`——§A 为 T007/T008/T009/T010 交接文件逐字原文（程序抽取，未手抄），§B 为 10 项处理登记，§C 明确标注原文不在仓库快照中的部分为“协调员摘要，非逐字原文”，未编造任何逐字文本 | 本交接包 |

### 1.4 上游遗留决策

维持未动：`resizes-visual` 下 KEYBOARD_CLOSE 只恢复 visualHeight、不重置 visualOffsetTop。T011 未改动冻结 Oracle 与 modes/events/bfs/UI 行为；此决策留待 T013/终审复核。变异 M03 专门钉住该行为（临时副本上改掉后即被 Golden-rv-chat-pan-close 检出）。

## 2. 验收结果（全部 exit 0，日志在 `handoff/T011/test_logs/`）

主验收（任务卡）：

| 命令 | 结果 |
|---|---|
| `npm test` | **PASS**：15 个子套件全绿（见下表逐项数） |
| `npm run test:property -- --seed P021-VIEWPORTSHIFT-S0-2026-11-10` | **PASS — 709 checks，0 失败**（7 个属性：不变和 200、比率下取整 200、确定性 60、BFS 最短性 30、fail-closed 40、平移夹紧 120、随机 Oracle parity 40，另有 19 项夹具/种子检查） |
| `npm run test:oracle` | **PASS**：modes 41/41、events 27/27、geometry 34/34、BFS 覆盖 39/39、Golden 几何 24/24 |
| `npm run test:mutation` | **PASS — 31 checks，0 失败；8/8 变异检出**（M01–M08 全部被杀死，无存活变异；基线先行通过；磁盘源码跑后字节不变） |

协调员点名的验收命令：

| 命令 | 结果 |
|---|---|
| `npm run test:coverage` | **PASS**：P2 验证段 33/33 + Golden 107 + 属性 709 + Oracle（98+70+86+24）+ 变异 31 |
| `npm run oracle:diff:coverage` | **PASS — 覆盖 parity 165/165（100%）**：modes 41 + events 27 + geometry 34 + BFS 覆盖 39 + Golden 几何 24，mismatches 0；报告在 `evidence/coverage/ORACLE_PARITY_REPORT.json` |

逐项检查数（`npm test` 内）：test:schema 259、test:validation 273、test:modes 1159、test:events 1301、test:event-order 22、test:geometry 629、test:bfs 277、test:bfs:determinism 4、test:ui 202、test:export 136、test:golden 107、test:property 709、test:oracle（98+70+86+24）、test:mutation 31、test:coverage（聚合重跑，数字同上）。

## 3. 回归（与基线一字不差）

| 命令 | 结果 |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run build` | exit 0（`dist/viewportshift.mjs` 75.94 kB；CLI 体积变化只因新增的共享函数与纯 TS SHA-256——Web 应用产物未变，见 demo 哈希） |
| `node dist/viewportshift.mjs demo` | exit 0；`resultSha256=88f2153afd19cd19659d48587b7a98286621fff7ca9ae37cec0de6a4e50f6b60`、`reportSha256=f329e8144a234eb46e6eea71dc04fc222e63dec44f3f66192b6c0bf0128d90b8`、见证长 1——与基线完全一致 |
| `npm run s0:gate` | **PASS — 120/120**（53/53 parity、12/12 植入检出、0 误报、100 次 1 哈希）；gateSha256 `65b4b32f4a5298642fd3de5a64441ed7d214e2519d118b8b67a7871ba73aca26` 保持不变；`evidence/s0/S0_GATE.json` 未改动 |

## 4. 工作中发现并已修正的问题（共 3 个，如实记录；均为测试/夹具侧问题，非产品缺陷）

1. **Golden BFS 预期手算错误两处（已按代码语义重新推导后修正夹具，非改预期迎合实现）：** (a) `golden-oc-search-open`：我原以为 overlays-content 下平移可使搜索栏失焦，但 `maxTop = layoutHeight - visualHeight`，oc 下 visualHeight = layoutHeight，故 maxTop = 0，平移恒被夹紧为 0，BFS 应为 BOUNDED_NO_WITNESS；(b) `golden-rc-chat/sheet/cta-open`：我原以为 CLOSE+OPEN150 可触发，但 resizes-content 下表面随布局视口收缩（OPEN 后表面底边恒等于布局高），几何恒完美，BFS 应为 BOUNDED_NO_WITNESS。两处均经重读 `viewport-state.ts` 平移夹紧与 `modes.ts` rc OPEN 算式确认，TS 与 Python Oracle 在此后 39/39 一致。
2. **变异 M01/M02/M06 打在错误函数上（已改到场景路径）：** 初版变异改的是 `computeGeometryDirect`（仅直接夹具用），场景重放走 `computeGeometry`，三变异存活；改到 `computeGeometry` 对应位置后全部被检出。教训：变异目标必须是被测路径实际调用的函数。
3. **`test:export` 一度 135/136（已修正）：** 我在 `src/io/json.ts` 注释中写了 `node:crypto` 字面，触发 io 层禁用词扫描（`node:`）；按 T010 的既有做法改写注释后恢复 136/136。另：`test:coverage` P2 验证段初版 5 项失败，均为验证代码自身的错误（非法 limits 属 INVALID 而非 UNKNOWN；信封测试误用含 `expected` 的原始夹具而非规范化场景；cli.ts 头注残留指令字面），已修正验证代码，产品代码未动。

## 5. 与计划/项目书的偏差

- **无。** 任务卡要求的输出（`tests/fixtures/golden/`、`mutations/`、`properties/`、`evidence/coverage/ORACLE_PARITY_REPORT.json`）与六条验收命令全部交付；通过标准（S0 48/48、Oracle parity 100%、12/12 植入检出、0 误报、正负边界样本、unsupported 不假 PASS、全部验收命令 exit 0）全部满足。
- **两处说明（非偏差）：** (a) `evidence/bfs/BFS_TS.json` 与 `BFS_DETERMINISM.json` 的分析哈希由 `a55d28a9…` 变为 `c457c9db…`——这是 P2-2 的预期结果（fail-closed 结果现保留夹具 limits 并新增 `limitsFallbackReason` 字段），不是回归；(b) `test:coverage` 除聚合四项外，另含一段 P2 验证（P2-2/P2-5/P2-7/P2-8/P2-9 的直接断言，33 项），因这些修复在既有套件中无专属归宿；聚合本身仍为 Golden + 属性 + Oracle + 变异。

## 6. 证据与交接

- 证据：`evidence/coverage/ORACLE_PARITY_REPORT.json`、`GOLDEN_TEST.json`、`PROPERTY_TEST.json`、`MUTATION_TEST.json`、`BFS_PY.json`、`GOLDEN_PY.json`
- 交接包：`handoff/T011/`（本报告、`REVIEW_P2_REGISTER.md`、`changed_files.txt`、`test_commands.txt`、`test_logs/` 10 份日志、`sha256.txt`（69 个文件，`sha256sum -c` 全 OK）、`unresolved_items.md`）
- 日志：`handoff/T011/test_logs/`，10 条命令 exit 均为 0
