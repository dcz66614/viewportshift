# P021 T010 — 未解决项

无 T010 阻塞项。验收命令全部 exit 0（`npm run build`、`node dist/viewportshift.mjs demo`、`npm run test:export` 136/136），S0 门禁回归仍 PASS（120/120）。

说明性备注（不阻塞）：

1. **CLI 的 `node:` 导入带 `// @ts-ignore`。** 本仓库无 `@types/node`，`src/cli.ts` 的三个 Node 内建导入（`node:crypto` / `node:fs` / `node:path`）各带一行 `// @ts-ignore`，`process` 在文件内最小声明；其余 domain / io 逻辑仍完整受 `tsc --noEmit` 检查。后续如引入 `@types/node` 可去掉这三行注释（需 Sam / 协调员决定是否新增依赖类型包，T010 未擅自加）。
2. **`dist/viewportshift.mjs` 为构建生成物。** CLI 入口由 `npm run build` 的第二步（vite lib）产出，未单独提交源码之外的产物；`dist/` 在 `.gitignore` 内。发布冻结（T014）时按其清单处理。
3. **上游遗留（只记录、不处理）：** S2 独立审查遗留 6 项 P2 与 T009 独立审查遗留 8 项 P2（含顶栏状态永不可能是 BOUNDED_NO_WITNESS、时间轴行状态忽略 GeometryStep.status 等）已登记留待 T011/T013；T009 另有复核观察一项（状态栏在 result === null 的短暂加载窗口默认显示 UNKNOWN 标签，T009 原有行为）。T010 未碰其中任何一项。明细条目文本见独立审查报告原文（不在本仓库快照中），见 `handoff/T010/TASK_REPORT.md` §6。
