# P021 T008 — 最短失败序列搜索（有界 BFS）任务报告

- 任务：T008（S2），只做 T008，不碰 T009 及以后。
- 工作目录：`~/workspace/p021-viewportshift/`；基线 HEAD `df5f323`（T007），工作树未提交，改动全部留在工作树。
- 模型路线：本任务全部由 Muse 自行编写与验证，未调用任何外部模型（WorkBuddy/Qoder 反代不通，Copilot 桥未使用）。
- 验收：`npm run test:bfs` **PASS（277 checks，0 failures）**；`npm run test:bfs:determinism` **PASS（4 checks，0 failures）**；`npm run typecheck` exit 0。
- 回归：S1 全部 7 条 + T007 两条 + `s0:gate` 全部通过，gate 哈希保持不变（见 §5）。

## 1. 交付

### 1.1 新建 `src/domain/bfs.ts`（BFS_VERSION `bfs/v1`）

复用 T007 正式入口 `geometry-eval.ts`（`evaluateScenarioGeometry` 用于前缀重放，`computeMetrics`/`evaluatePredicates` 用于每步几何与谓词）与 T006 `evaluateEventTransition` 做单步转移；**没有第二套几何**。导出 `searchBfs`（schema-first 入口）、`searchBfsScenario`、`BFS_ALPHABET`、`buildBfsEvent`、`stateKeyFor`、`canonicalBfsJson`。

### 1.2 冻结语义（项目书 §4.5 逐字遵守，见 `evidence/bfs/SEARCH_BOUNDS_REPORT.md`）

- **any-step 语义**：谓词在每一步后都求值（含初始态 depth 0 与输入前缀的每一步），首个失败步即命中。这与 S0 场景 verdict 的终态语义不同——S0 的 12 个 open-close 正常场景终态 PASS 但中间瞬时失败，BFS 会把瞬时失败当作见证。报告与代码头注均已明确区分。
- **长度优先 + 冻结 tie-break**：按长度递增探索；同长度按字母表顺序（事件类型顺序，再按参数数值排序：dx 升序、dy 升序）。生成事件 id 为 `bfs-<step>-<slug>`，由该顺序确定性派生，同一序列 id 唯一。witness 含完整事件序列、首个失败谓词、每步前后状态/表面矩形/几何指标，全部可复算。
- **冻结字母表（12 个候选事件）**：`KEYBOARD_OPEN` {150000, 300000}；`KEYBOARD_CLOSE`；`SCROLL` {(-100000,0), (0,-100000), (0,100000), (100000,0)}；`DELAYED_VISUAL_PAN` dx=0、dy ∈ {-300000, -100000, 100000, 300000}；`VIEWPORT_SETTLED`。生成事件间隔 100 ms，从前缀末尾（或 0）延续。PAN 的 dx 只取 0：visualWidth 恒等于 layoutWidth，maxLeft 恒为 0，任何非零 dx 平移都会被夹紧为 applied 0，是几何惰性分支，只会复制状态，故不纳入字母表（报告中有说明）。
- **去重键 = 完整 ViewportState 规范化 JSON（全部 13 个字段，含 eventClock/scroll/pendingPan）**：两状态仅当全部字段相同时才共享键，不同可观察几何状态永不合并。这是保守选择——仅 clock/scroll/pendingPan 不同的几何等价态会被分别保留（多耗节点，不错并）。
- **上限**：maxDepth/maxNodes 取场景 `limits`（默认 8/10000，见 `DEFAULT_LIMITS`）。队列耗尽 → `BOUNDED_NO_WITNESS` + `limitReached: "depth"`；节点预算先耗尽 → 同状态 + `limitReached: "nodes"`。两种情况都不声称全空间安全。命中为 status `FAIL`。超范围输入 fail-closed：`scale≠1` → `UNKNOWN`（`unsupported_scale`）、未知模式 → `UNKNOWN`（`unsupported_mode`）、零面积 → `INVALID`（`zero_area_surface`）。
- **前缀**：输入场景自身的 `events`（通常为空）视为固定前缀，先重放并逐步骤检查，再由 BFS 扩展；witness 包含前缀步（fixture `bfs-prefix-rv-sheet` 覆盖）。

## 2. Fixtures（`tests/fixtures/bfs/`，11 个）

