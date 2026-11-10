# T001 — 环境与工程骨架 TASK_REPORT

- **项目：** P021 ViewportShift（`viewportshift`）
- **任务：** T001（S0，环境与工程骨架）。只做 T001，未碰 T002–T014 的业务内容。
- **输入：** `P021_PROJECT_BOOK.md`、`P021_IMPLEMENTATION_PLAN.md`（规格 1.0.0，已验证，T001 未修改）、当前 VM。
- **结论：** T001 通过。`npm ci`、`npm run env:check`、`npm run typecheck` 退出码均为 0；环境指纹三跑一致；无 GPU、Docker、手机或 API 前置条件。唯一偏差：验收清单中的 `python --version` 在本 VM 上不存在（退出码 127），实际解释器为 `python3` 3.12.3，见“未解决项”。

## 做了什么

1. 通读实施计划 §0–§5 与项目书全文，按 T001 任务卡施工。
2. 新建最小 TS + React + Vite 骨架：`package.json`（name `viewportshift`，private，scripts 含 `env:check` 与 `typecheck`，另有 `dev`/`build`）、`package-lock.json`、`tsconfig.json`（strict）、`vite.config.ts`、`index.html`、`src/main.tsx`、`src/App.tsx`（仅占位文案，无任何业务算法/几何/状态机逻辑）。
3. 新建 `scripts/env-check.mjs`：探测 Node/npm/Python/Git 版本、OS/CPU/RAM/磁盘、Chromium 与 Docker 可用性；输出规范化 JSON 环境指纹并写入 `evidence/environment/ENVIRONMENT_REPORT.md`；退出码 0。报告不含时间戳、机器绝对路径与随机值；易变值（可用内存/磁盘）只打印到 stdout，不进报告文件。
4. 新建 Oracle 空骨架 `oracle/python/geometry_oracle.py`：仅模块 docstring 与一个抛 `NotImplementedError` 的桩函数，**无任何几何逻辑**（已用 `python3` 导入验证：抛 `NotImplementedError`，见下）。
5. `git init`（无 remote、无 push、无 commit；工作树状态记录在环境报告中：分支 `master`，HEAD `NO_COMMITS`，clean `false`，14 条未跟踪/修改项）。
6. 修复了 env-check 的两个自身缺陷（施工中发现，均已验证修复）：
   - stdout 的 `git` 对象曾被 `JSON.stringify` 的 replacer 数组过滤为空 `{}`；改为直接序列化。
   - 零 commit 仓库中 `git rev-parse --abbrev-ref HEAD` 退出 128，曾误报 `NOT_A_GIT_REPO`；改用 `git rev-parse --git-dir` 判仓 + `git symbolic-ref --short HEAD` 取分支。
7. 规格文件 `P021_PROJECT_BOOK.md` / `P021_IMPLEMENTATION_PLAN.md` 未修改（SHA 见 `sha256.txt`）。

## 环境（真实记录）

| 项目 | 值 |
| --- | --- |
| OS | Ubuntu 24.04.5 LTS（Linux 7.0.0-44-generic，linux/x64） |
| CPU | AMD EPYC 9D25 126-Core Processor × 4 |
| 总内存 | 8,319,897,600 bytes |
| 磁盘总量（工作区文件系统） | 161,042,399,232 bytes |
| Node | v24.22.1 |
| npm | 10.9.4 |
| Python（`python`） | NOT_FOUND（未安装） |
| Python 3（`python3`） | Python 3.12.3 |
| Git | git version 2.43.0 |
| Chromium | 可用（Playwright 浏览器缓存 / 系统 Chrome 二进制检出；PATH 上无 chromium 包） |
| Docker | 不可用（false） |
| GPU / 手机 / 外部 API | 无前置条件 |

**环境指纹 SHA-256：** `cd4f6887eefb53e04f6735abd8127907bf45fde8ce83e65ef257748d706b42d5`
（三跑 `npm run env:check` 指纹哈希完全一致；报告文件哈希见 `sha256.txt`，其内容随 git 工作树状态变化，指纹本身不变。）
**依赖：** react + react-dom 19.2.0；typescript ~5.9.3；vite ^7.2.0；@vitejs/plugin-react ^5.0.0；@types/react、@types/react-dom 19.2.0。`npm install` 新增 68 个包，`npm ci` 69 个包。

## 验收命令逐条输出原文

完整日志见 `handoff/T001/test_logs/`。逐条结果如下：

### 1. `node --version` — 退出码 0

