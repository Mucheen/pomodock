const assert = require('node:assert/strict')
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pomodock-smoke-'))
app.setPath('userData', profile)
app.setName('Pomodock smoke test')
const yesterday = new Date()
yesterday.setDate(yesterday.getDate() - 1)
const { localDateKey } = require('../electron/statistics.cjs')
fs.writeFileSync(path.join(profile, 'timer-state.json'), JSON.stringify({
  phase: 'focus', status: 'idle', remainingMs: 1500,
  statisticsVersion: 1, statisticsDate: localDateKey(yesterday),
  dailyRecords: { [localDateKey(yesterday)]: { focusRounds: 2, focusMinutes: 50 } },
  completedFocusRounds: 2, cycleVersion: 1, cycleFocusRounds: 0,
}))
require('../electron/main.cjs')
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

app.whenReady().then(async () => {
  const window = BrowserWindow.getAllWindows()[0]
  const act = (code) => window.webContents.executeJavaScript(code, true)
  try {
    await delay(1500)
    await act(`
      window.audioStats = { created: 0, active: 0 };
      const NativeAudioContext = window.AudioContext;
      window.AudioContext = class extends NativeAudioContext {
        constructor() { super(); window.audioStats.created++; window.audioStats.active++; }
        async close() { await super.close(); window.audioStats.active--; }
      };
      void 0;
    `)
    const initial = await act('window.pomodoro.getState()')
    assert.equal(initial.todayFocusRounds, 0)
    assert.equal('dailyRecords' in initial, false)
    await act('document.querySelector(".controls .primary-button").click()')
    assert.equal((await act('window.audioStats')).created, 0)
    await act('window.pomodoro.setCollapsed(true)')
    await delay(2200)
    const alarm = await act('window.pomodoro.getState()')
    assert.equal(alarm.alarm, true)
    assert.equal(alarm.collapsed, false)
    assert.equal(alarm.todayFocusRounds, 1)
    assert.equal((await act('window.audioStats')).active, 1)
    fs.writeFileSync(path.join(profile, 'alarm.png'), (await window.webContents.capturePage()).toPNG())
    await act('document.querySelector(".alarm-card .text-button").click()')
    await delay(400)
    assert.equal((await act('window.audioStats')).active, 0)
    await act('document.querySelector(".session-progress").click()')
    await delay(400)
    const history = await act('window.pomodoro.getHistory()')
    assert.equal(history.dailyRecords[localDateKey(yesterday)].focusRounds, 2)
    assert.equal(history.dailyRecords[localDateKey()].focusRounds, 1)
    assert.equal(await act('!!document.querySelector(".history-day.has-record")'), true)
    fs.writeFileSync(path.join(profile, 'history.png'), (await window.webContents.capturePage()).toPNG())
    console.log(JSON.stringify({ passed: true, todayFocusRounds: alarm.todayFocusRounds, audioContexts: await act('window.audioStats'), screenshots: profile }))
    app.quit()
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
