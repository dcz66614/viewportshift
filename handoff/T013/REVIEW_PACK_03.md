# P021 T013 — 审查包 03：IO / CLI / 导出 / 离线报告

- 审查员：独立审查会话（与施工方不同会话）
- 审查对象：commit `fff40cb`
- 审查时间：2026-11-10 ~11:02–11:20 GMT
- 本包文件：`src/io/json.ts`（691 行）、`src/io/report.ts`（401 行）、
  `src/io/demo.ts`（66 行）、`src/cli.ts`（211 行）、`src/node-shims.d.ts`（36 行）

## 所读内容

- `json.ts` 全文：`parseImportJson`（1 MiB / 深度 32 / 节点 10000 上限，迭代栈式
  检查）；`parseScenarioJson` / `exportScenarioJson` 均先过冻结校验器；
  `sha256HexPure` 为纯 TS SHA-256（FIPS 180-4，无 Node 内建导入）；
  `exportResultJson`（641–691 行）重算 `sha256HexPure(canonicalJson(校验后场景))`
  并与调用方传入的 `scenarioSha256` 比对，不一致返回 `import_hash_mismatch`
  拒绝导出——T010 P2-1 已修，代码核对属实（只看代码，不信摘要）。
  `parseResultJson` 同样校验 envelope 内 scenario/evaluation/bfs 三块的
  id/seed/mode 一致性与哈希。
- `report.ts` 全文：离线 HTML 只含一个内联 `<style>` 与内联 SVG，无任何外部资源；
  `findExternalReferences` 扫描 10 类外部引用模式；全部输入字符串过 `escapeHtml`；
  报告正文含“行为模型实验室，不是真实设备兼容性认证”声明。
- `demo.ts` 全文：仅合成数据（chat-input / overlays-content / 固定 seed / 单个
  KEYBOARD_OPEN），无时钟/随机/网络。
- `cli.ts` 全文：`demo` 命令走导出→重导入→重放→BFS→信封→导出→报告→manifest
  全链路，任一步失败即非零退出；导入共享 `deriveAnalysisStatus`
  （`src/domain/analysis-status.ts`），无本地复刻——T010 P2-2 已修属实。
  顶部残留一段说明性注释（“Derive the top-bar analysis status …”）位于
  `printHelp` 之前、无对应函数：无害的过期注释，不计缺陷（见主报告观察项）。
- `node-shims.d.ts` 全文：仅覆盖 CLI 用到的三个 Node 内建的最小声明；
  全仓 grep：`src/` 内已无 `// @ts-ignore` 字面（仅 `scripts/test-coverage.mjs`
  的注释与断言字符串中出现该词）——T010 P2-3 已修属实，未新增依赖。

## 发现

- 无 P0/P1/P2。本包四项 T010 P2 逐项代码核对结果：
  - P2-1（导出重算比对）：已修 ✓
  - P2-2（analysis-status 抽取共享）：已修 ✓（CLI 与 UI 均导入同一函数）
  - P2-3（去掉 3× @ts-ignore）：已修 ✓（`src/` 内零残留）
  - P2-4（审查原文归档）：已修 ✓（`handoff/T011/REVIEW_P2_REGISTER.md` 在仓内，
    §A 为逐字原文、§C 明确标注非逐字部分）
