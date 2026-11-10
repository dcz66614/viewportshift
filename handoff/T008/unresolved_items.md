# P021 T008 — 未解决项

无遗留阻塞。以下为过程中发现并已处理的问题与说明性备注：

1. [已修正] 初版 dedup fixture 曾用谓词 `keyboardObscuredArea > 100000000000`，被 T004
   冻结校验拒绝（`value_out_of_range`：谓词阈值上限为 MAX_DIMENSION_MILLI =
   10000000）。这是校验器的正确行为，不是 bug。已改用独立枚举计数设计：
   全键 74 态 vs naive-sum 键 34 态，BFS nodesVisited/nodesEnqueued = 74。
2. [说明] 未新建独立 Python BFS Oracle（见 TASK_REPORT §6.1）：T008 任务卡只要求
   test:bfs 与 test:bfs:determinism；witness 对照由 runner 独立暴力枚举 + T007
   重放覆盖。如 T011 要求 Python BFS parity，需另开任务。
3. [说明] fail-closed 时 `searchBfs` 返回默认 limits（maxDepth 8 / maxNodes 10000），
   因输入 limits 本身可能非法、不可信。有意选择，见 TASK_REPORT §6.2。
