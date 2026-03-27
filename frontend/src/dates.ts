import { format, startOfWeek } from 'date-fns'

/** Returns the Monday of the week containing the given date */
export function getMonday(date: Date): Date {
  return startOfWeek(date, { weekStartsOn: 1 })
}

/** Format a Monday date for display: "Sep 22 – 26, 2026" */
export function formatWeekRange(mondayStr: string): string {
  const monday = new Date(mondayStr + 'T12:00:00')
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

/** Format a day-of-week string to a short label: "Monday" → "Mon" */
export function shortDow(dow: string): string {
  return dow.slice(0, 3)
}
