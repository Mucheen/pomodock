const { app, BrowserWindow, ipcMain, Menu, Notification, powerMonitor, screen } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { normalizeStatistics, refreshStatisticsDate, recordFocusCompletion, statisticsSummary } = require('./statistics.cjs')
const { EXPANDED_SIZE, normalizeEdgePosition, normalizeExpandedSize, edgeBounds, edgePositionAt, resizeBounds } = require('./edge-position.cjs')

const DEFAULT_CONFIG = {
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 25,
  roundsBeforeLongBreak: 4,
}

let mainWindow
let ticker
let collapsed = false
let edgeDrag = null
let windowResize = null
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
    edgePosition: null,
    expandedSize: { ...EXPANDED_SIZE },
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
    state.edgePosition = normalizeEdgePosition(persisted.edgePosition)
    state.expandedSize = normalizeExpandedSize(persisted.expandedSize)

    if (!['focus', 'shortBreak', 'longBreak'].includes(state.phase)) state.phase = 'focus'
    if (!['idle', 'running', 'paused'].includes(state.status)) state.status = 'idle'
    if (state.status === 'running' && !Number.isFinite(state.targetEndAt)) {
      state.status = 'paused'
      state.targetEndAt = null
    }
    // Refresh the visible daily counter before the first renderer state is sent.
    refreshStatisticsDate(state)
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

  // Keep the calendar in the main process. Timer updates only need the summary.
  const { dailyRecords, ...timerState } = state
  return { ...timerState, ...statisticsSummary(state), remainingMs, collapsed }
}

function historyState() {
  return { dailyRecords: state.dailyRecords, legacyFocusRounds: state.legacyFocusRounds }
}

function scheduleTick() {
  clearTimeout(ticker)
  const now = Date.now()
  const midnight = new Date(now)
  midnight.setHours(24, 0, 0, 0)
  let delay = Math.min(60_000, Math.max(1, midnight.getTime() - now))
  if (state.status === 'running') {
    const remaining = Math.max(0, state.targetEndAt - now)
    const resolution = collapsed ? 60_000 : 1000
    // Wake at the next displayed second/minute or the exact completion deadline.
    const nextBoundary = remaining - (Math.ceil(remaining / resolution) - 1) * resolution
    delay = Math.min(delay, Math.max(1, nextBoundary))
  }
  ticker = setTimeout(tick, delay)
}

function broadcast() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('timer:state', publicState())
  }
  scheduleTick()
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
  endEdgeDrag()
  endWindowResize()
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
  const dateChanged = refreshStatisticsDate(state)
  if (dateChanged) saveState()
  if (state.status !== 'running') {
    if (dateChanged) broadcast()
    else scheduleTick()
    return
  }
  state.remainingMs = Math.max(0, state.targetEndAt - Date.now())
  if (state.remainingMs <= 0) {
    completePhase()
    return
  }
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
  const display = edgeDisplay()
  if (state.edgePosition && state.edgePosition.displayId !== display.id) {
    state.edgePosition = { ...state.edgePosition, displayId: display.id }
    saveState()
  }
  mainWindow.setBounds(edgeBounds(display, state.edgePosition, shouldCollapse, state.expandedSize), false)
}

function edgeDisplay() {
  return screen.getAllDisplays().find((display) => display.id === state.edgePosition?.displayId)
    || screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
}

function beginEdgeDrag() {
  if (!collapsed || !mainWindow || mainWindow.isDestroyed()) return
  edgeDrag = {
    display: edgeDisplay(),
    cursorY: screen.getCursorScreenPoint().y,
    windowY: mainWindow.getBounds().y,
    moved: false,
  }
}

function moveEdgeDrag() {
  if (!edgeDrag || !collapsed) return
  // Both coordinates come from Electron in DIP, including on scaled Windows displays.
  const delta = screen.getCursorScreenPoint().y - edgeDrag.cursorY
  if (!edgeDrag.moved && Math.abs(delta) < 4) return
  edgeDrag.moved = true
  state.edgePosition = edgePositionAt(edgeDrag.display, edgeDrag.windowY + delta)
  positionWindow(true)
}

function endEdgeDrag() {
  if (edgeDrag?.moved) saveState()
  edgeDrag = null
}

function beginWindowResize(_event, direction) {
  if (collapsed || !mainWindow || mainWindow.isDestroyed() || !['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].includes(direction)) return
  const bounds = mainWindow.getBounds()
  windowResize = { direction, bounds, cursor: screen.getCursorScreenPoint(), area: screen.getDisplayMatching(bounds).workArea, moved: false }
}

function moveWindowResize() {
  if (!windowResize || collapsed) return
  const cursor = screen.getCursorScreenPoint()
  const next = resizeBounds(windowResize.bounds, windowResize.direction, { x: cursor.x - windowResize.cursor.x, y: cursor.y - windowResize.cursor.y }, windowResize.area)
  state.expandedSize = { width: next.width, height: next.height }
  windowResize.moved = true
  mainWindow.setBounds(next, false)
}

function endWindowResize() {
  if (windowResize?.moved) saveState()
  windowResize = null
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
      backgroundThrottling: true,
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

  mainWindow.on('blur', () => { endEdgeDrag(); endWindowResize() })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function registerIpc() {
  ipcMain.handle('timer:get-state', () => publicState())
  ipcMain.handle('timer:get-history', () => historyState())
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
    endEdgeDrag()
    endWindowResize()
    collapsed = Boolean(nextCollapsed)
    positionWindow(collapsed)
    broadcast()
    return publicState()
  })
  ipcMain.on('window:edge-drag-start', beginEdgeDrag)
  ipcMain.on('window:edge-drag-move', moveEdgeDrag)
  ipcMain.on('window:edge-drag-end', endEdgeDrag)
  ipcMain.on('window:resize-start', beginWindowResize)
  ipcMain.on('window:resize-move', moveWindowResize)
  ipcMain.on('window:resize-end', endWindowResize)
  ipcMain.handle('window:quit', () => app.quit())
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  if (process.platform === 'win32') app.setAppUserModelId('com.pomodock.app')
  loadState()
  registerIpc()
  createWindow()
  scheduleTick()
  powerMonitor.on('resume', tick)
  const reposition = () => { endEdgeDrag(); endWindowResize(); positionWindow(collapsed) }
  screen.on('display-metrics-changed', reposition)
  screen.on('display-removed', reposition)

  app.on('activate', () => {
    if (!mainWindow) createWindow()
    else showExpanded()
  })
})

app.on('second-instance', () => {
  if (mainWindow) showExpanded()
})

app.on('before-quit', () => {
  clearTimeout(ticker)
  saveState()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
