// Run with Electron; the real timer uses a disposable profile, never user records.
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pomodock-memory-'))
app.setPath('userData', profile)
app.setName('Pomodock memory benchmark')
if (process.argv.includes('--software-rendering')) app.disableHardwareAcceleration()
const source = process.env.POMODOCK_BENCH_SOURCE || path.join(__dirname, '..')
require(path.join(source, 'electron/main.cjs'))

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const round = (value) => Math.round(value * 10) / 10

app.whenReady().then(async () => {
  const window = BrowserWindow.getAllWindows()[0]
  let messages = 0
  let historyBytes = 0
  const originalSend = window.webContents.send.bind(window.webContents)
  window.webContents.send = (channel, payload, ...rest) => {
    if (channel === 'timer:state') {
      messages += 1
      if (payload.dailyRecords) historyBytes += Buffer.byteLength(JSON.stringify(payload.dailyRecords))
    }
    return originalSend(channel, payload, ...rest)
  }
  const act = (code) => window.webContents.executeJavaScript(code, true)
  const samples = []
  const measure = async (scenario) => {
    await delay(4000)
    messages = 0
    historyBytes = 0
    app.getAppMetrics()
    const metrics = []
    for (let i = 0; i < 3; i += 1) {
      await delay(2000)
      metrics.push(app.getAppMetrics())
    }
    const processes = metrics.at(-1).map((metric) => ({
      type: metric.name || metric.type,
      workingSetMB: round(metric.memory.workingSetSize / 1024),
      ...(metric.memory.privateBytes !== undefined ? { privateMB: round(metric.memory.privateBytes / 1024) } : {}),
    }))
    const result = {
      scenario,
      workingSetMB: round(metrics.reduce((sum, sample) => sum + sample.reduce((total, metric) => total + metric.memory.workingSetSize / 1024, 0), 0) / metrics.length),
      cpuPercent: round(metrics.reduce((sum, sample) => sum + sample.reduce((total, metric) => total + metric.cpu.percentCPUUsage, 0), 0) / metrics.length),
      messagesIn6Seconds: messages,
      historyBytesIn6Seconds: historyBytes,
      processes,
    }
    samples.push(result)
    console.log(JSON.stringify(result))
  }
  try {
    await delay(2000)
    await measure('idle')
    await act('document.querySelector(".controls .primary-button").click()')
    await measure('running-expanded')
    await act('window.pomodoro.setCollapsed(true)')
    await measure('running-collapsed')
    await act('window.pomodoro.pause()')
    await measure('paused-collapsed')
    console.log(JSON.stringify({ platform: process.platform, electron: process.versions.electron, hardwareAcceleration: app.isHardwareAccelerationEnabled(), samples }))
    app.quit()
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
