const { app, BrowserWindow, ipcMain, Notification, screen } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { normalizeStatistics, refreshStatisticsDate, recordFocusCompletion, statisticsSummary } = require('./statistics.cjs')

const COLLAPSED_SIZE = { width: 60, height: 148 }
const EXPANDED_SIZE = { width: 392, height: 620 }
const DEFAULT_CONFIG = {
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 25,
  roundsBeforeLongBreak: 4,
}

let mainWindow
let ticker
let collapsed = false
let state = createInitialState()

if (!app.requestSingleInstanceLock()) app.exit(0)

function createInitialState() {
  return {
    config: { ...DEFAULT_CONFIG },
    phase: 'focus',
    status: 'idle',
    remainingMs: DEFAULT_CONFIG.focusMinutes * 60_000,
    targetEndAt: null,
    ...normalizeStatistics(),
    cycleVersion: 1,
    cycleFocusRounds: 0,
    alarm: false,
    nextPhase: null,
  }
}

function stateFile() {
  return path.join(app.getPath('userData'), 'timer-state.json')
}

function durationFor(phase, config = state.config) {
  const minutes = {
    focus: config.focusMinutes,
    shortBreak: config.shortBreakMinutes,
    longBreak: config.longBreakMinutes,
  }[phase]
  return minutes * 60_000
}

function sanitizeConfig(input = {}) {
  const numberWithin = (value, fallback, min, max) => {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.round(parsed))) : fallback
  }

  return {
    focusMinutes: numberWithin(input.focusMinutes, DEFAULT_CONFIG.focusMinutes, 1, 180),
    shortBreakMinutes: numberWithin(input.shortBreakMinutes, DEFAULT_CONFIG.shortBreakMinutes, 1, 60),
    longBreakMinutes: numberWithin(input.longBreakMinutes, DEFAULT_CONFIG.longBreakMinutes, 1, 120),
    roundsBeforeLongBreak: numberWithin(input.roundsBeforeLongBreak, DEFAULT_CONFIG.roundsBeforeLongBreak, 2, 12),
  }
}

function loadState() {
  try {
    const persisted = JSON.parse(fs.readFileSync(stateFile(), 'utf8'))
    if (!persisted || typeof persisted !== 'object' || Array.isArray(persisted)) throw new Error('Invalid timer state')
    const needsMigration = persisted.statisticsVersion !== 1
    if (needsMigration) {
      const backupFile = path.join(app.getPath('userData'), 'timer-state.before-statistics.json')
      try {
        if (!fs.existsSync(backupFile)) fs.copyFileSync(stateFile(), backupFile)
      } catch (error) {
        console.error('Unable to back up timer state:', error)
      }
    }
    state = {
      ...createInitialState(),
      ...persisted,
      config: sanitizeConfig(persisted.config),
      ...normalizeStatistics(persisted),
    }

    // Undated legacy totals never count towards a newly introduced cycle.
    state.cycleFocusRounds = persisted.cycleVersion === 1 && Number.isSafeInteger(persisted.cycleFocusRounds)
      ? Math.min(state.config.roundsBeforeLongBreak, Math.max(0, persisted.cycleFocusRounds))
      : 0
    state.cycleVersion = 1

    if (!['focus', 'shortBreak', 'longBreak'].includes(state.phase)) state.phase = 'focus'
    if (!['idle', 'running', 'paused'].includes(state.status)) state.status = 'idle'
    if (state.status === 'running' && !Number.isFinite(state.targetEndAt)) {
      state.status = 'paused'
      state.targetEndAt = null
    }
    saveState()
  } catch {
    state = createInitialState()
  }
}

function saveState() {
  try {
    fs.mkdirSync(path.dirname(stateFile()), { recursive: true })
    fs.writeFileSync(stateFile(), JSON.stringify(state, null, 2), 'utf8')
  } catch (error) {
    console.error('Unable to save timer state:', error)
  }
}

function publicState() {
  if (refreshStatisticsDate(state)) saveState()
  const remainingMs = state.status === 'running'
    ? Math.max(0, state.targetEndAt - Date.now())
    : Math.max(0, state.remainingMs)

  return { ...state, ...statisticsSummary(state), remainingMs, collapsed }
}

function broadcast() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('timer:state', publicState())
  }
}

function nextPhaseAfterCurrent() {
  if (state.phase !== 'focus') return 'focus'
  const roundsAfterCompletion = state.cycleFocusRounds + 1
  return roundsAfterCompletion >= state.config.roundsBeforeLongBreak
    ? 'longBreak'
    : 'shortBreak'
}

function notificationCopy(completedPhase) {
  if (completedPhase === 'focus') {
    if (state.nextPhase === 'longBreak') {
      return { title: '本组专注完成', body: `${state.config.roundsBeforeLongBreak} 轮专注已完成，开始 ${state.config.longBreakMinutes} 分钟长休息吧。` }
    }
    return { title: '专注完成', body: '做得好，起来活动一下吧。' }
  }
  if (completedPhase === 'longBreak') {
    return { title: '长休息结束', body: '本组循环结束，准备好后开始下一组专注。' }
  }
  return { title: '休息结束', body: '准备好后，开始下一轮专注。' }
}

function showExpanded() {
  collapsed = false
  positionWindow(false)
  mainWindow.show()
  mainWindow.focus()
  broadcast()
}

