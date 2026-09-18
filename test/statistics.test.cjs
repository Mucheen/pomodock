const test = require('node:test')
const assert = require('node:assert/strict')
const { localDateKey, normalizeStatistics, refreshStatisticsDate, recordFocusCompletion, statisticsSummary } = require('../electron/statistics.cjs')

const at = (value) => new Date(value).getTime()
const beforeMidnight = at('2026-09-17T23:59:59')
const afterMidnight = at('2026-09-18T00:00:01')

test('new installs start with zero rounds today', () => {
  const state = normalizeStatistics({}, afterMidnight)
  assert.deepEqual(statisticsSummary(state, afterMidnight), {
    statisticsDate: '2026-09-18', todayFocusRounds: 0, todayFocusMinutes: 0,
  })
})

test('legacy total is preserved without inventing historical dates, once only', () => {
  const state = normalizeStatistics({ completedFocusRounds: 3 }, afterMidnight)
  assert.equal(state.legacyFocusRounds, 3)
  assert.equal(state.completedFocusRounds, 3)
  assert.deepEqual(state.dailyRecords, {})
  recordFocusCompletion(state, afterMidnight, 25, afterMidnight)
  const reloaded = normalizeStatistics(JSON.parse(JSON.stringify(state)), afterMidnight)
  assert.equal(reloaded.legacyFocusRounds, 3)
  assert.equal(reloaded.completedFocusRounds, 4)
  assert.equal(statisticsSummary(reloaded, afterMidnight).todayFocusRounds, 1)
})

test('midnight refresh preserves previous records, timer fields and long-break cycle', () => {
  for (const status of ['idle', 'paused', 'running']) {
    const state = { ...normalizeStatistics({}, beforeMidnight), status, targetEndAt: afterMidnight + 60_000, remainingMs: 60_000, phase: 'focus' }
    recordFocusCompletion(state, beforeMidnight, 25, beforeMidnight)
    assert.equal(refreshStatisticsDate(state, afterMidnight), true)
    assert.equal(refreshStatisticsDate(state, afterMidnight), false)
    assert.equal(statisticsSummary(state, afterMidnight).todayFocusRounds, 0)
    assert.equal(state.dailyRecords['2026-09-17'].focusRounds, 1)
    assert.equal(state.completedFocusRounds, 1)
    assert.equal(state.status, status)
    assert.equal(state.targetEndAt, afterMidnight + 60_000)
    assert.equal(state.remainingMs, 60_000)
  }
})

test('delayed completion is credited to the scheduled completion date', () => {
  const state = normalizeStatistics({}, afterMidnight)
  recordFocusCompletion(state, beforeMidnight, 25, afterMidnight)
  assert.deepEqual(state.dailyRecords['2026-09-17'], { focusRounds: 1, focusMinutes: 25 })
  assert.equal(statisticsSummary(state, afterMidnight).todayFocusRounds, 0)
  recordFocusCompletion(state, afterMidnight, 10, afterMidnight)
  recordFocusCompletion(state, afterMidnight + 600_000, 15, afterMidnight)
  assert.deepEqual(state.dailyRecords['2026-09-18'], { focusRounds: 2, focusMinutes: 25 })
})

test('invalid records are ignored and real leap days are retained', () => {
  const state = normalizeStatistics({
    statisticsVersion: 1,
    dailyRecords: {
      '2024-02-29': { focusRounds: 2, focusMinutes: 50 },
      '2026-02-29': { focusRounds: 1, focusMinutes: 25 },
      '2026-13-01': { focusRounds: 1, focusMinutes: 25 },
      '2026-09-18': { focusRounds: -1, focusMinutes: 25 },
      'not-a-date': { focusRounds: 1, focusMinutes: 25 },
    },
  }, afterMidnight)
  assert.deepEqual(state.dailyRecords, { '2024-02-29': { focusRounds: 2, focusMinutes: 50 } })
  assert.equal(state.completedFocusRounds, 2)
})

test('date keys use the local calendar rather than UTC', () => {
  const { execFileSync } = require('node:child_process')
  const script = `const {localDateKey}=require('./electron/statistics.cjs');process.stdout.write(localDateKey(Date.parse('2026-09-17T16:01:00Z')))`
  for (const [timezone, expected] of [['Asia/Shanghai', '2026-09-18'], ['America/Los_Angeles', '2026-09-17']]) {
    const result = execFileSync(process.execPath, ['-e', script], { cwd: require('node:path').join(__dirname, '..'), env: { ...process.env, TZ: timezone }, encoding: 'utf8' })
    assert.equal(result, expected)
  }
  assert.equal(localDateKey(beforeMidnight), '2026-09-17')
})
