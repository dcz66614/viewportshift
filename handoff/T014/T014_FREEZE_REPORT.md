# P021 ViewportShift T014 — 发布冻结报告（T014_FREEZE_REPORT.md）

- 任务：P021 ViewportShift T014 发布冻结与 SHA-256 清单（S5）
- 施工方：T014 施工会话（与 T013 审查者不同会话；未参与 T013 审查）
- 工作目录：`~/workspace/p021-viewportshift`
- 冻结时间：2026-11-10 ~11:13–11:25 GMT（初版冻结）；**修正后重冻：2026-11-10 ~11:24–11:31 GMT（协调员选 A）**
- 冻结对象 commit：`e58411b`（`e58411bf1f0f8e80bf29ca1af70fc005a09f0d5e`，T013 提交）
- 结论：**冻结完成（修正后）。source.zip 与 dist.zip 两次冻结 byte-identical；SHA256SUMS 自校验全 OK；ZIP 可独立解压且清单与 `git ls-files` 逐项一致。**
- ⚠️ **修正通告（必读）：初版冻结的 source.zip（`4dcaa21e…`）不是纯 e58411b 内容——它混入了工作树改过的 `package.json`（含 T014 加的 `"release:freeze"` 入口，工作树哈希 `505a4afa…`）。修正后冻结改从 `git archive HEAD` 取数，source.zip = `09b4eef2…` 才是纯 e58411b 内容（HEAD 的 package.json = `2ee4f205…`）。旧哈希 `4dcaa21e…` 已作废，仅在本报告 §11 修正记录中保留备查。另：`release:verify` 的防护检查已按同一决议改为行为断言，冻结后重跑为 15/15、exit 0（修正前 14/15）。详见 §11。**

## 1. 冻结产物（release/，仅 4 个文件）

| 文件 | 字节数 | SHA-256 |
|---|---:|---|
| `release/source.zip` | 3,518,579 | `09b4eef286ff807b23afa89000520d1e3dc192ae6d38c554e70ba562d7de5d04` |
| `release/dist.zip` | 109,911 | `7b69edd4bfa5c64a2a519fe636e46f67e6ff76ef7bbdb7cd79911c9baee8e32e` |
| `release/RELEASE_MANIFEST.json` | 113,858 | `8041e89aa9cdc6375b18895ce694f1251e7ff0d1a039a66134694869be166f24` |
| `release/SHA256SUMS.txt` | 240 | `d63b4e725cadbd5a4921c838dc4f520928923c8718ba35cb683202b7860f9c70` |

- `source.zip`：602 个文件（与 `git ls-files` 在 HEAD 的清单逐项 diff 一致，0 差异），源文件总字节 7,231,504。内容 = commit e58411b 的完整跟踪树（src/、oracle/、tests/、scripts/、evidence/、handoff/T001–T013、demo-output/、package.json、package-lock.json、tsconfig、vite 配置、README/计划书/项目书）。排除 node_modules/、dist/、.git/、release/（自包含回避）。zip 内 669 条目（602 文件 + 67 目录条目）。**修正后取数口径：内容严格取自 `git archive HEAD` 解出的提交树，不读工作树磁盘；解出的树与 `git archive HEAD` 的树 `diff -r` 0 差异，zip 内 package.json = HEAD 版 `2ee4f205…`。**
- `dist.zip`：7 个文件（dist/ 4 文件 + demo-output/ 3 文件），zip 内 10 条目（7 文件 + 3 目录条目）。
  - dist：`assets/index-Ck8UGF3U.js`（285,286）、`assets/index-Zih-ycei.css`（1,467）、`index.html`（436）、`viewportshift.mjs`（75,943）——与 T012 预演的 dist 哈希逐项相同。
  - demo-output：`DEMO_MANIFEST.json`、`viewportshift-demo.json`、`viewportshift-demo-report.html`。
