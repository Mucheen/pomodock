# Pomodock

一个轻量、安静地吸附在屏幕右侧的跨平台桌面番茄钟，支持 macOS 和 Windows。

## 下载

前往 [Releases](https://github.com/Mucheen/pomodock/releases/latest) 下载最新版本：

- macOS Apple Silicon：下载 `.dmg`，打开后将 Pomodock 拖入“应用程序”
- Windows x64：下载 `portable.zip`，解压后运行 `Pomodock.exe`

> 当前公开构建尚未配置商业代码签名。macOS 或 Windows 首次启动时可能出现开发者或 SmartScreen 提示。

## 功能

- 专注、短休息和长休息计时
- 收起为屏幕右侧的常驻小标签
- 到时自动展开，并发送系统通知和提示音
- 暂停、继续、重置与跳过当前阶段
- 自定义各阶段时长和长休息间隔
- 状态持久化，休眠唤醒后按实际结束时间校准
- 单实例运行，避免重复启动多个计时器

## 本地开发

需要 Node.js 20 或更高版本。

```bash
npm install
npm run dev
```

## 构建安装包

```bash
# 当前平台
npm run dist

# macOS（需要在 macOS 上构建）
npm run dist:mac

# Windows（建议在 Windows 上构建）
npm run dist:win
```

安装包由 electron-builder 生成。`dist:win` 建议在 Windows 上执行；也可以直接解压项目提供的 Windows portable ZIP 后运行 `Pomodock.exe`。正式公开分发时，需要分别配置 Apple Developer 签名/公证和 Windows 代码签名证书。

## 技术栈

- Electron
- React
- Vite

Pomodock 的计时和设置保存在本机，不需要账号或网络连接。