| Fixture | 模式/布局 | 结果 | 说明 |
|---|---|---|---|
| `bfs-1step-oc-chat` | overlays-content / chat-input，`keyboardObscuredArea > 0` | FAIL，witness `[OPEN150]`（visited 1 / enqueued 1） | 1 步 golden；同时是同长度 tie-break：OPEN150 先于 OPEN300 |
| `bfs-1step-rc-search` | resizes-content / search-bar（顶锚），`bottomGap < 500000` | FAIL，witness `[OPEN300]`（1 / 2） | 覆盖 resizes-content；OPEN150 的 gap 为 634000 不触发 |
| `bfs-2step-rv-sheet` | resizes-visual / bottom-sheet，`keyboardObscuredArea > 0` | FAIL，witness `[OPEN150, PAN(0,100000)]`（2 / 11） | 2 步 golden；PAN 100000 先于 PAN 300000（同长度 tie-break） |
| `bfs-3step-rv-chat` | resizes-visual / chat-input，`bottomGap > 200000` | FAIL，witness `[OPEN300, PAN(0,300000), CLOSE]`（17 / 63） | 3 步 golden；需 CLOSE 保留偏移才使 gap 达 300000，depth ≤2 无解 |
| `bfs-prefix-rv-sheet` | resizes-visual / bottom-sheet，前缀 `[OPEN150 (e1)]` | FAIL，witness `[e1, PAN(0,100000)]`（1 / 6） | 前缀重放 + 扩展 |
| `bfs-bounded-rc-sheet` | resizes-content / bottom-sheet，4 谓词，maxDepth 3 | `BOUNDED_NO_WITNESS`，limit `depth`（40 / 40） | rc 下几何恒完美（gap 0、drift 0、ratio 1000、obscured 0），深度耗尽 |
| `bfs-bounded-nodes` | 同上，maxDepth 8，maxNodes 5 | `BOUNDED_NO_WITNESS`，limit `nodes`（1 / 5） | 节点预算恰好在 5 处耗尽 |
| `bfs-dedup-rv-sheet` | resizes-visual / bottom-sheet，`anchorDriftMagnitude > 500000`（恒不触发） | `BOUNDED_NO_WITNESS`，limit `depth`（74 / 74） | 去重回归（见 §3） |
| `bfs-unknown-scale` | profile.scale=2 | `UNKNOWN`（`unsupported_scale`） | 超出支持范围 |
| `bfs-unknown-mode` | mode=`pinch-zoom` | `UNKNOWN`（`unsupported_mode`） | 超出支持范围 |
| `bfs-invalid-zero-area` | layout heightMilli=0 | `INVALID`（`zero_area_surface`） | 结构非法 |

节点数（`nodesVisited`/`nodesEnqueued`）全部 pin 在各 fixture 的 `expected` 中；2-step（2/11）与 3-step visited=17（1 + 5 个 depth-1 节点 + 11 个先出队的 depth-2 节点）已手工验算吻合；bounded-nodes（1/5）与 prefix（1/6）亦然。

三种模式均有 witness：resizes-visual（2 步、3 步、prefix）、resizes-content（1 步）、overlays-content（1 步）。

## 3. 去重回归（`bfs-dedup-rv-sheet`，重点）

- **碰撞对**（runner 用 T007 evaluator 独立重放验证）：A=`[OPEN150, OPEN150, OPEN300]` 与 B=`[OPEN150, PAN300, PAN-300]`，naive 数值字段和均为 **3402300**，但全状态键不同，且几何完全不同——A：visibleRatio 0、bottomGap -300000、drift 300000；B：visibleRatio 500、bottomGap -150000、drift 150000。
- **独立枚举**（runner 自写规范化 key，不用 domain 的 `stateKeyFor`）：depth ≤3 可达的不同状态全键计数 **74**，naive-sum 键计数仅 **34**——naive 键会错误合并 40 个状态。BFS 的 `nodesVisited = nodesEnqueued = 74`，与全键枚举完全一致，证明未错误去重。
- 附带说明：初版 dedup fixture 曾用 `keyboardObscuredArea > 100000000000`，被 T004 冻结校验拒绝（谓词阈值上限为 `MAX_DIMENSION_MILLI` = 10000000，`value_out_of_range`）。这是校验器的正确行为，不是 bug；已改用上述枚举计数设计替代，见 `unresolved_items.md`（无遗留问题，仅记录该次修正）。

## 4. 测试脚本

