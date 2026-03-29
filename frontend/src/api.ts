const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

// ─── Generator ────────────────────────────────────────────────────────────────

export interface GenerateRequest {
  week_start: string
  grade: '5' | '6' | '7' | '8'
  class_type: 'grade_level' | 'honors'
  specific_date?: string
}

export interface HWDay {
  date: string
  dow: string
  day_num: string
}

export interface HWWeek {
  week_start: string
  days: HWDay[]
}

export async function fetchWeeks(grade: string): Promise<HWWeek[]> {
  const res = await fetch(`${API_URL}/api/weeks/${grade}`)
  if (!res.ok) throw new Error('Failed to fetch weeks')
  const data = await res.json()
  return data.weeks ?? []
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
  } catch { return false }
}

// ─── Bank ─────────────────────────────────────────────────────────────────────

export type Domain =
  | 'arithmetic'
  | 'expressions_equations'
  | 'geometry'
  | 'stats_probability'
  | 'other'
  | '_inbox'

export interface BankProblem {
  id: string
  domain: Domain | null
  grade: number
  quarter: number | null
  suggested_quarter?: number | null
  suggested_domain?: string | null
  topic: string
  latex: string
  answer_latex: string
  source_file: string
  source_problem_number: number | null
  approved: boolean
  flagged: boolean
  honors?: boolean
  notes: string
}

export interface ReviewResponse {
  total: number
  offset: number
  limit: number
  problems: BankProblem[]
}

export async function fetchReviewQueue(
  domain: Domain,
  grade = 6,
  offset = 0,
  limit = 50,
): Promise<ReviewResponse> {
  const params = new URLSearchParams({
    grade: String(grade),
    approved: 'false',
    offset: String(offset),
    limit: String(limit),
  })
  const res = await fetch(`${API_URL}/api/bank/review?${params}`)
  if (!res.ok) throw new Error('Failed to fetch review queue')
  return res.json()
}

export async function fetchBankStats(grade = 6): Promise<any> {
  const res = await fetch(`${API_URL}/api/bank/stats?grade=${grade}`)
  if (!res.ok) throw new Error('Failed to fetch bank stats')
  return res.json()
}

export async function approveProblem(params: {
  problem_id: string
  domain: string
  quarter: number
  notes: string
  grade: number
  honors?: boolean
}): Promise<void> {
  const res = await fetch(`${API_URL}/api/bank/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  if (!res.ok) throw new Error('Failed to approve problem')
}

export async function flagProblem(problem_id: string, notes: string, grade: number): Promise<void> {
  const res = await fetch(`${API_URL}/api/bank/flag`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ problem_id, notes, grade }),
  })
  if (!res.ok) throw new Error('Failed to flag problem')
}

export async function deleteProblem(problem_id: string, grade: number): Promise<void> {
  const res = await fetch(`${API_URL}/api/bank/delete`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ problem_id, grade }),
  })
  if (!res.ok) throw new Error('Failed to delete problem')
}

export async function editProblem(problem_id: string, latex: string, grade: number): Promise<void> {
  const res = await fetch(`${API_URL}/api/bank/edit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ problem_id, latex, grade }),
  })
  if (!res.ok) throw new Error('Failed to save edit')
}
