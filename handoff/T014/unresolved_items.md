# P021 T014 — 未解决项

冻结完成；以下各项均不阻塞冻结（冻结未改产品代码、未改夹具、未改测试），
留待终审决定。

## 1. 验收命令偏差：`release:verify` 在冻结后 exit 1（14/15）

- 唯一失败项是 `scripts/release-verify.mjs` 的首项防护检查
  `release/ is NOT created by this rehearsal`——正式冻结已按任务要求创建
  `release/`，该检查按设计失败。其余 14 项（两次预演构建哈希一致、dist
  清单 4 文件、无外部引用、demo 两次重算冻结哈希）全部通过。
- 冻结未改该脚本（冻结规则禁止改代码）；该脚本重写的两份预演证据文件
  已恢复为提交态（15/15）。
- 终审注意：重跑 `release:verify` 会再次 exit 1（同一项）。如需它在冻结
  后也 exit 0，应由终审决定是否改该检查——改动需新 commit + 新 T013 +
  新 T014。

## 2. 承接的 P2（5 项，留待终审，只登记）

1. **T013-P2-1**：时间轴行状态忽略 `GeometryStep.status`。
2. **T013-P2-2**：`result === null` 短暂窗口顶栏默认 UNKNOWN 标签。
3. **T011-P2-1**：Golden `expected.bfs` 缺 `nodesVisited` / `nodesEnqueued`。
4. **T012-P2-2**：`evidence/e2e/downloads/` 只保留 Enter 测试的导出文件。
5. **T012-P2-3**：性能门槛全部由下限决定（余量 6–102 倍）。

以上五项已列入 `release/RELEASE_MANIFEST.json` 的 `unresolvedP2Carried`。

## 3. T012-P2-4 的剩余尾巴

正式冻结只出 `release/RELEASE_MANIFEST.json` 一份规范文件；但
`evidence/release-rehearsal/RELEASE_MANIFEST.json` 与
`RELEASE_REHEARSAL.json` 仍留在冻结源码树内（它们是 commit e58411b 已
跟踪的预演产物，删改需新 commit + 新 T013 + 新 T014）。manifest 已以
`rehearsalSuperseded` 字段注明其为被取代的预演产物。终审如决定清理，
应在新一轮 T013/T014 中处理。

## 4. T012-P2-1 的剩余尾巴

性能证据两文件（`evidence/performance/PERFORMANCE_TEST.json`、
`PERFORMANCE_REPORT.md`）是运行期再生文件，哈希不冻结、不列入
`release/SHA256SUMS.txt`；每次验收跑后都需 diff 核对仅实测值变并恢复。
如终审希望它们可哈希校验，需改测试把实测值与门槛分离存放（新任务，
不在本冻结内做）。

## 5. 冻结工具未提交

`scripts/deterministic_zip.py`、`scripts/release-freeze.mjs` 与
`package.json` 的 `release:freeze` 脚本是 T014 自身产物，尚未提交；
`source.zip` 内容严格等于 commit e58411b（不含这三项）。协调员提交
T014 后如需重冻，source.zip 的 commit 与哈希将随新 commit 变化，须
重新走 T013+T014。

## 6. Windows 未实测：NOT_TESTED

本任务全部验证均在 Linux VM（Ubuntu 24.04.5 LTS，Node v24.22.1，
Python 3.12.3）上完成；Windows 平台未实测，manifest 按任务卡要求标记
NOT_TESTED，不得写 PASS。
