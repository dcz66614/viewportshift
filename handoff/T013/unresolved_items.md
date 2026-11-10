# P021 T013 — 未解决项

审查结论：**FINAL_VERDICT: PASS**（P0 0 / P1 0 / P2 8，其中 7 项 open、1 项已裁决保留）。
以下 7 项 open P2 均为记录级/妆容级，不阻塞 T013 通过与 T014 冻结；
宜由独立修复任务处理并重审对应范围。审查员本人不得改代码，故只登记。

## Open P2（7 项）

1. **T013-P2-1：时间轴行状态忽略 `GeometryStep.status`**（新）。
   `src/ui/scenario.ts` 的 `TimelineRow` 丢弃 `step.status`；
   `src/render/timeline.tsx` 状态列只看 `failedPredicates`。
   评估以合同违规/零面积终止时末行会显示“PASS”。修复：行状态优先显示步骤
   status；补 `test:ui` “末行非 OK”用例；修后重审 UI。
2. **T013-P2-2：`result === null` 短暂窗口顶栏默认 UNKNOWN 标签**（新）。
   `src/ui/App.tsx:236`。修复：加载窗口改显示“计算中”标签；妆容级。
3. **T011-P2-1：Golden `expected.bfs` 缺 `nodesVisited` / `nodesEnqueued`**。
   24/24 缺失；比较器已支持比对。修复：纯数据改动，给 24 个 golden 夹具
   补两个字段；修后重跑 `test:golden`。
4. **T012-P2-1：性能证据哈希随运行再生，`handoff/T012/sha256.txt` 校验 2 项 FAILED。**
   处置三选一（协调员/T014 定）：移出 `sha256.txt` 改验稳定字段；或把
   `sha256.txt` 生成放验收跑最后一步；或接受并注明。
5. **T012-P2-2：`evidence/e2e/downloads/` 未保留主流程 rv 导出文件。**
   修复：导出后立即复制主流程文件到独立留存名，或 Enter 测试改用另一下载目录。
6. **T012-P2-3：性能门槛全部由下限决定（余量 6–102 倍）。**
   处置：T014 复核下限是否收紧，或在报告中注明门槛松紧含义。
7. **T012-P2-4：`RELEASE_MANIFEST.json` 与 `RELEASE_REHEARSAL.json` 内容完全相同。**
   处置：T014 只保留一份规范文件，另一份改为引用或删除。

## 已裁决 / 已登记（无需修复任务）

- **T007-P2-2：已裁决——保留 INVALID 步分支为防御性代码，不删除。**
  论证与探针数字见 `INDEPENDENT_REVIEW.md` §4。本项关闭。
- **T009 可选项 4（3×4 对比矩阵）与 5（见证逐项展开）：正式登记为不做。**
  需改产品 UI、非低风险；逻辑层覆盖已存在。见 `INDEPENDENT_REVIEW.md` §8。
- **上游遗留决策（resizes-visual 下 KEYBOARD_CLOSE 只恢复 visualHeight）：维持。**
  冻结 Oracle 与该决策一致；是否改由终审定。见 `INDEPENDENT_REVIEW.md` §9。
- **T014 冻结尚不具备条件**：`scripts/deterministic_zip.py` 不存在，
  `package.json` 无 `release:freeze` 脚本，`release/` 目录不存在。
  属 T014 工作范围，不是 T013 缺陷项。

## 诚实记录的缺口

- T009 独立审查 8 项 P2 的逐字原文不在仓库快照中，其余 5 项无法逐项核对
  （审查员未编造）。如终审持有原文，请提供后补核。
