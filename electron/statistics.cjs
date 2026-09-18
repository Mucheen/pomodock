const STATISTICS_VERSION = 1

function localDateKey(timestamp = Date.now()) {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function isDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T12:00:00`)
  return Number.isFinite(date.getTime()) && localDateKey(date) === value
}

function nonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0
}

function normalizeStatistics(persisted = {}, now = Date.now()) {
  const dailyRecords = {}
  const records = persisted.dailyRecords
  if (records && typeof records === 'object' && !Array.isArray(records)) {
    for (const [date, record] of Object.entries(records)) {
      if (!isDateKey(date) || !record || typeof record !== 'object') continue
      const focusRounds = nonNegativeInteger(record.focusRounds)
      if (focusRounds > 0) {
        dailyRecords[date] = { focusRounds, focusMinutes: nonNegativeInteger(record.focusMinutes) }
      }
    }
  }
  const datedRounds = Object.values(dailyRecords).reduce((sum, record) => sum + record.focusRounds, 0)
  const previousTotal = nonNegativeInteger(persisted.completedFocusRounds)
  // Older versions stored only a total, so never invent dates for those rounds.
  const legacyFocusRounds = persisted.statisticsVersion === STATISTICS_VERSION
    ? nonNegativeInteger(persisted.legacyFocusRounds)
    : Math.max(0, previousTotal - datedRounds)

  return {
    statisticsVersion: STATISTICS_VERSION,
    statisticsDate: localDateKey(now),
    dailyRecords,
    legacyFocusRounds,
    // Historical total is independent of both today's count and the active cycle.
    completedFocusRounds: Math.max(previousTotal, datedRounds + legacyFocusRounds),
  }
}

function refreshStatisticsDate(state, now = Date.now()) {
  const today = localDateKey(now)
  if (state.statisticsDate === today) return false
  state.statisticsDate = today
  return true
}

function recordFocusCompletion(state, completedAt, focusMinutes, now = Date.now()) {
  const date = localDateKey(completedAt)
  const previous = state.dailyRecords[date] || { focusRounds: 0, focusMinutes: 0 }
  state.dailyRecords[date] = {
    focusRounds: previous.focusRounds + 1,
    focusMinutes: previous.focusMinutes + nonNegativeInteger(focusMinutes),
  }
  state.completedFocusRounds += 1
  refreshStatisticsDate(state, now)
}

function statisticsSummary(state, now = Date.now()) {
  const today = localDateKey(now)
  const record = state.dailyRecords[today]
  return {
    statisticsDate: today,
    todayFocusRounds: record?.focusRounds || 0,
    todayFocusMinutes: record?.focusMinutes || 0,
  }
}

module.exports = { localDateKey, normalizeStatistics, refreshStatisticsDate, recordFocusCompletion, statisticsSummary }
