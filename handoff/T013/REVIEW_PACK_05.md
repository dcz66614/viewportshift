# P021 T013 — 审查包 05：测试 / 证据 / 隐私 / 发布预演

- 审查员：独立审查会话（与施工方不同会话）
- 审查对象：commit `fff40cb`
- 审查时间：2026-11-10 ~11:02–11:20 GMT
- 本包文件：`package.json`（脚本清单）、`evidence/s0/S0_GATE.json`、
  `evidence/coverage/ORACLE_PARITY_REPORT.json`、
  `evidence/e2e/E2E_TEST.json`、`evidence/offline/OFFLINE_TEST.json`、
  `evidence/performance/PERFORMANCE_TEST.json`、
  `evidence/release-rehearsal/RELEASE_MANIFEST.json` /
  `RELEASE_REHEARSAL.json` / `SHA256SUMS.txt`、
  `handoff/T012/REVIEW.md`（18,796 字节）、`handoff/T012/sha256.txt`、
  `handoff/T011/REVIEW_P2_REGISTER.md`、README.md（抽查）、
  `scripts/test-golden.mjs` / `scripts/t011-lib.mjs`（`checkBfsExpected`）、
  `scripts/test-coverage.mjs`（P2 验证段）

## 所读内容与核对

- 回归基线（审查员亲自重跑，日志见 `test_logs/`）：`npm test` 全绿；
  schema 259、validation 273、modes 1159、events 1301、event-order 22、
  geometry 629、bfs 277、bfs:determinism 4、ui 202、export 136、golden 107、
  property 709、mutation 31；oracle diffs modes 98 / events 70 / geometry 86 /
  coverage 165（parity 41/41、27/27、34/34、165/165）；`s0:gate` 120/120；
  `test:e2e` 55/55；`test:offline` 26/26；`release:verify` 15/15；
  `typecheck` / `build` / `demo` 均 exit 0。详见主报告 §1。
- `ORACLE_PARITY_REPORT.json` 的 `layeringNote` 与本包 02 的分层核查一致；
  T007 P2-1 接受成立。
- `E2E_TEST.json`：`externalRequests: 0`，`export.method: real-blob-download`，
  `export.file: UI-chat-input-resizes-visual.viewportshift.json`，
  `scenarioSha256 = expectedScenarioSha256 = e85dbd57…`，`canonicalRoundTrip: true`，
  Tab 遍历 17 stops，`windowsTested: NOT_TESTED`。
  但磁盘 `evidence/e2e/downloads/` 仅存 Enter 测试的
  `UI-chat-input-resizes-content.viewportshift.json`（`98f83754…`），
  E2E_TEST.json 登记的 rv 导出文件不在磁盘上（T012-P2-2，仍在）。
- `OFFLINE_TEST.json`：三腿外部请求均为 0；静态扫描唯一 `fetch(` 为 Vite
  modulepreload polyfill；URL 字面量仅 5 个已知标识符（4 个 w3.org 命名空间 +
  `https://react.dev/errors/`）；`windowsTested: NOT_TESTED`。
- `PERFORMANCE_TEST.json`：门槛全部为下限（build 120000 / demo 10000 /
  preview 10000 / page load 5000 / 交互 1000 ms）；实测中位数 build 6444 /
  demo 94 / preview 558 / page load 229 / 交互 ~162–165 ms；
  2×中位数均远低于下限，余量 6–102 倍（T012-P2-3，仍在）。
  `sha256sum -c handoff/T012/sha256.txt`：仅此两份性能证据文件 FAILED，
  其余全部 OK——与 T012 审查结论一致；审查员本次未跑 `test:performance`，
  该 FAILED 为 T012 审查员重跑后遗留的已知状态，非本次造成
  （`git status` 全程干净可证）。
- 发布预演：`RELEASE_MANIFEST.json` 与 `RELEASE_REHEARSAL.json` 逐字节相同
  （sha256 均为 `4e5daf55…`，T012-P2-4，仍在）；`SHA256SUMS.txt` 的 4 条 dist
  哈希与 `RELEASE_REHEARSAL.json` 的 dist 清单逐项一致；`buildsIdentical: true`；
  demo 哈希与冻结值一致（result `88f2153a…` / report `f329e814…`）；
  `kind` 字段明确标注为 REHEARSAL、非 T014 正式冻结；各证据
  `windowsTested` 均为 `NOT_TESTED`。
- 隐私：`src/` 无网络/时钟/随机调用（grep 验证）；产品本地运行；
  UI 横幅与离线报告均声明“不是真实设备兼容性认证”；Windows 如实标 NOT_TESTED，
  无一处写 PASS。
- T014 冻结条件：**尚不具备**——`scripts/deterministic_zip.py` 不存在，
  `package.json` 无 `release:freeze` 脚本，`release/` 目录不存在。
  按任务书，这属于 T014 的工作范围，不是 T013 的缺陷项；T013 PASS 后由
  T014 新建上述工具再冻结。`release/` 未被本次审查创建。

## 发现

- 无 P0/P1。承接的 T012 四项 P2 逐项复核见主报告 §3，全部仍在（均为记录级），
  其中 P2-1 的 FAILED 状态经本次 `sha256sum -c` 复现，P2-2 的缺失文件经磁盘
  清单复现，P2-3 的门槛数经 PERFORMANCE_TEST.json 复算，P2-4 的双份相同经
  `cmp` + sha256 复现。
