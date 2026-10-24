# Pomodock Lite 轻量预览版

Lite 复用现有 React 界面，使用 Tauri/Rust 和系统 WebView，避免在每份应用中打包完整 Chromium 与 Node.js。Electron v0.2.2 仍作为稳定版提供。

v0.3.0-beta.2 修复双屏切换：运行中收起、展开和调整大小以窗口当前所在屏幕为准，收起时更新屏幕记忆和高度；只有启动时才优先恢复上次记忆的屏幕。反复展开、收起不会把贴顶/贴底标签逐渐挤向中间。数据目录和记录格式不变，退出 beta.1 后安装 beta.2 即可。

## 大小目标

下载包和应用可执行文件均要求严格低于 **50,000,000 字节**，Windows 构建会自动检查，达到或超过即失败。Windows 使用系统共享的 Microsoft Edge WebView2：已安装时直接复用，未安装时安装程序会联网下载。WebView2 自身的共享磁盘占用不包含在此应用大小目标内；完整离线 WebView2 运行库不随 Lite 捆绑。

这是包体目标，不是运行内存保证。Windows 总进程内存尚未在真机测量；不同系统、WebView 版本和使用状态会影响结果。

v0.3.0-beta.1 实际发布文件（MB = 1,000,000 字节）：

| 文件 | 字节 | MB |
| --- | ---: | ---: |
| Windows x64 安装程序 | 1,384,949 | 1.38 |
| Windows x64 裸 EXE | 3,539,968 | 3.54 |
| macOS arm64 DMG | 3,046,176 | 3.05 |
| macOS arm64 ZIP | 2,389,778 | 2.39 |

macOS 完整 `.app` 文件总量为 6,096,034 字节（6.10 MB）。Windows 裸 EXE 大小不等于包含共享运行库的总安装占用。Windows 发布文件来自[通过的原生构建](https://github.com/Mucheen/pomodock/actions/runs/39716282001)。

## 数据

Lite 使用独立的 `com.pomodock.lite` 数据目录。首次启动会从 Electron 的 `pomodock/timer-state.json` 复制计时设置和打卡记录，并在 Lite 目录保存 `timer-state.imported-electron.json` 备份。后续只读写 Lite 数据，不会覆盖 Electron 原文件。迁移后两个版本的记录分别累计；迁移前应退出旧版，避免导入尚未保存的数据。

支持 25/5/25 四轮循环、每日归零、历史日历、跨天和休眠后的期限校准、单实例、小标签上下拖动与窗口大小记忆。计时由 Rust 后台维护，独立于 WebView 的页面计时器。

## 开发

除 Node.js 外还需 [Tauri 系统依赖与 Rust](https://v2.tauri.app/start/prerequisites/)。

```bash
npm ci --ignore-scripts
npm run lite:dev
npm run lite:test
npm run lite:build
```

Windows 构建由 `.github/workflows/lite.yml` 在 Windows 上执行；构建文件包括裸 EXE 和 NSIS 安装程序。裸 EXE 也依赖系统已安装 WebView2。安装程序更适合需要系统通知的用户。

打包前会从锁定版本的 Rust crate 与 Tauri JS API 分发文件生成 `src-tauri/THIRD_PARTY_NOTICES.txt`，随应用包含，另外保留根目录的 React 许可声明。发布页同时提供许可证与第三方声明。

## 验证范围

beta.2 本地通过 40 项 JavaScript 测试与 15 项 Rust 测试，覆盖过期屏幕记忆、跨屏收起、负坐标/上下排列、不同缩放比例的坐标计算、标签锚点及屏幕缺失回退。macOS 双屏系统 WebView 隔离测试确认跨屏移动后点击真实收起按钮不跳回旧屏幕，反复展开/收起位置不漂移；原生窗口尺寸、最小尺寸、后台到时展开及打卡日历亦通过。测试构建与发布构建分离。

Windows 已通过原生编译、计时/存储测试和体积门禁，尚未完成 Windows 真机交互与内存测试，因此首先发布为预览版。安装包未配置商业代码签名或 macOS 公证；MIT 开源许可不代表操作系统安全认证。

`POMODOCK_LITE_DATA_DIR` 可指定隔离的数据目录；设置该变量时不自动导入用户数据。`smoke-test` 是专用测试编译特性，正式发布构建不启用，也不包含测试命令。
