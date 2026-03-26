import { format, startOfWeek, addWeeks, subWeeks } from 'date-fns'

/** Returns the Monday of the week containing the given date */
export function getMonday(date: Date): Date {
  return startOfWeek(date, { weekStartsOn: 1 })
}

/** Format a Monday date for display: "Sep 22 – 26, 2026" */
export function formatWeekRange(monday: Date): string {
  const friday = new Date(monday)
  friday.setDate(monday.getDate() + 4)
  const m = format(monday, 'MMM d')
  const f = format(friday, 'd, yyyy')
  return `${m} – ${f}`
}

/** Format a Monday date for the API: "YYYY-MM-DD" */
export function formatISO(date: Date): string {
  return format(date, 'yyyy-MM-dd')
}

export function nextWeek(monday: Date): Date {
  return addWeeks(monday, 1)
}

export function prevWeek(monday: Date): Date {
  return subWeeks(monday, 1)
}

/** All Mondays in the school year, August 2026 – June 2027 */
export function schoolYearWeeks(): Date[] {
  const weeks: Date[] = []
  let current = getMonday(new Date(2026, 7, 17)) // Aug 17 2026
  const end = new Date(2027, 5, 14)              // Jun 14 2027
  while (current <= end) {
    weeks.push(new Date(current))
    current = addWeeks(current, 1)
  }
  return weeks
}
