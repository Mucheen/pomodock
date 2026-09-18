import test from 'node:test'
import assert from 'node:assert/strict'
import { calendarDays, roundProgress, shiftMonth, monthSummary, selectionInMonth } from '../src/history.mjs'

test('calendar uses Monday-first weeks and actual month lengths', () => {
  const september = calendarDays('2026-09')
  assert.equal(september.length, 35)
  assert.equal(september[0], null)
  assert.equal(september[1], '2026-09-01')
  assert.equal(september.filter(Boolean).length, 30)
  assert.equal(calendarDays('2024-02').filter(Boolean).length, 29)
  assert.equal(calendarDays('2026-03').length, 42)
})

test('month navigation crosses year boundaries', () => {
  assert.equal(shiftMonth('2026-01', -1), '2025-12')
  assert.equal(shiftMonth('2026-12', 1), '2027-01')
})

test('selected day follows the visible month, clamped to month length and today', () => {
  assert.equal(selectionInMonth('2026-08', '2026-09-17', '2026-09-18'), '2026-08-17')
  assert.equal(selectionInMonth('2026-02', '2026-01-31', '2026-09-18'), '2026-02-28')
  assert.equal(selectionInMonth('2026-09', '2026-08-28', '2026-09-18'), '2026-09-18')
})

test('monthly totals exclude other months and empty days', () => {
  assert.deepEqual(monthSummary({
    '2026-09-01': { focusRounds: 3 }, '2026-09-17': { focusRounds: 2 },
    '2026-09-18': { focusRounds: 0 }, '2026-08-01': { focusRounds: 5 },
  }, '2026-09'), { focusRounds: 5, activeDays: 2 })
})

test('cycle dots follow this group, independent of daily and legacy totals', () => {
  const state = { completedFocusRounds: 3, todayFocusRounds: 8, cycleFocusRounds: 0 }
  assert.deepEqual(roundProgress(state.cycleFocusRounds, 4), [false, false, false, false])
  assert.deepEqual(roundProgress(1, 4), [true, false, false, false])
  assert.deepEqual(roundProgress(3, 4), [true, true, true, false])
  assert.deepEqual(roundProgress(4, 4), [true, true, true, true])
  assert.deepEqual(roundProgress(0, 4), [false, false, false, false])
})
