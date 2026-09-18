const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

// Run the real main-process logic with an isolated in-memory disk and clock.
function harness(persisted, initialTime = '2026-09-17T23:59:59') {
  let now = new Date(initialTime).getTime()
  let broadcasts = 0
  const files = new Map([['/isolated/timer-state.json', JSON.stringify(persisted)]])
  const handlers = new Map()
  const fakeElectron = {
    app: { requestSingleInstanceLock: () => true, getPath: () => '/isolated', whenReady: () => ({ then() {} }), on() {} },
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    Notification: { isSupported: () => false },
    screen: { getCursorScreenPoint: () => ({ x: 0, y: 0 }), getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1400, height: 900 } }) },
  }
  const fakeFs = {
    readFileSync: (name) => { if (!files.has(name)) throw new Error('ENOENT'); return files.get(name) },
    writeFileSync: (name, value) => files.set(name, value),
    existsSync: (name) => files.has(name),
    copyFileSync: (source, target) => files.set(target, files.get(source)),
    mkdirSync() {},
  }
  class FakeDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])) }
    static now() { return now }
  }
  const context = vm.createContext({ Date: FakeDate, console, process: { platform: 'darwin', env: {} }, setInterval, clearInterval })
  const statisticsModule = { exports: {} }
  const statsSource = fs.readFileSync(path.join(__dirname, '../electron/statistics.cjs'), 'utf8')
  vm.runInContext(`(function(module) { ${statsSource}\n })`, context)(statisticsModule)
  const requireMock = (name) => ({ electron: fakeElectron, 'node:fs': fakeFs, 'node:path': path, './statistics.cjs': statisticsModule.exports })[name]
  const mainSource = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8')
  const timer = vm.runInContext(`(function(require) { ${mainSource}\n
    mainWindow = { isDestroyed: () => false, setBounds() {}, show() {}, focus() {}, webContents: { send: () => broadcastSpy() } };
    loadState(); registerIpc();
    return { tick, getState: publicState };
  })`, vm.createContext({ ...context, broadcastSpy: () => { broadcasts += 1 } }))(requireMock)
  return {
    files,
    tick: timer.tick,
    getState: () => JSON.parse(JSON.stringify(timer.getState())),
    advance: (value) => { now = new Date(value).getTime() },
    call: (name, ...args) => handlers.get(name)(undefined, ...args),
    get broadcasts() { return broadcasts },
  }
}

test('real tick refreshes an idle app at midnight and preserves yesterday', () => {
  const app = harness({ statisticsVersion: 1, completedFocusRounds: 2, dailyRecords: { '2026-09-17': { focusRounds: 2, focusMinutes: 50 } } })
  assert.equal(app.getState().todayFocusRounds, 2)
  app.advance('2026-09-18T00:00:00')
  app.tick()
  assert.equal(app.getState().todayFocusRounds, 0)
  assert.equal(app.getState().completedFocusRounds, 2)
  assert.equal(app.broadcasts, 1)
  app.tick()
  assert.equal(app.broadcasts, 1)
})

test('legacy migration backs up the original and survives a reload', () => {
  const original = { completedFocusRounds: 3, phase: 'shortBreak' }
  const app = harness(original)
  assert.deepEqual(JSON.parse(app.files.get('/isolated/timer-state.before-statistics.json')), original)
  assert.equal(app.getState().todayFocusRounds, 0)
  assert.equal(app.getState().legacyFocusRounds, 3)
  assert.equal(app.getState().cycleFocusRounds, 0)
  const reloaded = harness(JSON.parse(app.files.get('/isolated/timer-state.json')))
  assert.equal(reloaded.getState().legacyFocusRounds, 3)
  assert.equal(reloaded.files.has('/isolated/timer-state.before-statistics.json'), false)
})

test('running across midnight keeps its deadline and counts only once on completion', () => {
  const deadline = new Date('2026-09-18T00:01:00').getTime()
  const app = harness({ status: 'running', phase: 'focus', targetEndAt: deadline, completedFocusRounds: 3, cycleVersion: 1, cycleFocusRounds: 3 })
  app.advance('2026-09-18T00:00:00')
  app.tick()
  assert.equal(app.getState().status, 'running')
  assert.equal(app.getState().targetEndAt, deadline)
  assert.equal(app.getState().todayFocusRounds, 0)
  app.advance('2026-09-18T00:01:00')
  app.tick()
  assert.equal(app.getState().todayFocusRounds, 1)
  assert.equal(app.getState().nextPhase, 'longBreak')
  app.tick()
  assert.equal(app.getState().todayFocusRounds, 1)
  assert.equal(app.getState().completedFocusRounds, 4)
})

test('overdue focus on reopen credits yesterday, not today', () => {
  const app = harness({ status: 'running', phase: 'focus', targetEndAt: new Date('2026-09-17T23:58:00').getTime() }, '2026-09-18T08:00:00')
  app.tick()
  assert.equal(app.getState().todayFocusRounds, 0)
  assert.deepEqual(app.getState().dailyRecords['2026-09-17'], { focusRounds: 1, focusMinutes: 25 })
})

test('rest completion, skipping and resetting never add check-ins', () => {
  const app = harness({ status: 'running', phase: 'shortBreak', targetEndAt: new Date('2026-09-17T23:59:59').getTime() })
  app.tick()
  assert.equal(app.getState().todayFocusRounds, 0)
  app.call('timer:finish-alarm', false)
  app.call('timer:skip')
  app.call('timer:reset')
  assert.equal(app.getState().completedFocusRounds, 0)
  assert.deepEqual(app.getState().dailyRecords, {})
})

