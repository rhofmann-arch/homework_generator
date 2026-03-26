const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

export interface GenerateRequest {
  week_start: string         // "YYYY-MM-DD" — Monday of target week
  grade: '5' | '6' | '7' | '8'
  class_type: 'grade_level' | 'honors'
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