- `RELEASE_MANIFEST.json` 关键字段：`sourceCommit.full = e58411bf1f0f8e80bf29ca1af70fc005a09f0d5e`；`s0.status = PASS`，`checks = 120/120`，`gateSha256 = 65b4b32f4a5298642fd3de5a64441ed7d214e2519d118b8b67a7871ba73aca26`；`demo.resultSha256 = 88f2153afd19cd19659d48587b7a98286621fff7ca9ae37cec0de6a4e50f6b60`，`demo.reportSha256 = f329e8144a234eb46e6eea71dc04fc222e63dec44f3f66192b6c0bf0128d90b8`，`witnessLength = 1`；`t013Review = PASS 0/0/8 P2`，`reviewFile = handoff/T013/INDEPENDENT_REVIEW.md`，`reviewSha256 = 41165857dee714212f3dcd477999a2561f94645ebfd81ea8477b85a8926135f7`（已复核与该文件实际哈希一致）；`windowsTested = NOT_TESTED`；`license = PENDING_SAM_DECISION`（未添加 LICENSE）；`unresolvedP2Carried` 5 项不变；`source.files` 中 package.json = HEAD 版 `2ee4f205…`（2475 字节）。
- `SHA256SUMS.txt`：覆盖 source.zip、dist.zip、RELEASE_MANIFEST.json 三项（不含自身，无循环引用）。

## 2. 验收命令（逐条亲自跑，日志见 test_logs/）

| # | 命令 | 退出码 | 实测结果 |
|---|---|---:|---|
| 1 | `npm run release:freeze` | 0 | 28/28 检查通过（修正后新增 3 项提交树检查，见 §11）；两次内部构建 byte-identical；另做了一次外部重跑，同样 28/28，四个产物哈希与第一次完全相同（见 §3） |
| 2 | `npm run release:verify` | **0** | **15/15**；修正前为 14/15（exit 1），唯一失败是其首项防护检查 `release/ is NOT created by this rehearsal`——正式冻结已创建 `release/`，该检查按设计失败。修正后该检查改为行为断言（预演前后 release/ 存在性不变），冻结态下 15/15 全过。其余 14 项（两次预演构建哈希一致、dist 清单 4 文件、无外部引用、demo 两次重算冻结哈希）修正前后均通过。见 §5 与 §11 |
| 3 | `python3 scripts/deterministic_zip.py --verify release/source.zip` | 0 | 669 条目；sha256 `09b4eef2…` 与冻结值一致；PASS（已排序、全部 1980-01-01 时间戳、仅相对路径） |
| 4 | `python3 scripts/deterministic_zip.py --verify release/dist.zip` | 0 | 10 条目；sha256 与冻结值一致；PASS |

补充独立核验（非验收命令，如实记录）：`/tmp` 解压两个 zip 均 exit 0；解压出的 source 树文件清单与 `git ls-files` diff 0 差异；`sha256sum -c release/SHA256SUMS.txt` 三项全 OK；磁盘上的 7 个 dist/demo 文件哈希与 manifest 清单逐项一致（证明冻结后 `release:verify` 的两次重建没有改变 dist 内容）。

## 3. 重复构建一致性（byte-identical 证据）

- 冻结脚本内部：source.zip 与 dist.zip 各构建两次，两次哈希相同才发布。
- 外部重跑：`npm run release:freeze` 先后跑两次（日志 17、18），结果：
  - source.zip：两次均为 `09b4eef2…7de5d04`（3,518,579 字节）
  - dist.zip：两次均为 `7b69edd4…e8e32e`（109,911 字节）
  - RELEASE_MANIFEST.json：两次均为 `8041e89a…be166f24`（113,858 字节）
  - SHA256SUMS.txt：两次均为 `d63b4e72…f9c70`（240 字节）
- 初版冻结（已作废，仅备查）：两次均为 source.zip `4dcaa21e…a69d97f`（3,518,590 字节）、dist.zip `7b69edd4…e8e32e`、manifest `88b51d67…c19b2`——source.zip 多出的 11 字节即工作树 package.json 多出的 `"release:freeze"` 入口行。
- 确定性手段：`scripts/deterministic_zip.py`——条目按字节序排序、时间戳全部固定 1980-01-01 00:00:00、权限固定（文件 0644 / 目录 0755）、ZIP_DEFLATED level 9、无注释、无 extra 字段、仅相对路径。`--verify` 逐项核对上述合同。

## 4. 冻结前回归（全部 exit 0，数字记入本报告）

