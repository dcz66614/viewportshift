# P021 ViewportShift｜视口潮汐项目书

**PROJECT_ID:** `P021`  
**SLUG:** `viewportshift`  
**SPEC_VERSION:** `1.0.0`  
**规格状态:** `SPEC_FROZEN / NOT_IMPLEMENTED`  
**计划状态:** `READY_FOR_S0_ONLY`  
**立项方向:** `LOCKED`  
**真人参与:** `0`  
**用户价值:** `USER_VALUE_NOT_MEASURED`  
**许可证:** `PENDING_SAM_DECISION`

> 本文件是正式产品规格，不代表代码已经实现、S0 已通过或用户价值已验证。除明确标注的公开资料外，所有频率、成本、性能和工时均为规划假设或验收目标。

## 1. 执行摘要与冻结的产品边界

### 1.1 一句话定位

**不需要手机，确定性模拟移动浏览器软键盘引发的视口变化，找出聊天输入框、底部面板和固定操作栏在哪种事件序列下被遮挡，并给出最短失败证据。**

### 1.2 冻结的 MVP

- 三种标准视口响应模式：`resizes-visual`、`resizes-content`、`overlays-content`。
- 附加视觉视口延迟平移压力事件；它是压力事件，不冒充第四种标准模式。
- 四种合成布局模板用于测试组合；产品内置三种合成 UI：聊天输入框、底部面板、固定 CTA。
- 确定性视口状态机、矩形几何 oracle、事件时间轴、最短失败序列搜索。
- 本地 Web UI，支持 JSON 场景与结果导出。
- 所有测试仅使用合成布局、合成事件和固定 seed。
- TypeScript + React + SVG 前端；Python 独立几何 Reference Oracle。

### 1.3 冻结边界

ViewportShift 是行为模型实验室，不是移动设备模拟器，也不是浏览器兼容性认证工具。它不运行真实 iOS Safari / Android 浏览器，不接真实手机，不宣称模拟结果等价于任何厂商浏览器的完整实现。

## 2. 用户、场景与痛点证据

### 2.1 目标用户

维护移动 Web 聊天窗口、搜索栏、底部弹窗和固定操作栏的 React/Vue 前端工程师。典型工作包括维护输入栏、BottomSheet、固定 CTA、搜索工具栏及响应式页面。

### 2.2 具体场景

工程师在 Windows/Linux 开发机上修改移动端布局，使用桌面浏览器的移动视口预览，准备提交 PR；没有实体 iPhone 或 Android 设备，或当前无法复现目标设备的软键盘时序。开发者需要在提交前判断键盘展开、滚动、视口缩放/平移和收起的组合是否使关键 UI 被遮挡。

### 2.3 痛点量化（规划假设，非用户调查）

| 指标 | 规划假设 | 证据状态 |
|---|---|---|
| 频率 | 每周 1–3 次 | 未实测 |
| 强度 | 4/5 | 估计，未调查 |
| 单次代价 | 30–90 分钟 | 估计，未计时 |
| 当前 workaround | 改 `100dvh`、监听 `visualViewport`、CSS fixed/inset 补偿、桌面移动视口预览、借助实体设备复现 | 待验证 |
| 不足 | 单一截图看不到事件顺序；一次测量不能覆盖三种视口响应模式；手工调 CSS 难以定位最短触发序列 | 工程推断 |

### 2.4 公开需求证据

