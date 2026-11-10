# P021 ViewportShift — 性能报告（T012）

- 浏览器：HeadlessChrome/158.0.8127.18（CDP，缓存 Chromium headless shell）；Node v24.22.1；seed P021-VIEWPORTSHIFT-S0-2026-11-10。
- 门槛来源：T001 环境报告中没有冻结的性能门槛，本次按实测基线冻结，规则：threshold = max(2 × 本次实测中位数, 下限）。下限：构建 120000 ms、demo 10000 ms、preview 启动 10000 ms、页面加载 5000 ms、交互 1000 ms。
- 实测值均为本次在 VM 上真实跑出的数字（构建 1 次、demo 3 次、页面加载 3 次、每种交互 3–6 次，中位数计入下表；完整各次数值见 PERFORMANCE_TEST.json）。

| 指标 | 实测中位数 (ms) | 冻结门槛 (ms) | 结果 |
| --- | ---: | ---: | --- |
| buildMs | 6444 | 120000 | PASS |
| demoMs | 94 | 10000 | PASS |
| previewStartupMs | 558 | 10000 | PASS |
| pageLoadMs | 229 | 5000 | PASS |
| timelineClickMs | 162 | 1000 | PASS |
| modeSwitchMs | 165 | 1000 | PASS |
| templateSwitchMs | 164 | 1000 | PASS |

- Windows：NOT_TESTED（未实测，不得写 PASS）。