```text
=== CMD: node --version ===
v24.22.1
EXIT_CODE=0
```

### 2. `npm --version` — 退出码 0

```text
=== CMD: npm --version ===
10.9.4
EXIT_CODE=0
```

### 3. `python --version` — 退出码 127（未通过，环境事实，见未解决项）

```text
=== CMD: python --version ===
environment: line 1: python: command not found
EXIT_CODE=127
```

### 4. `git --version` — 退出码 0

```text
=== CMD: git --version ===
git version 2.43.0
EXIT_CODE=0
```

### 5. `npm ci` — 退出码 0

```text
=== CMD: npm ci ===

added 69 packages in 2s

9 packages are looking for funding
  run `npm fund` for details
EXIT_CODE=0
```

### 6. `npm run env:check` — 退出码 0

```text
=== CMD: npm run env:check ===

> viewportshift@0.1.0 env:check
> node scripts/env-check.mjs

{
  "arch": "x64",
  "chromium_available": true,
  "cpu_count": 4,
  "cpu_model": "AMD EPYC 9D25 126-Core Processor",
  "docker_available": false,
  "fingerprint_sha256": "cd4f6887eefb53e04f6735abd8127907bf45fde8ce83e65ef257748d706b42d5",
  "free_memory_bytes": 1052626944,
  "git": {
    "branch": "master",
    "clean": false,
    "head": "NO_COMMITS",
    "untracked_or_modified_count": 14
  },
  "node": "v24.22.1",
  "npm": "10.9.4",
  "os_pretty_name": "Ubuntu 24.04.5 LTS",
  "os_release": "7.0.0-44-generic",
  "os_type": "Linux",
  "platform": "linux",
  "python": "NOT_FOUND",
  "python3": "Python 3.12.3",
  "report": "evidence/environment/ENVIRONMENT_REPORT.md",
  "total_disk_bytes": 161042399232,
  "total_memory_bytes": 8319897600
}
EXIT_CODE=0
```

（注：`free_memory_bytes` 为易变值，三跑之间不同；指纹哈希三跑一致。）

### 7. `npm run typecheck` — 退出码 0

```text
=== CMD: npm run typecheck ===

> viewportshift@0.1.0 typecheck
> tsc --noEmit

EXIT_CODE=0
```

### 额外验证（非验收清单，仅作骨架 sanity check）

- `npm run build`（`tsc --noEmit && vite build`）：退出码 0，`dist/index.html` + `dist/assets/index-*.js` 生成，构建用时 1.88s。日志 `test_logs/08-build-extra.log`。
- Oracle 占位验证：`python3 -c` 导入 `oracle/python/geometry_oracle.py` 后调用 `geometry_oracle()` 抛 `NotImplementedError: geometry_oracle is a T001 placeholder; see T003`，确认无几何逻辑。
- 指纹可复算：三次 `npm run env:check` 的 `fingerprint_sha256` 均为 `cd4f6887…42d5`。
- 报告文件不含绝对路径（`grep /home/hatch` 命中 0）与时间戳。

## 文件清单及 SHA-256

见 `changed_files.txt`（13 个 T001 新建文件）与 `sha256.txt`。其中：

| 文件 | SHA-256（前 16 位） |
| --- | --- |
| evidence/environment/ENVIRONMENT_REPORT.md | `773842fa6bf7bde0…` |
| package.json | `b5de9a1909677929…` |
| package-lock.json | `1ba60239c090fc13…` |
| scripts/env-check.mjs | `e0ea433f396a05a7…` |
| oracle/python/geometry_oracle.py | `3717a4cccd9a0bd6…` |
| tsconfig.json | `f847e08e43c2c2e5…` |

完整 13 文件 SHA-256 见 `sha256.txt`。另有 `README.md`、`.gitignore`、`index.html`、`vite.config.ts`、`src/main.tsx`、`src/App.tsx`。`node_modules/` 与 `dist/` 已忽略，未列入清单；`P021_PROJECT_BOOK.md` / `P021_IMPLEMENTATION_PLAN.md` 为既有规格，未修改。

## 未解决项

见 `unresolved_items.md`：仅 1 项——`python` 裸命令不存在（`python --version` 退出码 127），后续任务须用 `python3`；不阻塞 T001，亦不触发 S0 BLOCKED（T001 通过标准为“记录真实环境”，已做到）。

## 下一步

T001 完成，可进入 T002（状态机 PoC）与 T003（几何 Oracle PoC）。T002/T003 的验收脚本届时按实施计划 §5 另行新建。