| 命令 | 退出码 | 实测数字 |
|---|---|---:|
| `npm test` | 0 | 全绿：schema 259、validation 273、modes 1159、events 1301、event-order 22、geometry 629、bfs 277、bfs:determinism 4、ui 202、export 136、golden 107、property 709、mutation 31；oracle diffs 98/70/86/165 |
| `npm run s0:gate` | 0 | 120/120 PASS（53/53 parity：48 main + 5 edge，12/12 植入检出，0 误报，100 次运行 / 1 哈希）；gateSha256 `65b4b32f…aca26` 不变 |
| `npm run typecheck` | 0 | 无输出 |
| `npm run build` | 0 | 构建成功（CLI bundle 75.94 kB） |
| `node dist/viewportshift.mjs demo` | 0 | status=FAIL；resultSha256 `88f2153a…`、reportSha256 `f329e814…`、witnessLength=1（与冻结值一致） |
| `npm run test:e2e` | 0 | 55 passed, 0 failed；0 外部请求 |
| `npm run test:offline` | 0 | 26 passed, 0 failed；三腿 0 外部请求 |
| `npm run test:performance` | 0 | 11 passed, 0 failed |
| `npm run test:perf` | 0 | PASS（11 checks, 0 failed） |
| `npm run test:stress` | 0 | 15 passed, 0 failed |

性能证据文件处置（T012-P2-1）：`test:performance` 与 `test:perf`/`test:stress` 先后两次重写了 `evidence/performance/PERFORMANCE_TEST.json` 与 `PERFORMANCE_REPORT.md`。每次跑后都用 `git diff` 核对：变化的只是实测值（修正后重跑例：buildMs 6444→6952、demoMs 94→99、previewStartupMs 558→538、timelineClickMs 162→163、modeSwitchMs 165→162、templateSwitchMs 164→161），冻结门槛（120000/10000/5000/1000）与 `thresholds` 段未变；核对后用 `git checkout --` 恢复两文件。冻结的 `release/SHA256SUMS.txt` 在全部验收跑完的最后一步重新生成（与冻结输出逐字节相同）并立即自校验全 OK。另注：这两份性能证据文件是运行期再生文件，其哈希不冻结、不列入 SHA256SUMS（见 manifest 的 `performanceEvidenceNote`）。

## 5. 诚实记录的偏差：`release:verify` 在冻结后 exit 1（已修正，见 §11）

- 事实（修正前）：`scripts/release-verify.mjs`（T012 预演脚本）的第 1 项检查断言 `!fs.existsSync(release/)`，注释写明“rehearsal must NOT create release/ (T014 owns the formal freeze)”。T014 冻结创建 `release/` 后再跑它，该检查必然失败；脚本仍继续跑完其余检查并重写了 `evidence/release-rehearsal/` 两份文件（内容由 15/15 变为 14/15）。修正前复现：exit 1、14/15（日志 16），复现后已用 `git checkout --` 把两份预演证据文件恢复为提交态（15/15）。
- 修正（协调员选 A）：该检查改为行为断言——预演开始前快照 release/ 是否存在，结束时断言其存在性未变（预演既不创建也不删除 release/）。修正后在冻结态下重跑：exit 0、15/15（日志 19）；此次运行写出的 `evidence/release-rehearsal/` 两文件与提交态逐字节一致，工作树无残留改动。失败项的唯一原因是防护检查与已冻结状态的冲突，不是产品、构建或 demo 的问题：其余 14 项修正前后全部通过，且冻结后磁盘 dist 文件哈希与 manifest 清单逐项一致。

## 6. T012 P2 处置（冻结产物层面，不改产品代码）

- **T012-P2-4（manifest 双份相同）**：正式冻结只出 `release/RELEASE_MANIFEST.json` 一份规范文件。`evidence/release-rehearsal/RELEASE_MANIFEST.json` 与 `RELEASE_REHEARSAL.json` 仍留在冻结源码树内——因为它们是 commit e58411b 已跟踪的预演产物，删除/改动它们需要新 commit + 新 T013 + 新 T014（冻结规则禁止）；manifest 的 `rehearsalSuperseded` 字段已注明该对文件为“被本正式 manifest 取代的预演产物、不再重新发布”。终审如决定清理，应在新一轮 T013/T014 中处理。
- **T012-P2-1（性能证据哈希再生）**：见 §4。SHA256SUMS 在全部验收跑完最后生成并立即自校验；manifest 的 `performanceEvidenceNote` 注明两份性能证据文件为运行期再生文件。

## 7. 不碰的 P2（留待终审，只登记）

T013-P2-1（时间轴行状态忽略 GeometryStep.status）、T013-P2-2（result===null 短暂窗口顶栏默认 UNKNOWN）、T011-P2-1（golden 缺节点数字段）、T012-P2-2（e2e downloads 只留 Enter 导出）、T012-P2-3（性能门槛全由下限决定）。冻结未改产品代码、未改夹具、未改测试；五项已列入 manifest 的 `unresolvedP2Carried` 与 `handoff/T014/unresolved_items.md`。

