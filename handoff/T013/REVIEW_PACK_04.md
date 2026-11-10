# P021 T013 — 审查包 04：UI / 渲染 / 见证面板

- 审查员：独立审查会话（与施工方不同会话）
- 审查对象：commit `fff40cb`
- 审查时间：2026-11-10 ~11:02–11:20 GMT
- 本包文件：`src/App.tsx`（3 行）、`src/main.tsx`（9 行）、
  `src/ui/App.tsx`（564 行）、`src/ui/WitnessPanel.tsx`（121 行）、
  `src/ui/scenario.ts`（469 行）、`src/ui/styles.css`（146 行）、
  `src/render/timeline.tsx`（122 行）、`src/render/viewportSvg.tsx`（194 行）

## 所读内容

- `src/ui/App.tsx` 全文：顶栏状态 `result !== null ? result.analysisStatus : "UNKNOWN"`
  （T013-P2-2 的证据行）；横幅含“不需要手机”与“行为模型实验室，不是真实设备
  兼容性认证”声明；四布局对比表固定“当前模式 × 四布局”（T009 可选项 4 的现状）；
  完成评估但无行的场景显示 `FailClosedNotice`（P1-1 修复，文本为“评估已完成”，
  不再是“计算中…”）；导出按钮在 `result === null` 时禁用。
- `src/ui/scenario.ts` 全文：UI 唯一域入口，无第二套算法；`timelineRows` 把
  `GeometryStep` 映射为 `TimelineRow` 时**丢弃 `step.status`**（只保留
  `failedPredicates` 等字段）——T013-P2-1 的上游证据；
  `deriveAnalysisStatus` 为共享模块的重导出；`STATUS_LABELS` 含
  `BOUNDED_NO_WITNESS` 的中文标签（仅 BFS 状态用）；`sha256HexBrowser` 在
  WebCrypto 不可用时回退 FNV-1a，但回退方法经 `shaMethod` 在状态栏明示，
  真实浏览器环境走 SHA-256（E2E 通过），不计缺陷。
- `src/render/timeline.tsx` 全文：状态列 `failed ? "FAIL（失败）" : "PASS（通过）"`，
  不读行状态——T013-P2-1 的直接证据；空表时显示 fail-closed 文案（P1-1 修复）。
- `src/render/viewportSvg.tsx` 全文：热区 `hotZone = (S ∩ K) ∩ V`，用域
  `rectIntersection` 计算，仅做 milli→CSS px 显示缩放；键盘/目标 UI/期望锚点
  均按域值绘制；先绘热区、后绘目标 UI（红色热区视觉上只露边线，T012 已注明）。
- `src/ui/WitnessPanel.tsx` 全文：BFS 状态经 `bfsStatusLabel` 显示，
  `BOUNDED_NO_WITNESS` 有专门说明段落（“不代表全空间安全”）；
  见证只展开首个失败步骤的前后状态 + canonical JSON（T009 可选项 5 的现状）。
- `src/ui/styles.css` 全文：三列布局在 ≤1000px 时折为单列；`:focus-visible`
  3px 轮廓；状态永不只靠颜色传达（文字标签齐全）。

## 发现

- **T013-P2-1（新，P2）：时间轴行状态忽略 `GeometryStep.status`。**
  证据：`src/ui/scenario.ts` `TimelineRow` 接口与 `timelineRows`（~339–393 行）
  不含 status 字段；`src/render/timeline.tsx` 状态列只看 `failedPredicates`。
  影响：评估以合同违规（UNKNOWN）或零面积（INVALID）终止时，末行会显示
  “PASS（通过）”，尽管顶栏状态正确显示 UNKNOWN/INVALID。实际可达性极低：
  合同检查是构造定理、UI 参数范围使零面积不可达；`test:ui` 对 fail-closed
  只覆盖“零行”情形，未覆盖“末行非 OK”情形。P2，登记修复任务。
- **T013-P2-2（新，P2）：`result === null` 的短暂加载窗口顶栏默认显示 UNKNOWN 标签。**
  证据：`src/ui/App.tsx` `const status = result !== null ? result.analysisStatus : "UNKNOWN"`。
  属实，但为异步计算完成前的一瞬态，且同一行场景哈希处同时显示“计算中…”；
  不影响任何已完成评估的正确性。P2（妆容级），建议改为“计算中”标签。
- **顶栏状态永不可能是 BOUNDED_NO_WITNESS：属实，但不是缺陷。**
  `deriveAnalysisStatus`（`src/domain/analysis-status.ts`）只由几何评估派生，
  返回值域为 PASS/FAIL/UNKNOWN/INVALID；BFS 状态另在见证面板完整报告
  （含 BOUNDED_NO_WITNESS 标签与说明）。符合任务卡对两类状态的分离设计。
- T009 可选项 4（3×4 对比矩阵）与 5（见证逐项展开）：**正式登记为不做**，
  决定与理由见主报告 §8。两者均需改产品 UI（App 对比表计算、WitnessPanel /
  scenario 重放逻辑），非低风险；逻辑层覆盖已存在（`test:ui` 4×3 sweep 全绿、
  E2E 验证对比表 4 行齐全、见证 canonical JSON 可复算）。

## 截图目视（审查员亲自看，非抄录）

- `evidence/e2e/e2e-main-flow.png`（245,449 字节）：rv / chat-input / FAIL，
  横幅声明与见证面板（见证长 1）俱全，与断言一致。
- `evidence/e2e/e2e-keyboard-visible.png`（307,510 字节）：overlays-content 下
  键盘灰块、“键盘 300 CSS px 高”、橙色目标 UI、图例“键盘遮挡面积 21840 CSS px²”，
  与断言一致。
- `evidence/e2e/e2e-tab-focus-export.png`（219,742 字节）：导出按钮带蓝色焦点框；
  时间轴两行均为 PASS——该页为 resizes-content Enter 测试页（键盘隐藏、初始行
  被选中），rc 下 open 后目标 UI 完全可见、PASS 是正确几何，与断言一致。