function notifyCompletion(completedPhase) {
  const copy = notificationCopy(completedPhase)
  if (Notification.isSupported()) {
    const notification = new Notification({
      title: copy.title,
      body: copy.body,
      silent: false,
    })
    notification.on('click', showExpanded)
    notification.show()
  }

  if (process.platform === 'win32') mainWindow.flashFrame(true)
}

function completePhase() {
  const completedPhase = state.phase
  // On wake/relaunch, credit the scheduled completion day, not the later wake day.
  const completedAt = state.targetEndAt ?? Date.now()
  state.remainingMs = 0
  state.targetEndAt = null
  state.status = 'idle'
  state.alarm = true
  state.nextPhase = nextPhaseAfterCurrent()
  if (completedPhase === 'focus') {
    recordFocusCompletion(state, completedAt, state.config.focusMinutes)
    state.cycleFocusRounds = Math.min(state.config.roundsBeforeLongBreak, state.cycleFocusRounds + 1)
  } else if (completedPhase === 'longBreak') {
    state.cycleFocusRounds = 0
  }
  saveState()
  showExpanded()
  notifyCompletion(completedPhase)
}

function tick() {
  if (refreshStatisticsDate(state)) {
    saveState()
    broadcast()
  }
  if (state.status !== 'running') return
  state.remainingMs = Math.max(0, state.targetEndAt - Date.now())
  if (state.remainingMs <= 0) completePhase()
  broadcast()
}

function startTimer() {
  if (state.alarm || state.status === 'running') return publicState()
  if (state.remainingMs <= 0) state.remainingMs = durationFor(state.phase)
  state.targetEndAt = Date.now() + state.remainingMs
  state.status = 'running'
  saveState()
  broadcast()
  return publicState()
}

function pauseTimer() {
  if (state.status !== 'running') return publicState()
  state.remainingMs = Math.max(0, state.targetEndAt - Date.now())
  state.targetEndAt = null
  state.status = 'paused'
  saveState()
  broadcast()
  return publicState()
}

function resetTimer() {
  if (state.alarm) return finishAlarm(false)
  state.status = 'idle'
  state.alarm = false
  state.nextPhase = null
  state.targetEndAt = null
  state.remainingMs = durationFor(state.phase)
  saveState()
  broadcast()
  return publicState()
}

function switchToPhase(phase) {
  state.phase = phase
  state.status = 'idle'
  state.alarm = false
  state.nextPhase = null
  state.targetEndAt = null
  state.remainingMs = durationFor(phase)
}

function skipPhase() {
  if (state.alarm) return finishAlarm(false)
  if (state.phase === 'longBreak') state.cycleFocusRounds = 0
  switchToPhase(state.phase === 'focus' ? 'shortBreak' : 'focus')
  saveState()
  broadcast()
  return publicState()
}

function finishAlarm(startNext) {
  if (!state.alarm) return publicState()
  switchToPhase(state.nextPhase || 'focus')
  if (startNext) {
    state.targetEndAt = Date.now() + state.remainingMs
    state.status = 'running'
  }
  saveState()
  broadcast()
  return publicState()
}

function positionWindow(shouldCollapse = collapsed) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const area = display.workArea
  const size = shouldCollapse ? COLLAPSED_SIZE : EXPANDED_SIZE
  const x = area.x + area.width - size.width
  const y = Math.round(area.y + (area.height - size.height) / 2)
  mainWindow.setBounds({ x, y, ...size }, false)
}

function createWindow() {
  mainWindow = new BrowserWindow({
    ...EXPANDED_SIZE,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  })

  mainWindow.setAlwaysOnTop(true, 'floating')
  if (process.platform === 'darwin') mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  positionWindow(collapsed)
  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  if (rendererUrl) mainWindow.loadURL(rendererUrl)
  else mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
    tick()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function registerIpc() {
  ipcMain.handle('timer:get-state', () => publicState())
  ipcMain.handle('timer:configure', (_event, config) => {
    const wasRunning = state.status === 'running'
    if (wasRunning) pauseTimer()
    state.config = sanitizeConfig(config)
    state.cycleFocusRounds = 0
    switchToPhase('focus')
    saveState()
    broadcast()
    return publicState()
  })
  ipcMain.handle('timer:start', startTimer)
  ipcMain.handle('timer:pause', pauseTimer)
  ipcMain.handle('timer:reset', resetTimer)
  ipcMain.handle('timer:skip', skipPhase)
  ipcMain.handle('timer:finish-alarm', (_event, startNext) => finishAlarm(Boolean(startNext)))
  ipcMain.handle('window:set-collapsed', (_event, nextCollapsed) => {
    collapsed = Boolean(nextCollapsed)
    positionWindow(collapsed)
    broadcast()
    return publicState()
  })
  ipcMain.handle('window:quit', () => app.quit())
}

app.whenReady().then(() => {
  if (process.platform === 'win32') app.setAppUserModelId('com.pomodock.app')
  loadState()
  registerIpc()
  createWindow()
  ticker = setInterval(tick, 500)
  screen.on('display-metrics-changed', () => positionWindow(collapsed))
  screen.on('display-removed', () => positionWindow(collapsed))

  app.on('activate', () => {
    if (!mainWindow) createWindow()
    else showExpanded()
  })
})

app.on('second-instance', () => {
  if (mainWindow) showExpanded()
})

app.on('before-quit', () => {
  clearInterval(ticker)
  saveState()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
