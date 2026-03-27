const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

export interface GenerateRequest {
  week_start: string
  grade: '5' | '6' | '7' | '8'
  class_type: 'grade_level' | 'honors'
  specific_date?: string   // YYYY-MM-DD; if set, generates one day only
}

export interface SchoolDay {
  date: string   // YYYY-MM-DD
  dow: string    // e.g. "Monday"
  day_num: string
}

export interface SchoolWeek {
  week_start: string   // YYYY-MM-DD (Monday)
  days: SchoolDay[]
}

export async function fetchSchoolWeeks(grade: string): Promise<SchoolWeek[]> {
  const res = await fetch(`${API_URL}/api/weeks/${grade}`)
  if (!res.ok) throw new Error('Failed to load school calendar')
  const data = await res.json()
  return data.weeks
}

export async function generateHomework(req: GenerateRequest): Promise<Blob> {
  const res = await fetch(`${API_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? 'Generation failed')
  }

  return res.blob()
}

export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/health`)
    return res.ok
  } catch {
    return false
  }
}
