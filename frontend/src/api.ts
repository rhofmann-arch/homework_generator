const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

// ── Homework generation ───────────────────────────────────────────────────────

export interface GenerateRequest {
  week_start: string         // "YYYY-MM-DD" — Monday of target week
  grade: '5' | '6' | '7' | '8'
  class_type: 'grade_level' | 'honors'
  specific_date?: string
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

// ── Problem bank ──────────────────────────────────────────────────────────────

export type Domain =
  | 'arithmetic'
  | 'expressions_equations'
  | 'geometry'
  | 'stats_probability'
  | 'other'

export const DOMAINS: { value: Domain; label: string }[] = [
  { value: 'arithmetic',            label: 'Arithmetic' },
  { value: 'expressions_equations', label: 'Expressions & Equations' },
  { value: 'geometry',              label: 'Geometry' },
  { value: 'stats_probability',     label: 'Stats & Probability' },
  { value: 'other',                 label: 'Other' },
]

export interface BankProblem {
  id: string
  domain: Domain | null
  grade: number
  quarter: number | null
  topic: string
  latex: string
  answer_latex: string
  suggested_quarter: number | null
  source_file: string
  source_problem_number: number | null
  approved: boolean
  flagged: boolean
  notes: string
}

export interface ReviewResponse {
  problems: BankProblem[]
  total: number
  offset: number
  limit: number
}

export interface BankStats {
  inbox: { total: number }
  domains: Record<Domain, { total: number; approved: number; flagged: number; pending: number }>
  totals: { total: number; approved: number; flagged: number; pending: number }
}

export async function fetchReviewQueue(params: {
  grade?: number
  inbox_only?: boolean
  domain?: Domain | null
  quarter?: number | null
  approved?: boolean
  limit?: number
  offset?: number
}): Promise<ReviewResponse> {
  const p = new URLSearchParams()
  p.set('grade', String(params.grade ?? 6))
  p.set('inbox_only', String(params.inbox_only ?? true))
  if (params.domain) p.set('domain', params.domain)
  if (params.quarter) p.set('quarter', String(params.quarter))
  if (params.approved !== undefined) p.set('approved', String(params.approved))
  if (params.limit !== undefined) p.set('limit', String(params.limit))
  if (params.offset !== undefined) p.set('offset', String(params.offset))

  const res = await fetch(`${API_URL}/api/bank/review?${p}`)
  if (!res.ok) throw new Error('Failed to load review queue')
  return res.json()
}

export async function fetchBankStats(grade = 6): Promise<BankStats> {
  const res = await fetch(`${API_URL}/api/bank/stats?grade=${grade}`)
  if (!res.ok) throw new Error('Failed to load bank stats')
  return res.json()
}

export async function approveProblem(params: {
  problem_id: string
  domain: Domain
  quarter: number
  notes?: string
  grade?: number
}): Promise<void> {
  const res = await fetch(`${API_URL}/api/bank/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grade: 6, ...params }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? 'Approve failed')
  }
}

export async function flagProblem(problem_id: string, notes = '', grade = 6): Promise<void> {
  const res = await fetch(`${API_URL}/api/bank/flag`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ problem_id, notes, grade }),
  })
  if (!res.ok) throw new Error('Flag failed')
}

export async function deleteProblem(problem_id: string, grade = 6): Promise<void> {
  const res = await fetch(`${API_URL}/api/bank/delete`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ problem_id, grade }),
  })
  if (!res.ok) throw new Error('Delete failed')
}
