# Pomodock

一个轻量、安静地吸附在屏幕右侧的跨平台桌面番茄钟，支持 macOS 和 Windows。

## 下载

前往 [Releases](https://github.com/Mucheen/pomodock/releases/latest) 下载最新版本：

- macOS Apple Silicon：下载 `.dmg`，打开后将 Pomodock 拖入“应用程序”
- Windows x64：下载 `portable.zip`，解压后运行 `Pomodock.exe`

> 当前公开构建尚未配置商业代码签名。macOS 或 Windows 首次启动时可能出现开发者或 SmartScreen 提示。

## 功能

- 专注、短休息和长休息计时
- 默认循环：25 分钟专注，前 3 轮后短休息 5 分钟，第 4 轮后长休息 25 分钟，再开始下一组
- 收起为屏幕右侧的常驻小标签
- 到时自动展开，并发送系统通知和提示音
- 暂停、继续、重置与跳过当前阶段
- 自定义各阶段时长和长休息间隔
- 状态持久化，休眠唤醒后按实际结束时间校准
- 单实例运行，避免重复启动多个计时器
- 今日专注次数按本地日期自动刷新，跨天不会打断计时或长休息轮次
- 圆点标明“本组”专注轮次，第 4 轮后保持全亮，长休息完成或跳过后归零；不把历史累计次数混入本组
- 点击“今日节奏 / 打卡记录”查看历史日历、每日专注次数和分钟数

打卡只统计完整完成的专注，休息、跳过和重置不会增加次数。跨天专注记在完成日期；休眠后恢复时仍按原定结束日期记账。旧版仅保存累计次数，无法还原每日日期，升级后会保留为“升级前记录”，不计入今日；首次迁移会备份原状态文件。

每天零点只刷新今日统计，未完成的循环跨天保留。到时仍会弹出提醒，点击按钮开始下一阶段。保存设置会从第 1 轮专注开启新的循环，不清空每日打卡。

## 本地开发

需要 Node.js 20 或更高版本。

```bash
npm install
npm run dev
```

执行 `npm test` 可验证每日刷新、历史迁移和跨天计时统计。

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
