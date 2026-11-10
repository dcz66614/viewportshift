# P021 T013 — 审查索引（REVIEW_INDEX.md）

- 审查员：独立审查会话（与施工方不同会话）
- 审查对象：commit `fff40cb`（`fff40cb82f971fca384a822401b5934de57d38a8`）
- 审查时间：2026-11-10 ~11:02–11:20 GMT
- 结论：**FINAL_VERDICT: PASS**（P0 0 / P1 0 / P2 8，其中 7 项 open、1 项已裁决保留）
- 本文件说明审查了哪些证据（文件 + 字节数）、哪些证据无法读取。
  审查产出文件清单与哈希见 `sha256.txt`。

## 1. 已审查的证据

### 1.1 源文件（22/22 READ，见 COVERAGE_MATRIX.csv）

| 文件 | 字节数 | 审查方式 |
|---|---|---:|
| src/App.tsx | 184 | 全文通读 |
| src/cli.ts | 7,549 | 全文通读 |
| src/domain/analysis-status.ts | 1,523 | 全文通读 |
| src/domain/bfs.ts | 26,983 | 全文通读 |
| src/domain/events.ts | 23,111 | 全文通读 |
| src/domain/geometry-eval.ts | 13,322 | 全文通读 |
| src/domain/geometry.ts | 27,658 | 全文通读 |
| src/domain/modes.ts | 21,821 | 全文通读 |
| src/domain/types.ts | 13,399 | 全文通读 |
| src/domain/validate.ts | 25,402 | 全文通读 |
| src/domain/viewport-state.ts | 15,903 | 全文通读 |
| src/io/demo.ts | 2,246 | 全文通读 |
| src/io/json.ts | 21,037 | 全文通读 |
| src/io/report.ts | 16,411 | 全文通读 |
| src/main.tsx | 213 | 全文通读 |
| src/node-shims.d.ts | 1,304 | 全文通读 |
| src/render/timeline.tsx | 4,433 | 全文通读 |
| src/render/viewportSvg.tsx | 7,036 | 全文通读 |
| src/ui/App.tsx | 19,844 | 全文通读 |
| src/ui/WitnessPanel.tsx | 4,719 | 全文通读 |
| src/ui/scenario.ts | 14,154 | 全文通读 |
| src/ui/styles.css | 1,883 | 全文通读 |

### 1.2 Python Oracle（抽查关键分支与导入关系）

| 文件 | 字节数 | 审查方式 |
|---|---|---:|
| oracle/python/modes_oracle.py | 55,634 | 抽查：KEYBOARD_CLOSE 分支、合同检查、导入 |
| oracle/python/events_oracle.py | 65,384 | 抽查：KEYBOARD_CLOSE 分支、头注决策说明 |
| oracle/python/geometry_oracle.py | 29,621 | 抽查：与 TS S0 几何的一致性说明 |
| oracle/python/geometry_full_oracle.py | 22,758 | 抽查：`from modes_oracle import`（第 83 行）、矩形几何独立实现 |
| oracle/python/bfs_oracle.py | 20,228 | 抽查：同侧 Oracle 导入（第 66–73 行）、搜索独立实现 |

### 1.3 测试与证据文件

| 文件 | 字节数 | 审查方式 |
|---|---|---:|
| evidence/s0/S0_GATE.json | 37,014 | 核对 status PASS 与 gateSha256（重跑后不变） |
| evidence/coverage/ORACLE_PARITY_REPORT.json | 2,713 | 全文：layeringNote 与 parity 数字 |
| evidence/e2e/E2E_TEST.json | 4,593 | 全文：外部请求、导出哈希、Tab 遍历、windowsTested |
| evidence/e2e/downloads/UI-chat-input-resizes-content.viewportshift.json | （见磁盘） | 哈希核对 `98f83754…`；确认 rv 导出文件缺失 |
| evidence/e2e/e2e-main-flow.png | 245,449 | 目视 |
| evidence/e2e/e2e-keyboard-visible.png | 307,510 | 目视 |
| evidence/e2e/e2e-tab-focus-export.png | 219,742 | 目视 |
| evidence/offline/OFFLINE_TEST.json | 1,056 | 全文：三腿外部请求、静态扫描 |
| evidence/performance/PERFORMANCE_TEST.json | 1,295 | 全文：门槛与实测中位数复算 |
| evidence/release-rehearsal/RELEASE_MANIFEST.json | 1,332 | 全文；与 REHEARSAL `cmp` 比对 |
| evidence/release-rehearsal/RELEASE_REHEARSAL.json | 1,332 | 全文；dist 清单与 demo 哈希核对 |
| evidence/release-rehearsal/SHA256SUMS.txt | 364 | 逐项核对 4 条 dist 哈希 |

### 1.4 交接与规格文件

| 文件 | 字节数 | 审查方式 |
|---|---|---:|
| P021_IMPLEMENTATION_PLAN.md | 20,238 | 全文：T013 任务卡、通过标准、§6 哈希合同 |
| handoff/T011/REVIEW_P2_REGISTER.md | 16,755 | 全文：§A 逐字原文、§B 处理登记、§C 非逐字标注、§D 移交 |
| handoff/T012/REVIEW.md | 18,796 | 全文：7 条验收重跑、4 项 P2、截图与修复核查 |
| handoff/T012/sha256.txt | （见磁盘） | `sha256sum -c` 复现：仅 2 份性能证据 FAILED |
| tests/fixtures/golden/（24 个） | — | 探针统计：0/24 含节点数字段 |
| tests/fixtures/bfs/（15 个） | — | 探针统计：15/15 含节点数字段 |
| tests/fixtures/events/events-rv-open-pan-close-retained.json | — | 核对保留偏移终值 |
| tests/fixtures/geometry/（34 个） | — | 探针统计：与 golden 合计 58 夹具 / 50 步骤 / 0 INVALID |

### 1.5 审查员亲自跑的命令（日志见 test_logs/）

`npm ci`、`npm run typecheck`、`npm test`、`npm run test:oracle`、
`npm run test:e2e`、`npm run test:offline`、`npm run release:verify`、
`npm run s0:gate`、`npm run build`、`node dist/viewportshift.mjs demo`、
独立探针 `test_logs/probe-corpus-p2-5.mjs`。全部 exit 0（探针输出：
`corpus fixtures=58 steps=50 INVALID=0 UNKNOWN=0`；
`golden fixtures=24 with nodesVisited+nodesEnqueued=0`；
`bfs fixtures=15 with nodesVisited+nodesEnqueued=15`）。

## 2. 无法读取的证据（明确列出）

1. **T009 独立审查 8 项 P2 的逐字原文**：`handoff/T009/` 内无 `REVIEW.md`；
   `handoff/T011/REVIEW_P2_REGISTER.md` §C 已如实标注逐字文本不在仓库快照中。
   审查员只核对了协调员摘要提示的三点（顶栏状态、时间轴行状态、result===null
   短暂窗口），其余 5 项**原文缺失、无法逐项核对**，未编造逐字文本。
   如终审持有 T009 审查原文，请提供后补核。
2. **T007 / T008 独立审查报告原文**：`handoff/T007/`、`handoff/T008/` 内无
   `REVIEW.md`。但其 P2 已由 `REVIEW_P2_REGISTER.md` §A 逐字归档，
   本次据该归档逐项核对，故不属未读证据，仅在此注明出处形式。
3. **T012 审查员重跑日志**（`/tmp/review-t012/`，临时目录，不进仓库）：
   未读取；本次全部数字均为审查员亲自重跑所得，不依赖该日志。

除上述外，本次审查需要读取的证据均已读取。
