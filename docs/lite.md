# Pomodock Lite 轻量预览版

Lite 复用现有 React 界面，使用 Tauri/Rust 和系统 WebView，避免在每份应用中打包完整 Chromium 与 Node.js。Electron v0.2.2 仍作为稳定版提供。

## 大小目标

下载包和应用可执行文件均以 **50,000,000 字节**为上限，Windows 构建会自动检查，超过即失败。Windows 使用系统共享的 Microsoft Edge WebView2：已安装时直接复用，未安装时安装程序会联网下载。WebView2 自身的共享磁盘占用不包含在此应用大小目标内；完整离线 WebView2 运行库不随 Lite 捆绑。

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

`POMODOCK_LITE_DATA_DIR` 可指定隔离的数据目录；设置该变量时不自动导入用户数据。`smoke-test` 是专用测试编译特性，正式发布构建不启用，也不包含测试命令。