test('two full default cycles use four 25-minute focuses then a 25-minute long break', () => {
  const app = harness({ completedFocusRounds: 3 }, '2026-09-18T08:00:00')
  assert.deepEqual(app.getState().config, { focusMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 25, roundsBeforeLongBreak: 4 })
  app.call('timer:start')
  for (let group = 0; group < 2; group += 1) {
    for (let round = 1; round <= 4; round += 1) {
      assert.equal(app.getState().phase, 'focus')
      assert.equal(app.getState().remainingMs, 25 * 60_000)
      app.advance(app.getState().targetEndAt)
      app.tick()
      assert.equal(app.getState().cycleFocusRounds, round)
      assert.equal(app.getState().todayFocusRounds, group * 4 + round)
      assert.equal(app.getState().nextPhase, round === 4 ? 'longBreak' : 'shortBreak')
      app.call('timer:finish-alarm', true)
      assert.equal(app.getState().phase, round === 4 ? 'longBreak' : 'shortBreak')
      assert.equal(app.getState().remainingMs, (round === 4 ? 25 : 5) * 60_000)
      app.advance(app.getState().targetEndAt)
      app.tick()
      assert.equal(app.getState().cycleFocusRounds, round === 4 ? 0 : round)
      assert.equal(app.getState().todayFocusRounds, group * 4 + round)
      app.call('timer:finish-alarm', true)
    }
  }
  assert.equal(app.getState().cycleFocusRounds, 0)
  assert.equal(app.getState().phase, 'focus')
  assert.equal(app.getState().todayFocusRounds, 8)
  assert.equal(app.getState().todayFocusMinutes, 200)
  assert.equal(app.getState().completedFocusRounds, 11)
})

test('old cumulative rounds do not trigger an early long break in the new cycle', () => {
  const app = harness({ completedFocusRounds: 3 }, '2026-09-18T08:00:00')
  app.call('timer:start')
  app.advance(app.getState().targetEndAt)
  app.tick()
  assert.equal(app.getState().completedFocusRounds, 4)
  assert.equal(app.getState().cycleFocusRounds, 1)
  assert.equal(app.getState().nextPhase, 'shortBreak')
})

test('midnight refresh and reload preserve this group independently of today', () => {
  const app = harness({ cycleVersion: 1, cycleFocusRounds: 2, completedFocusRounds: 2,
    statisticsVersion: 1, dailyRecords: { '2026-09-17': { focusRounds: 2, focusMinutes: 50 } } })
  app.advance('2026-09-18T00:00:01')
  app.tick()
  assert.equal(app.getState().todayFocusRounds, 0)
  assert.equal(app.getState().cycleFocusRounds, 2)
  const reloaded = harness(JSON.parse(app.files.get('/isolated/timer-state.json')), '2026-09-18T00:00:01')
  assert.equal(reloaded.getState().cycleFocusRounds, 2)
  reloaded.call('timer:start')
  reloaded.call('timer:pause')
  reloaded.call('timer:start')
  assert.equal(reloaded.getState().cycleFocusRounds, 2)
})

test('skipping focus never advances the group and resetting long break keeps four dots', () => {
  const app = harness({ cycleVersion: 1, cycleFocusRounds: 2 }, '2026-09-18T08:00:00')
  app.call('timer:skip')
  assert.equal(app.getState().cycleFocusRounds, 2)
  assert.equal(app.getState().todayFocusRounds, 0)
  const longBreak = harness({ phase: 'longBreak', cycleVersion: 1, cycleFocusRounds: 4 }, '2026-09-18T08:00:00')
  longBreak.call('timer:reset')
  assert.equal(longBreak.getState().cycleFocusRounds, 4)
  assert.equal(longBreak.getState().remainingMs, 25 * 60_000)
  longBreak.call('timer:skip')
  assert.equal(longBreak.getState().cycleFocusRounds, 0)
  assert.equal(longBreak.getState().phase, 'focus')
})

test('saving settings starts a fresh group without deleting check-in history', () => {
  const app = harness({ phase: 'longBreak', cycleVersion: 1, cycleFocusRounds: 4,
    statisticsVersion: 1, completedFocusRounds: 4, dailyRecords: { '2026-09-18': { focusRounds: 4, focusMinutes: 100 } } }, '2026-09-18T08:00:00')
  app.call('timer:configure', { focusMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 25, roundsBeforeLongBreak: 4 })
  assert.equal(app.getState().cycleFocusRounds, 0)
  assert.equal(app.getState().phase, 'focus')
  assert.equal(app.getState().remainingMs, 25 * 60_000)
  assert.equal(app.getState().todayFocusRounds, 4)
  assert.equal(app.getState().todayFocusMinutes, 100)
})

test('reset or skip at the fourth-focus alarm cannot bypass the long break', () => {
  for (const action of ['timer:reset', 'timer:skip']) {
    const app = harness({ phase: 'focus', cycleVersion: 1, cycleFocusRounds: 4, alarm: true, nextPhase: 'longBreak' })
    app.call(action)
    assert.equal(app.getState().phase, 'longBreak')
    assert.equal(app.getState().cycleFocusRounds, 4)
    assert.equal(app.getState().alarm, false)
  }
})