- Astryx [#10718](https://github.com/meta/astryx/issues/10718)：公开问题报告描述视觉视口偏移 337px、底栏最大下沉 337px，并报告 100ms 窗口内 358 次方向翻转。该数字是 issue 报告中的特定轨迹，不是行业统计。
- Astryx [#10713](https://github.com/meta/astryx/issues/10713)：Android Chrome 视觉视口/键盘时序相关问题线索。
- Astryx [#10703](https://github.com/meta/astryx/issues/10703)：Android Firefox 首次键盘开启时的输入框遮挡问题线索。
- Chrome 官方文档说明虚拟键盘导致的三类 viewport resize behavior，参见第 12 节。

公开 issue 证明特定故障曾被报告，不证明发生率、平均损失或 ViewportShift 的用户价值。

### 2.5 最接近已有方案与差异

| 方案 | 已有用途 | 可借鉴 | ViewportShift 不复制的内容 |
|---|---|---|---|
| Interop 2022 Viewport | 视口行为测试/演示与跨浏览器互操作工作 | 视口概念与测试边界 | 不重做 WPT/Interop 测试套件 |
| viewport-lock | 移动端视口/键盘布局修复方向 | 常见修复策略与问题类型 | 不提供运行时键盘补丁 |
| viewport-truth | 视觉视口测量方向 | 视口测量概念 | 不做测量 Hook 或生产监测 SDK |
| Mock Keyboard | 开发阶段模拟键盘外观/覆盖 | 键盘预览与开发辅助 | 不做单一键盘演示或扩展复刻 |

**差异化：** 批量重放视口状态，计算布局失败，生成最小反例的实验室；不是键盘补丁、测量 Hook、单一演示页或通用浏览器自动化工具。

## 3. 产品目标、非目标与范围

### 3.1 目标

1. 形式化三种视口响应模式及其状态转移。
2. 显式建模布局视口、视觉视口、键盘几何和滚动偏移。
3. 对聊天输入框、底部面板、固定 CTA 进行矩形可见性与遮挡计算。
4. 重放确定性事件时间线，显示每个事件后的几何状态。
5. 使用有界 BFS 找到最短失败事件序列。
6. 使用独立 Python 几何 Oracle 与 TypeScript 实现逐字段对照。
7. 本地生成 JSON 与离线可视化报告。

### 3.2 非目标

- 不做真实设备兼容性认证或真实 iOS Safari / Android Chrome 复现保证。
- 不做键盘修复补丁、CSS 自动修复或生产运行时 Hook。
- 不做通用浏览器自动化、真实网页抓取或真实手机连接。
- 不读取用户真实网页、表单内容、个人数据或真实设备遥测。
- 不接 LLM、收费 API、云服务、GPU 或硬件。
- 不宣称可替代真机测试、Web Platform Tests 或浏览器厂商实现。

### 3.3 MVP 支持矩阵

| 维度 | MVP 支持 |
|---|---|
| 视口模式 | `resizes-visual`、`resizes-content`、`overlays-content` |
| 附加事件 | 延迟视觉视口平移、滚动、键盘展开/收起、视口稳定/动画完成 |
| UI 模板 | 聊天输入框、底部面板、固定 CTA |
| 坐标 | CSS px；固定布局视口坐标和视觉视口可见区域明确区分 |
| 几何 | 轴对齐矩形、裁剪、键盘遮挡、可见比例、底部间距、位置漂移 |
| 搜索 | 有界 BFS，固定事件字母表与最大深度 |
| 输出 | JSON、离线 HTML/SVG 报告、时间轴 |
| 数据 | 固定 seed 合成布局与事件 |

### 3.4 必须输出 UNKNOWN 的情况

- 任意非轴对齐/复杂 CSS transform、透视变换或 3D transform；
- 浏览器特定的软键盘动画曲线、系统手势区或厂商私有行为未被输入契约描述；
- pinch zoom、动态浏览器工具栏、折叠屏多视口、分屏、软键盘候选栏的未建模影响；
- 任意真实 DOM/CSS 解析、任意网页脚本或浏览器布局引擎结果；
- 缺少布局视口尺寸、视觉视口偏移、键盘几何或事件时间参数；
- 超出事件深度、事件数量或数值范围上限。

UNKNOWN 不得按 PASS 处理，也不得自动选取“最常见”的行为模型。

## 4. 核心机制与算法契约

### 4.1 坐标系

全部几何使用 CSS pixel（CSS px），数值在输入后规范化为固定精度的定点整数（建议 1/1000 CSS px 单位），禁止使用二进制浮点比较作为判定依据。

- **Layout Viewport (LV)：** 布局坐标系，矩形为 `[0, 0, layoutWidth, layoutHeight]`。
- **Visual Viewport (VV)：** 用户当前可见区域；由 `offsetLeft`、`offsetTop`、`width`、`height` 定义，映射回布局坐标。
- **Keyboard Rect (KB)：** 键盘在布局坐标中的覆盖矩形；若当前模式下键盘不覆盖页面内容，则仍记录键盘屏幕几何，但遮挡判定由模式规则决定。
- **Scroll Offset：** 文档滚动偏移，作为独立状态字段；不得与 VV offset 混为一谈。
- **Surface Rect：** UI 元素在布局坐标中的轴对齐矩形；元素类型决定其锚定策略。

MVP 不模拟 pinch zoom；`scale` 固定为 1。遇到 scale 不为 1 的输入返回 UNKNOWN。

### 4.2 视口状态机

状态至少包含：`layoutWidth/Height`、`visualOffsetLeft/Top`、`visualWidth/Height`、`keyboardRect`、`keyboardVisible`、`scrollX/Y`、`mode`、`pendingPan`、`eventClock`。

三种模式：

- `resizes-visual`：键盘开启时视觉视口可见高度缩小；布局视口尺寸保持不变。
- `resizes-content`：键盘开启时布局视口高度按键盘占用量缩小；视觉视口随布局视口更新。
- `overlays-content`：键盘覆盖内容区域；布局视口和视觉视口尺寸不因键盘自动缩小，遮挡由键盘矩形参与几何计算。

附加压力事件 `DELAYED_VISUAL_PAN`：在键盘状态变化后经过固定延迟，将视觉视口偏移按输入的请求量更新。该事件可被夹紧到合法坐标边界；报告同时记录 requested/applied pan 与 clamp 原因。它不改变当前标准模式标识。

### 4.3 事件字母表与转移

事件类型：`KEYBOARD_OPEN`、`KEYBOARD_CLOSE`、`SCROLL`、`DELAYED_VISUAL_PAN`、`VIEWPORT_SETTLED`。每个事件有固定 `atMs`、参数和稳定 ID；事件时间必须单调不减。状态转移纯函数：`nextState = transition(currentState, event, mode, profile)`。

同一输入必须产生相同状态轨迹。事件冲突按固定优先级：输入事件顺序优先；相同时间戳按 fixture 中的数组顺序处理；不得依赖 wall clock/timer。

### 4.4 矩形几何指标

设 surface 矩形为 S，视觉可见矩形为 V，键盘覆盖矩形为 K。交集面积使用轴对齐矩形精确交集：

`intersectionArea(A,B) = max(0,min(A.right,B.right)-max(A.left,B.left)) × max(0,min(A.bottom,B.bottom)-max(A.top,B.top))`

至少输出：

- `keyboardObscuredArea`：S 与 K 的交集面积（仅在当前 mode 语义下键盘覆盖内容时计入）。
- `viewportClippedArea`：S 减去 S 与 V 的交集面积。
- `visibleArea`：surface 与可见区域、非键盘区域的有效可见面积；避免重复扣除重叠区域。
- `visibleRatio = visibleArea / surfaceArea`；零面积输入 INVALID。
- `bottomGap`：surface 底边与视觉视口底边的有符号距离；正值表示尚有间隙，负值表示越过边界。
- `anchorDrift`：相对其声明锚点期望位置的位移向量与模长。

所有指标必须由单一规范几何定义计算，并在项目书、TS 实现、Python Oracle、JSON 报告中使用同名字段。任何字段不一致均失败。

### 4.5 最短失败序列搜索

使用 BFS 在固定事件字母表中枚举长度递增的合法事件序列。最大深度、最大节点数和事件参数离散集合在 Schema 中冻结。目标谓词由布局声明定义，例如 `visibleRatio < threshold`、`keyboardObscuredArea > 0`、`bottomGap < minGap` 或 `anchorDrift > tolerance`。

- 按序列长度优先，因此首个命中为最短序列。
- 同长度按事件类型固定顺序、参数值排序和事件 ID 排序，保证唯一输出。
- 状态哈希用于去重，但不得将不同可观察几何状态错误合并。
- 达到搜索上限未找到失败时输出 `BOUNDED_NO_WITNESS`，不得声称全空间安全。
- 超出模型支持范围输出 `UNKNOWN`。

### 4.6 独立几何 Oracle

生产实现：TypeScript，纯函数、定点整数。独立 Oracle：Python，单独实现矩形交集、裁剪、键盘遮挡和可见性计算；不得导入/调用 TS 代码，也不得共享生产算法模块。两边只共享只读 fixture 与接口 Schema。每个输出字段逐项比较，任一 mismatch 即 FAIL，无忽略清单、无人工豁免。

## 5. 用户流程与完整交互设计

### 5.1 本地 Web UI 流程

1. 打开本地应用，查看行为模型边界说明。
2. 选择一个合成布局：聊天输入框、底部面板或固定 CTA；也可载入内置四布局测试集。
3. 选择三种视口响应模式之一。
4. 设置合成设备视口尺寸、键盘高度、滚动和延迟平移参数。
5. 选择固定事件序列或运行有界最短失败搜索。
6. 查看事件时间轴、layout/visual viewport、keyboard rect、UI 矩形与遮挡热区。
7. 点击某一事件，查看该时刻的状态和几何指标。
8. 导出 JSON 场景、JSON 结果或离线 HTML 报告；清空当前合成工作区。

### 5.2 报告 UI

- 顶部：场景 ID、模型模式、seed、状态（PASS/FAIL/UNKNOWN/BOUNDED_NO_WITNESS）。
- 左侧：布局与视口参数。
- 中央：SVG 视口剖面，显示布局视口、视觉视口、键盘和目标 UI 矩形。
- 下方：事件时间轴及每一步的遮挡面积、可见比例、底部间距和位置漂移。
- 右侧：最短失败见证，展示事件序列、首个失败谓词、前后状态及可复算 JSON。
- 状态必须有文字标签，不得只靠颜色表达；所有尺寸以 CSS px 显示。

### 5.3 README 首屏

README 第一屏必须明确写出“不需要手机”。首屏主图为同一聊天输入框在三种视口模型下的三种结果对比；配一个命令运行合成 Demo；展示最短失败序列与遮挡数值；明确声明“行为模型实验室，不是真实设备兼容性认证”。

## 6. 数据结构与接口契约

### 6.1 Scenario Schema

`viewportshift.scenario/v1` 至少包含：`scenario_id`、`seed`、`layout`、`viewport`、`keyboard`、`mode`、`events[]`、`failure_predicates[]`、`limits`。所有数值范围、单位和默认值由 T005 schema 冻结；不允许隐式单位。

### 6.2 核心类型

```ts
type ViewportMode = "resizes-visual" | "resizes-content" | "overlays-content";
type EventType = "KEYBOARD_OPEN" | "KEYBOARD_CLOSE" | "SCROLL" | "DELAYED_VISUAL_PAN" | "VIEWPORT_SETTLED";
type AnalysisStatus = "PASS" | "FAIL" | "UNKNOWN" | "BOUNDED_NO_WITNESS" | "INVALID";
interface Rect { x: number; y: number; width: number; height: number; }
interface GeometryMetrics {
  keyboardObscuredArea: number;
  viewportClippedArea: number;
  visibleArea: number;
  visibleRatio: number;
  bottomGap: number;
  anchorDrift: { dx: number; dy: number; magnitude: number };
}
```

### 6.3 本地接口

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/health` | 本地运行状态与版本 |
| GET | `/api/modes` | 返回三种模式契约 |
| GET | `/api/layouts` | 返回合成布局模板 |
| POST | `/api/validate` | Schema 与范围校验 |
| POST | `/api/replay` | 确定性事件重放 |
| POST | `/api/search` | 有界 BFS 最短失败序列搜索 |
| POST | `/api/export` | JSON/HTML 报告导出 |

服务仅绑定 `127.0.0.1`，无远程请求。

## 7. 系统架构与模块划分

```text
React + TypeScript UI
  ├─ LayoutPicker / ModePicker / EventEditor
  ├─ ViewportSVG / Timeline / WitnessPanel
  └─ ExportPanel
        │
        ▼
TypeScript Domain (pure functions)
  ├─ schema / validation
  ├─ viewport state machine
  ├─ event replay
  ├─ rectangle geometry
  ├─ BFS witness search
  └─ canonical JSON / SHA-256
        │
        ▼
Local API (127.0.0.1)

Independent Python Geometry Oracle (tests only)
  ├─ viewport transition reference
  ├─ rectangle intersection / clipping
  └─ per-field parity comparator
```

模块边界：`src/domain/` 纯算法；`src/ui/` 交互；`src/render/` SVG 绘制；`src/io/` JSON 导入导出；`oracle/python/` 独立参考实现；`tests/fixtures/` 固定合成样本。

## 8. 验证指标与验收门槛

| 指标 | 门槛 | 方法 |
|---|---:|---|
| S0 固定场景 | 48/48 | 4 布局 × 3 键盘行为 × 4 事件序列 |
| Oracle parity | 100% | TS/Python 每字段精确对照 |
| 预植入错误检出 | 12/12 | 12 个遮挡/定位错误全部检出 |
| 正常场景误报 | 0 | 正常场景全部不得误判 |
| 几何数值 | 逐字段完全一致 | 遮挡面积、底部间距及所有几何字段 |
| 确定性 | 100 次运行 1 个 SHA-256 | 固定输入、固定 seed、规范化输出 |
| 固定 seed | 100% 一致 | 重放场景与搜索结果完全相同 |
| 离线 | 0 外部请求 | 网络拦截/隔离与日志 |
| 真人参与 | 0 | 全流程审计 |
| 用户价值 | `USER_VALUE_NOT_MEASURED` | 文档与报告标记 |

以上为验收门槛，不是已取得结果。性能目标由 T012 在真实 VM 环境中冻结和实测。

## 9. 隐私、安全、许可证

- 只处理用户主动选择的合成布局/场景 JSON；不读取真实 DOM、页面内容或设备数据。
- 不收集个人信息，不上传数据，不发遥测，不调用 LLM/API。
- 输入严格 Schema 验证，限制事件数量、搜索深度、坐标和矩形尺寸；不执行输入代码。
- UI 报告对文本进行安全转义，不将输入拼接为可执行 HTML。
- 本地 API 仅绑定 `127.0.0.1`。
- 项目许可证 `PENDING_SAM_DECISION`；Sam 决定前不得添加项目 LICENSE 或公开再分发。依赖许可证须在 T013 前完成核对。

## 10. 风险、限制与停止条件

| 风险 | 级别 | 处理 |
|---|---|---|
| 三种视口模式无法被有限状态机正确区分 | P0 | S0 STOP，不扩大功能补救 |
| 模拟模型与真实浏览器行为不等价 | P0 边界 | UI/README 明确行为模型实验室，不宣称设备认证 |
| 几何 oracle 与 TS mismatch | P0 | 任一字段 mismatch 即 FAIL |
| BFS 状态空间爆炸 | P1 | 固定字母表、深度/节点上限；返回 BOUNDED_NO_WITNESS |
| 复杂 CSS transform/浏览器私有行为 | P1 | UNKNOWN，不猜测 |
| 延迟平移事件被误认为标准第四模式 | P1 | 独立事件类型与文档声明 |
| 产品退化为普通键盘演示页 | P0 | STOP；必须保留几何诊断和最短失败见证 |
| 产品退化为普通 CSS 修复补丁 | P0 | STOP；不提供运行时补丁 |
| Windows 环境差异 | P2 | 真实日志核验；未测标记 NOT_TESTED |

**强制停止条件：** 模拟模型无法以三种视口模式验证关键差异；产品只剩普通键盘演示页；产品只剩普通 CSS 修复；核心结果必须依赖真实手机/真人/在线 API 才能成立。出现任一项，停止独立方向，不通过增加范围掩盖失败。

## 11. 最终交付物与状态

- `PROJECT_BOOK.md/.docx`
- `IMPLEMENTATION_PLAN.md/.docx`
- 本地 TypeScript + React + SVG 应用
- Python 独立几何 Oracle
- 48 个 S0 场景、12 个预植入错误、Golden/变异/属性测试
- 时间轴、最短失败序列、JSON 与离线 HTML 报告
- README、用户指南、环境报告、测试日志、截图、依赖许可证清单
- `REVIEW_INDEX.md`、分批 `REVIEW_PACK_XX.md`、独立复核报告
- `source.zip`、`dist.zip`、SHA-256 清单与冻结 manifest

**当前状态：** `SPEC_FROZEN / NOT_IMPLEMENTED`；实施计划 `READY_FOR_S0_ONLY`。不表示 S0 已通过或 GO 已批准。

## 12. 参考资料与借鉴边界

1. Chrome, Viewport resize behavior: https://developer.chrome.com/blog/viewport-resize-behavior — 三种标准视口响应模式；不复制演示实现。
2. MDN, VisualViewport: https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport — 视觉视口 offset/size 属性；不把 API 测量等同于键盘仿真。
3. MDN, VirtualKeyboard API: https://developer.mozilla.org/en-US/docs/Web/API/VirtualKeyboard_API — 键盘几何与 overlay 概念；不要求所有浏览器支持。
4. Interop 2022 Viewport: https://github.com/web-platform-tests/interop-2022-viewport — 互操作测试先例；不重做 WPT。
5. Astryx issue #10718: https://github.com/meta/astryx/issues/10718 — 具体视觉视口偏移/滚动轨迹；不推断行业频率。
6. Astryx issue #10713: https://github.com/meta/astryx/issues/10713 — Android Chrome 视口/键盘问题线索。
7. Astryx issue #10703: https://github.com/meta/astryx/issues/10703 — Android Firefox 首次键盘开启问题线索。
8. viewport-lock: https://github.com/jmmoser/viewport-lock — 修复方向先例；不复制补丁。
9. viewport-truth: https://github.com/AntonVoronezh/viewport-truth — 测量方向先例；不复制 Hook。
10. Mock Keyboard: https://chromewebstore.google.com/detail/mock-keyboard/mljckmogiafcfchajifkocimcnafjplj — 键盘预览先例；不复制单一演示。

## 13. 诚实限制与未验证事项

- 行为模型不等于真实 iOS Safari / Android 浏览器；未接入真实浏览器内核。
- Windows 兼容性未实测，须以 Muse VM 的真实环境日志为准。
- `USER_VALUE_NOT_MEASURED`：零真人政策下不进行访谈、试用、问卷或主观评价。
- 48 个场景、12 个植入错误、Oracle parity、100 次哈希均为未来验收门槛，尚未执行。
- 性能、内存、构建时间和 UI 可用性均未实测。
- 固定精度定点几何的误差边界须在 T005/T008 冻结；不得声称达到真实浏览器像素级一致。
