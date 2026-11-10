# T001 未解决项

## U-01：`python` 裸命令不存在（非阻塞）

- **现象：** 验收命令 `python --version` 在本 VM 上退出码 127：`environment: line 1: python: command not found`。`/usr/bin` 下只有 `python3` / `python3.12`，无 `python` 软链。
- **实际可用：** `python3 --version` → `Python 3.12.3`（已记录在环境报告与指纹中，`python: NOT_FOUND`）。
- **影响：** T001 通过标准是“记录真实环境”，已满足，不触发 S0 BLOCKED。但后续任务（T003 Oracle、`scripts/*.py`、T014 `deterministic_zip.py` 等）凡写 `python` 均须改用 `python3`，或在任务卡层面明确解释器；不要假装 `python --version` 已通过。
- **建议：** 不擅自改系统软链；由后续任务统一用 `python3` 调用。
