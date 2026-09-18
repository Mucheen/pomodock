export function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function monthKey(date) {
  return dateKey(date).slice(0, 7)
}

export function shiftMonth(month, offset) {
  const [year, number] = month.split('-').map(Number)
  return monthKey(new Date(year, number - 1 + offset, 1, 12))
}

export function selectionInMonth(month, selectedDate, today) {
  const [year, number] = month.split('-').map(Number)
  const lastDay = new Date(year, number, 0, 12).getDate()
  const day = Math.min(Number(selectedDate.slice(8)), lastDay)
  const date = `${month}-${String(day).padStart(2, '0')}`
  return date > today ? today : date
}

export function calendarDays(month) {
  const [year, number] = month.split('-').map(Number)
  const first = new Date(year, number - 1, 1, 12)
  const offset = (first.getDay() + 6) % 7
  const count = new Date(year, number, 0, 12).getDate()
  const length = Math.ceil((offset + count) / 7) * 7
  return Array.from({ length }, (_, index) => {
    const day = index - offset + 1
    return day < 1 || day > count ? null : dateKey(new Date(year, number - 1, day, 12))
  })
}

export function monthSummary(records, month) {
  return Object.entries(records).reduce((result, [date, record]) => {
    if (date.startsWith(`${month}-`) && record.focusRounds > 0) {
      result.focusRounds += record.focusRounds
      result.activeDays += 1
    }
    return result
  }, { focusRounds: 0, activeDays: 0 })
}

export function roundProgress(cycleFocusRounds, goal) {
  return Array.from({ length: goal }, (_, index) => index < cycleFocusRounds)
}
