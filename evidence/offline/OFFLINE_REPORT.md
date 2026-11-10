# P021 ViewportShift — 离线验证报告（T012）

- 浏览器：HeadlessChrome/158.0.8127.18（CDP，缓存 Chromium headless shell）
- 静态扫描：dist/index.html 外部 src/href 引用 0 个；src/** 网络调用点 0 个；dist 产物网络调用点 0 个。
- dist 内 URL 字面量（仅标识符、从不发起请求）：http://www.w3.org/1998/Math/MathML、http://www.w3.org/1999/xlink、http://www.w3.org/2000/svg、http://www.w3.org/XML/1998/namespace、https://react.dev/errors/。
- Leg 2（拦截非本地请求）：本地请求 3 个，外部请求 0 个；布局→模式→重放→时间轴点击→导出下载全链路通过。
- Leg 3（离线模拟后交互）：离线期间新发起请求 0 个，外部请求 0 个；模式切换、时间轴点击、导出下载均通过；离线导出为 resizes-visual 场景（a6fa92fcf6aae9d919df536e6f9758572c9d181c9074b93c62a07bb04f79c0d0），与 Leg 2 的 overlays-content 导出（f3daec4bfba0c8ae8f06e2462f7dd0164017b8069fde6af2a5e4feae7b98da3d）不同是正确的（模式不同）。
- 静态扫描补充：bundle 内唯一的 fetch( 调用点是 Vite 的 modulepreload 预载 polyfill，只取本地 <link rel=\"modulepreload\"> 的 href，index.html 中无外部引用，运行时日志亦证实 0 外部请求。
- Demo CLI：resultSha256 / reportSha256 与冻结值一致，见证长 1。
- Windows：NOT_TESTED（未实测，不得写 PASS）。