## 8. 冻结工具说明（新增文件，未 commit，由协调员统一提交）

- `scripts/deterministic_zip.py`（5,291 字节）：确定性 zip 创建与 `--verify`；合同见文件头注释。
- `scripts/release-freeze.mjs`（修正后哈希 `4a2d5d4e…`，见 `handoff/T014/sha256.txt`）：`npm run release:freeze` 的实现；断言 HEAD=e58411b、gate 哈希不变、无 LICENSE、clean 构建、demo 两次冻结哈希、两次构建 byte-identical、SHA256SUMS 最后生成并自校验。**修正后：source.zip 取数改从 `git archive HEAD` 解出的提交树（新增 3 项检查：archive 退出 0、解压干净、提交树与 `git ls-files` 逐项一致；冻结总检查由 25 项变为 28 项），`ALLOWED_DIRTY` 增加 `scripts/release-verify.mjs`；dist.zip 仍从磁盘构建产物取。**
- `scripts/release-verify.mjs`（修正后哈希 `98a1540f…`，HEAD 版 `3b6ab81b…`）：**修正后：首项防护检查由“release/ 不存在”的现状断言改为“本次预演没有创建/删除 release/”的行为断言（开头快照 + 结束时断言存在性未变）；其他 14 项检查未动。**
- `package.json`：新增 `"release:freeze": "node scripts/release-freeze.mjs"` 一行（其余未变）。
- 注意：上述三项（deterministic_zip.py、release-freeze.mjs、package.json 的新增行）是 T014 自身的工作产物，冻结时尚未提交；因此修正后的 `source.zip` 内容严格等于 commit e58411b（不含这三项的新内容，也不含 release-verify.mjs 的修正——该修正同样未提交，源内仍是 HEAD 版 `3b6ab81b…`）。协调员提交 T014 后如需重冻，source.zip 的 commit 与哈希将随新 commit 变化，须重新走 T013+T014——符合冻结规则。

## 9. 冻结后工作树状态

`git status --short`（修正后冻结完成时）：

```text
 M package.json
 M scripts/release-verify.mjs
?? handoff/T014/
?? release/
?? scripts/deterministic_zip.py
?? scripts/release-freeze.mjs
```

除 T014 自身新增/改动（package.json 的 `"release:freeze"` 入口、release-verify.mjs 的行为断言修正）外无任何已跟踪文件改动；`evidence/performance/` 与 `evidence/release-rehearsal/` 的运行期改动均已恢复（verify 修正后运行写出的预演文件与提交态逐字节一致，无需恢复）。未 commit、未 push、未碰 GitHub/Drive、未对外发消息。

## 10. 产出文件清单

- `release/source.zip`、`release/dist.zip`、`release/SHA256SUMS.txt`、`release/RELEASE_MANIFEST.json`（见 §1）
- `handoff/T014/T014_FREEZE_REPORT.md`（本文件）
- `handoff/T014/TASK_REPORT.md`、`test_commands.txt`、`sha256.txt`、`unresolved_items.md`
- `handoff/T014/test_logs/`：01-npm-test.log、02-s0-gate.log、03-typecheck.log、04-build.log、05-demo.log、06-test-e2e.log、07-test-offline.log、08-test-performance.log、09-test-perf.log、10-test-stress.log、11-release-freeze-run1.log、12-release-freeze-run2.log、13-release-verify.log、14-verify-source-zip.log、15-verify-dist-zip.log、freeze-run1-hashes.txt（初版冻结日志，备查）；16-release-verify-PREFIX.log（修正前复现 14/15）、17-release-freeze-fixed-run1.log、18-release-freeze-fixed-run2.log、19-release-verify-fixed.log（修正后 15/15）、20-verify-source-zip-fixed.log、21-verify-dist-zip-fixed.log、22-npm-test-fixed.log、23-s0-gate-fixed.log、24-typecheck-fixed.log、25-build-fixed.log、26-demo-fixed.log、27-test-e2e-fixed.log、28-test-offline-fixed.log、29-test-performance-fixed.log、30-test-perf-fixed.log、31-test-stress-fixed.log、32-sha256sums-selfcheck.log、33-source-purity-diff.log（空，即 0 差异）、freeze-fixed-run1-hashes.txt、freeze-fixed-run2-hashes.txt（修正后冻结日志）