- `scripts/t008-lib.mjs`：domain 加载（内存转译 types/validate/viewport-state/modes/geometry/geometry-eval/events/bfs）、fixture 加载、规范化哈希（沿用 T007 模式）。
- `scripts/test-bfs.mjs`（`npm run test:bfs`）：277 checks。逐 fixture 校验 status/reason/witness 事件（type/id/atMs/参数）/失败谓词/limitReached/节点数；每步指标用 runner 内独立整数重算（BigInt：不变和、ratio floor、bottomGap 定义、三重交集）核对；witness 经 T007 evaluator 重放复核（逐步骤指标/状态/失败谓词一致）；**最小性与 tie-break 用 runner 自备的独立字母表副本暴力枚举验证**（无更短序列触发；同长度首个触发序列即 golden；3 步 golden 枚举 1728 条长度-3 序列）；深度界 fixture 用穷举到 maxDepth 验证无触发；字母表与 runner 独立字面副本逐项相等；两次完整运行哈希一致；8 个 domain 源无禁用 token（`Date.now`/`setTimeout`/`Math.random`/wall-clock 等）。
- `scripts/test-bfs-determinism.mjs`（`npm run test:bfs:determinism`）：4 checks——两次独立子进程跑 `test:bfs` 哈希一致；dedup fixture 从磁盘重读、搜索 100 次，1 个哈希。
- 证据：`evidence/bfs/BFS_TS.json`（analysisSha256 `a55d28a9b0d73fc83463480e1746c2c3d7bdb15efa7969d873f379ade2869245`）、`evidence/bfs/BFS_DETERMINISM.json`（全跑 2 次 1 哈希；100 次重复 1 哈希 `93d99daf5a40cc1931829fadda59028d69830692903f842be5f94d0def8d1883`）、`evidence/bfs/SEARCH_BOUNDS_REPORT.md`（字母表、离散参数集、深度/节点上限、去重规则、逐 fixture 搜索计数，由 `test:bfs` 从冻结常量生成）。

## 5. 验收与回归（逐项，日志在 `handoff/T008/test_logs/`）

| 命令 | 结果 |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run test:schema` | checks passed: 259, failed: 0 |
| `npm run test:validation` | checks passed: 273, failed: 0 |
| `npm run test:modes` | checks passed: 1159, failed: 0 |
| `npm run oracle:diff:modes` | checks passed: 98, failed: 0；parity 41/41, mismatches 0 |
| `npm run test:events` | checks passed: 1301, failed: 0 |
| `npm run test:event-order` | checks passed: 22, failed: 0 |
| `npm run oracle:diff:events` | checks passed: 70, failed: 0；parity 27/27, mismatches 0 |
| `npm run test:geometry` | checks passed: 629, failed: 0 |
| `npm run oracle:diff:geometry` | checks passed: 86, failed: 0；parity 34/34, mismatches 0 |
| `npm run s0:gate` | checks passed: 120, failed: 0；PASS（53/53 parity、12/12 planted、0 false positives、100 runs / 1 hash）；gateSha256 `65b4b32f4a5298642fd3de5a64441ed7d214e2519d118b8b67a7871ba73aca26`，**与 T007 交付时完全一致** |
| `npm run test:bfs` | checks passed: 277, failed: 0；BFS (TS): PASS |
| `npm run test:bfs:determinism` | checks passed: 4, failed: 0；BFS determinism: PASS |

注：任务书中 `oracle:diff:modes 98` 与 `oracle:diff:geometry 86` 指的是检查数（checks passed），parity 分别为 41/41 与 34/34，与 T005/T007 提交一致，无偏差。

## 6. 与计划/项目书的偏差

1. **无 Python BFS Oracle**：T008 任务卡只要求 `test:bfs` 与 `test:bfs:determinism`；BFS 复用 T007 evaluator（TS/Python parity 已由 `oracle:diff:geometry` 34/34 覆盖），未新建独立 Python BFS Oracle。计划 §6.1 提到的 witness sequence 对照由 runner 的独立暴力枚举 + T007 重放覆盖（见 §4）。如 T011 要求 Python BFS parity，需另开任务。
2. **fail-closed 时的 `limits` 字段**：`searchBfs` 对 INVALID/UNKNOWN 输入返回默认 limits（maxDepth 8 / maxNodes 10000），因输入 limits 本身可能非法、不可信。这是有意选择，记录在案。
3. **初始态谓词**：若谓词在初始态已触发，返回空 witness（`witnessLength: 0`，`firstFailedStepIndex: -1`）。11 个 fixture 均未触发该分支；语义在 `bfs.ts` 头注中冻结。
4. **`package.json`**：仅追加 `test:bfs` 与 `test:bfs:determinism` 两个脚本；文件保持原单行压缩格式（初版误写成缩进格式，已恢复为单行最小 diff）。

## 7. 未解决项

无。见 `unresolved_items.md`（仅记录上述已修正的初版阈值问题与两条说明性备注，无遗留阻塞）。
