# P021 T014 — 任务报告（发布冻结）

- 任务：P021 ViewportShift T014 发布冻结与 SHA-256 清单（S5）
- 施工方：T014 施工会话
- 工作目录：`~/workspace/p021-viewportshift`
- 冻结对象：commit `e58411b`（`e58411bf1f0f8e80bf29ca1af70fc005a09f0d5e`）
- 时间：2026-11-10 ~11:13–11:25 GMT（初版冻结）；**修正后重冻：2026-11-10 ~11:24–11:31 GMT（协调员选 A）**
- 结论：**冻结完成（修正后）**（详见 `T014_FREEZE_REPORT.md`，修正记录见其 §11）

## 1. 验收命令（施工方亲自逐条跑；修正后数值）

| # | 命令 | 退出码 | 实测结果 |
|---|---|---:|---|
| 1 | `npm run release:freeze` | 0 | 28/28；两次内部构建 byte-identical；外部重跑一次同样 28/28，四个产物哈希与第一次完全相同 |
| 2 | `npm run release:verify` | **0** | **15/15**；修正前为 14/15（exit 1），唯一失败是其首项防护检查（断言 `release/` 不存在），因正式冻结已创建 `release/` 而按设计失败；修正后该检查改为行为断言（预演前后 release/ 存在性不变），冻结态下 15/15 全过。见冻结报告 §5、§11 |
| 3 | `python3 scripts/deterministic_zip.py --verify release/source.zip` | 0 | 669 条目；sha256 `09b4eef2…`；PASS |
| 4 | `python3 scripts/deterministic_zip.py --verify release/dist.zip` | 0 | 10 条目；PASS |

## 2. 两次冻结的 zip 哈希（byte-identical 证据；修正后）

- source.zip：`09b4eef286ff807b23afa89000520d1e3dc192ae6d38c554e70ba562d7de5d04`（3,518,579 字节，602 文件）——**纯 e58411b 内容**（`git archive HEAD` 取数；解出的树与提交树 `diff -r` 0 差异）
- dist.zip：`7b69edd4bfa5c64a2a519fe636e46f67e6ff76ef7bbdb7cd79911c9baee8e32e`（109,911 字节，7 文件）——与初版冻结相同，**不变**
- RELEASE_MANIFEST.json：`8041e89aa9cdc6375b18895ce694f1251e7ff0d1a039a66134694869be166f24`（113,858 字节）
- SHA256SUMS.txt：`d63b4e725cadbd5a4921c838dc4f520928923c8718ba35cb683202b7860f9c70`（240 字节）
- 初版冻结 source.zip `4dcaa21e…`（3,518,590 字节）已作废：它混入了工作树改过的 package.json（`505a4afa…`，含 T014 加的 `"release:freeze"` 入口）；HEAD 的 package.json 为 `2ee4f205…`。

## 3. SHA256SUMS 自校验

`sha256sum -c release/SHA256SUMS.txt`：source.zip OK、dist.zip OK、RELEASE_MANIFEST.json OK（exit 0）。SHA256SUMS.txt 在全部验收跑完的最后一步重新生成，内容与冻结输出逐字节相同。

## 4. 回归数字（修正后全部重跑，全部 exit 0）

npm test 全绿（schema 259、validation 273、modes 1159、events 1301、event-order 22、geometry 629、bfs 277、bfs:determinism 4、ui 202、export 136、golden 107、property 709、mutation 31；oracle diffs 98/70/86/165）；s0:gate 120/120，gateSha256 `65b4b32f…aca26` 不变；typecheck 0；build 0；demo 哈希不变（`88f2153a…` / `f329e814…`，witnessLength 1）；test:e2e 55/55；test:offline 26/26；test:performance 11/11；test:perf PASS（11 checks）；test:stress 15/15。

## 5. manifest 关键字段

sourceCommit e58411b（全 hash 见冻结报告 §1）；s0 PASS 120/120，gateSha256 `65b4b32f…`；demo `88f2153a…` / `f329e814…`，witness 1；T013 审查 PASS 0/0/8 P2（commit e58411b），reviewSha256 `41165857…` 与 `handoff/T013/INDEPENDENT_REVIEW.md` 实际哈希一致（已复核）；windowsTested NOT_TESTED；license PENDING_SAM_DECISION；source.zip 内 package.json = HEAD 版 `2ee4f205…`。

## 6. T012-P2-4 / P2-1 处置

- P2-4：正式冻结只出 `release/RELEASE_MANIFEST.json`；预演双份文件留在源码树内（已跟踪于 e58411b，删改需新 commit+T013+T014），manifest 以 `rehearsalSuperseded` 字段注明其为被取代的预演产物。
- P2-1：性能证据两文件每次跑后 diff 核对仅实测值变、门槛不变，随即 `git checkout --` 恢复；SHA256SUMS 在全部验收跑完最后生成并立即自校验；manifest 注明其为运行期再生文件。

## 7. 产出文件

- `release/source.zip`、`release/dist.zip`、`release/SHA256SUMS.txt`、`release/RELEASE_MANIFEST.json`
- `handoff/T014/T014_FREEZE_REPORT.md`、`TASK_REPORT.md`、`test_commands.txt`、`sha256.txt`、`unresolved_items.md`、`test_logs/`（初版 15 条日志 + freeze-run1-hashes.txt；修正后新增 16–33 号日志 + freeze-fixed-run1/run2-hashes.txt）

## 8. 与计划/任务书的偏差

- 计划书验收命令写 `python`，VM 上无 bare `python`，一律用 `python3`（任务书已注明，以 python3 为准）。
- `npm run release:verify` 在冻结后曾 exit 1（14/15），原因见冻结报告 §5；**已按协调员选 A 修正为行为断言，修正后 15/15、exit 0**（冻结报告 §11）。修正只改两个脚本，未动产品代码/夹具/证据已跟踪内容。
- 初版冻结 source.zip `4dcaa21e…` 混入工作树 package.json，已作废；**修正后冻结改从 `git archive HEAD` 取数，source.zip `09b4eef2…` 为纯 e58411b 内容**（冻结报告 §11）。
- 其余无偏差。未 commit、未 push、未碰 GitHub/Drive、未对外发消息；未添加 LICENSE。
