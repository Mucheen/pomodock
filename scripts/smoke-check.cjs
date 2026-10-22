const assert = require('node:assert/strict')
const { app, BrowserWindow, screen } = require('electron')
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
const source = process.env.POMODOCK_SMOKE_SOURCE || path.join(__dirname, '..')
require(path.join(source, 'electron/main.cjs'))
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

    // Exercise real pointer capture/click handling. Only the native cursor reading
    // is controlled, so tests can move the window without moving the user's mouse.
    await act('window.pomodoro.setCollapsed(true)')
    await delay(300)
    window.focus()
    const beforeDrag = window.getBounds()
    assert.equal(beforeDrag.width, 36)
    assert.equal(beforeDrag.height, 76)
    const originalCursor = screen.getCursorScreenPoint
    let cursor = { x: beforeDrag.x + 18, y: beforeDrag.y + 30 }
    screen.getCursorScreenPoint = () => cursor
    const input = (type, y = 30, x = 18) => window.webContents.sendInputEvent({ type, x, y, globalX: cursor.x, globalY: cursor.y, modifiers: type === 'mouseUp' ? [] : ['leftButtonDown'], button: 'left', clickCount: 1 })
    input('mouseDown')
    await delay(100)
    const offset = beforeDrag.y > 120 ? -100 : 100
    cursor = { ...cursor, y: cursor.y + offset }
    input('mouseMove', 50)
    await delay(100)
    input('mouseUp')
    await delay(200)
    assert.equal(window.getBounds().y, beforeDrag.y + offset)
    assert.equal((await act('window.pomodoro.getState()')).collapsed, true)
    fs.writeFileSync(path.join(profile, 'edge-tab.png'), (await window.webContents.capturePage()).toPNG())
    const draggedY = window.getBounds().y
    input('mouseDown')
    input('mouseUp')
    await delay(200)
    assert.equal((await act('window.pomodoro.getState()')).collapsed, false)
    await act('window.pomodoro.setCollapsed(true)')
    await delay(100)
    assert.equal(window.getBounds().y, draggedY)
    await act('window.pomodoro.setCollapsed(false)')
    await delay(100)

    const beforeResize = window.getBounds()
    cursor = { x: beforeResize.x + 11, y: beforeResize.y + 11 }
    input('mouseDown', 11, 11)
    await delay(100)
    cursor = { x: cursor.x + 300, y: cursor.y + 300 }
    input('mouseMove', 8, 8)
    await delay(100)
    input('mouseUp', 8, 8)
    await delay(200)
    assert.equal(window.getBounds().width, 320)
    assert.equal(window.getBounds().height, 500)
    assert.equal(await act('document.querySelector(".controls").getBoundingClientRect().bottom <= innerHeight'), true)
    fs.writeFileSync(path.join(profile, 'minimum-window.png'), (await window.webContents.capturePage()).toPNG())
    await act('window.pomodoro.setCollapsed(true)')
    await act('window.pomodoro.setCollapsed(false)')
    await delay(100)
    assert.equal(window.getBounds().width, 320)
    assert.equal(window.getBounds().height, 500)
    const saved = JSON.parse(fs.readFileSync(path.join(profile, 'timer-state.json'), 'utf8'))
    assert.deepEqual(saved.expandedSize, { width: 320, height: 500 })
    screen.getCursorScreenPoint = originalCursor

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
