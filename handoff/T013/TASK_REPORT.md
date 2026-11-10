# P021 T013 — 任务报告（独立复核）

- 任务：P021 ViewportShift T013 独立复核（S5）
- 审查员：独立审查会话（与 T001–T012 施工方不同会话；未参与施工）
- 审查对象：commit `fff40cb`（`fff40cb82f971fca384a822401b5934de57d38a8`）
- 工作目录：`~/workspace/p021-viewportshift`
- 审查时间：2026-11-10 ~11:02–11:20 GMT
- 结论：**FINAL_VERDICT: PASS**（P0 0 / P1 0 / P2 8，其中 7 项 open、1 项已裁决保留）

## 1. 验收命令（审查员亲自逐条跑，日志见 test_logs/）

| # | 命令 | 退出码 | 实测结果 |
|---|---|---:|---|
| 1 | `npm ci` | 0 | added 69 packages in 2s |
| 2 | `npm run typecheck` | 0 | 无输出，干净 |
| 3 | `npm test` | 0 | 全绿（schema 259、validation 273、modes 1159、events 1301、event-order 22、geometry 629、bfs 277、bfs:determinism 4、ui 202、export 136、golden 107、property 709、mutation 31；oracle diffs 98/70/86/165；coverage P2 验证 33/33） |
| 4 | `npm run test:oracle` | 0 | modes 98（parity 41/41）、events 70（27/27）、geometry 86（34/34）、coverage 165/165（100%） |
| 5 | `npm run test:e2e` | 0 | 55 passed, 0 failed；0 外部请求；real-blob-download；Tab 17 stops |
| 6 | `npm run test:offline` | 0 | 26 passed, 0 failed；三腿 0 外部请求 |
| 7 | `npm run release:verify` | 0 | 15 passed, 0 failed；两次预演构建哈希一致；dist 清单 4 文件 |

补充重跑：`npm run s0:gate` exit 0（120/120 PASS；gateSha256
`65b4b32f4a5298642fd3de5a64441ed7d214e2519d118b8b67a7871ba73aca26` 不变）；
`npm run build` exit 0；`node dist/viewportshift.mjs demo` exit 0
（status=FAIL；resultSha256 `88f2153afd19cd19659d48587b7a98286621fff7ca9ae37cec0de6a4e50f6b60`；
reportSha256 `f329e8144a234eb46e6eea71dc04fc222e63dec44f3f66192b6c0bf0128d90b8`；
witnessLength=1）。本次未跑 `test:performance`（不在 7 条验收命令内），
未改写性能证据文件。

## 2. 审查方法

- 通读 22 个源文件全文（100% READ，见 `COVERAGE_MATRIX.csv`）；
  抽查 5 个 Python Oracle 文件的关键分支与导入关系；
  抽查 tests/fixtures 关键夹具（golden 24、BFS 15、events 保留偏移夹具、geometry 34）。
- 独立探针 `test_logs/probe-corpus-p2-5.mjs`：冻结语料 58 夹具 / 50 步骤 /
  INVALID 步 0；golden 0/24 含节点数字段、BFS 15/15 含节点数字段。
- `git status/diff` 核对改动范围；`sha256sum -c` 核对 `handoff/T012/sha256.txt`；
  目视 3 张 E2E 截图；核对 `REVIEW_P2_REGISTER.md` 与 T012 `REVIEW.md` 的逐项登记。
- 审查员未修改任何源码、夹具、Oracle 或证据文件；未 commit；未 push；
  未碰 GitHub/Drive；未对外发消息。开始与结束时 `git status` 均干净
  （除新增 `handoff/T013/`）。

## 3. 结论与 P2 清单（详见 INDEPENDENT_REVIEW.md §3）

- P0 0 / P1 0 / P2 8（7 项 open + 1 项已裁决保留）。
- 新 P2：T013-P2-1（时间轴行状态忽略 `GeometryStep.status`）、
  T013-P2-2（`result === null` 短暂窗口默认 UNKNOWN 标签）。
- 承接 open：T011-P2-1（Golden 缺节点数）、T012-P2-1（性能证据哈希再生）、
  T012-P2-2（E2E 下载缺 rv 导出文件）、T012-P2-3（性能门槛下限主导）、
  T012-P2-4（发布预演 manifest 双份相同）。
- 已裁决：T007-P2-2（INVALID 步分支）——**保留为防御性代码，不删除**。
- T010 四项 P2 逐项代码核对，全部已修属实；T007 P2-1 分层接受成立；
  T009 三点可验证项已核对（顶栏状态非缺陷；其余两点即 T013-P2-1/P2-2）；
  T009 可选项 4/5 正式登记为不做；上游遗留决策建议维持。
- 隐私与诚实性：本地运行、0 外部请求、非认证声明、Windows NOT_TESTED，全部通过。
- T014 冻结尚不具备条件：`scripts/deterministic_zip.py` 不存在，
  `package.json` 无 `release:freeze` 脚本，`release/` 目录不存在——属 T014
  工作范围，不是 T013 缺陷项。

## 4. 产出文件（全部在 handoff/T013/，未 commit）

- `INDEPENDENT_REVIEW.md`（23,658 字节）：审查报告全文，verdict PASS
- `COVERAGE_MATRIX.csv`（2,172 字节）：22 个源文件，全部 READ
- `REVIEW_INDEX.md`：审查索引（已读证据 + 无法读取的证据）
- `REVIEW_PACK_01.md`（3,321 字节）：域核心
- `REVIEW_PACK_02.md`（3,612 字节）：几何 + BFS + Oracle
- `REVIEW_PACK_03.md`（2,707 字节）：IO / CLI / 导出 / 离线报告
- `REVIEW_PACK_04.md`（5,100 字节）：UI / 渲染 / 见证面板（含截图目视）
- `REVIEW_PACK_05.md`（4,286 字节）：测试 / 证据 / 隐私 / 发布预演
- `TASK_REPORT.md`：本文件
- `test_commands.txt`：亲自跑过的命令与结果
- `sha256.txt`：关键文件哈希
- `test_logs/`：10 条命令日志 + 独立探针脚本
- `unresolved_items.md`：未解决项（7 项 open P2 + 登记事项）

## 5. 与计划/项目书的偏差

无。审查按 `P021_IMPLEMENTATION_PLAN.md` §5 T013 任务卡执行；通过标准
（P0/P1 = 0、Oracle parity 100%、false PASS = 0、源文件覆盖率 100%、
每文件标记 READ/NOT_READ、审查者与构建者不同会话、不能读取的证据明确列出）
全部满足。唯一诚实记录的偏差：T009 审查 8 项 P2 的逐字原文不在仓库快照中，
其余 5 项无法逐项核对（见 `INDEPENDENT_REVIEW.md` §7 与 `REVIEW_INDEX.md` §2），
审查员未编造。