## 11. 修正记录（协调员选 A——接受一次修正后的冻结，2026-11-10 ~11:24–11:31 GMT）

### 11.1 发现的问题

上一位修复员在 tripwire 停机前核实（本执行员复核确认）：初版冻结的 source.zip（`4dcaa21e76e9630e7d3e444e17d0940e2f997ba4756c27807c63edc0aa69d97f`，3,518,590 字节）本来就不是纯 e58411b 内容——它装的是工作树改过的 `package.json`（SHA-256 `505a4afa…`，多了 T014 加的 `"release:freeze"` 入口），而 HEAD 的 package.json 是 `2ee4f205…`。解出的 source.zip 树与 `git archive HEAD` 解出的树 diff：602 个文件中有且仅有 `package.json` 一个文件不同。根因：旧版 `release-freeze.mjs` 用 `git ls-files` 取清单、却从工作树磁盘读文件内容。

### 11.2 只改两个脚本（未动产品代码、夹具、证据已跟踪内容）

**`scripts/release-verify.mjs`**（HEAD 版哈希 `3b6ab81b…` → 修正后 `98a1540f…`）：
- `main()` 开头：删除现状断言 `check("release/ is NOT created by this rehearsal", !fs.existsSync(...))`，改为快照 `const releaseExistedBefore = fs.existsSync(path.join(ROOT, "release"))`。
- 证据写盘前新增行为断言：`check("rehearsal did not create or delete release/ (existence unchanged)", fs.existsSync(...) === releaseExistedBefore)`。
- 其他 14 项检查未动；检查总数仍为 15 项。

**`scripts/release-freeze.mjs`**（未跟踪文件；修正后哈希 `4a2d5d4e…`）：
- 第 7 步：`git archive HEAD -o <tmp>/head.tar` 后 `tar -xf` 解到临时目录；新增 3 项检查（archive 退出 0、解压干净、提交树与 `git ls-files` 逐项一致）；`sourceFiles` 的 size/sha256 改从解出的提交树计算。
- 第 8 步：source.zip 的 `--create --root` 由工作树根改为解出的提交树根；dist.zip 仍从磁盘构建产物取。
- `ALLOWED_DIRTY` 增加 `scripts/release-verify.mjs`（package.json 经核对已在清单内，未动）。
- 冻结总检查由 25 项变为 28 项；manifest 文件清单口径、`unresolvedP2Carried` 等字段未改；未添加 LICENSE。

### 11.3 修正前后对照（全部亲自重跑）

| 项目 | 修正前 | 修正后 |
|---|---|---|
| `npm run release:verify`（冻结态） | exit 1、14/15（日志 16） | exit 0、**15/15**（日志 19） |
| `npm run release:freeze` | exit 0、25/25；source.zip `4dcaa21e…`（3,518,590 字节） | exit 0、**28/28**；source.zip **`09b4eef2…`**（3,518,579 字节） |
| dist.zip | `7b69edd4…`（109,911 字节） | `7b69edd4…`（109,911 字节）——**不变，符合预期** |
| RELEASE_MANIFEST.json | `88b51d67…` | `8041e89a…`（源哈希与 package.json 清单项随之变，字段口径未变） |
| SHA256SUMS.txt | `08d72add…` | `d63b4e72…` |
| 两次冻结 byte-identical | 是（旧三哈希） | 是（新四哈希，diff 空；日志 17、18） |
| `deterministic_zip.py --verify` source/dist | exit 0（669 / 10 条目） | exit 0（669 / 10 条目，源哈希 `09b4eef2…`） |
| 冻结源纯度（`diff -r` vs `git archive HEAD` 树） | 1 个文件不同（package.json） | **0 差异**（日志 33，输出为空） |
| 全量回归 | 全绿（初版） | 全绿（修正后重跑，日志 22–31；数字见 §4） |
| SHA256SUMS 自校验（最后一步重生成） | 3/3 OK | 3/3 OK（重生成内容与冻结输出逐字节相同；日志 32） |

修正前核验（/tmp 模拟重建）：`git archive HEAD` 解出 602 文件与 `git ls-files` 逐项 diff 0 差异；以同一 `deterministic_zip.py` 从提交树重建的 source.zip 哈希 = `09b4eef286ff807b23afa89000520d1e3dc192ae6d38c554e70ba562d7de5d04`，与修正后冻结实测完全一致。
