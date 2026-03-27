const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

// ─── Homework generation ───────────────────────────────────────────────────────

export interface GenerateRequest {
  week_start: string
  grade: '5' | '6' | '7' | '8'
  class_type: 'grade_level' | 'honors'
  specific_date?: string   // YYYY-MM-DD; if set, generate one day only
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

// ─── Problem bank ──────────────────────────────────────────────────────────────

export type Domain =
  | 'fractions_decimals'
  | 'expressions_equations'
  | 'geometry'
  | 'stats_probability'

export interface BankProblem {
  id: string
  domain: Domain
  grade: number
  quarter: number
  topic: string
  latex: string
  answer_latex: string
  source_file: string
  source_problem_number: number
  approved: boolean
  flagged: boolean
  notes: string
  _file_path?: string
}

export interface ReviewResponse {
  total: number
  offset: number
  limit: number
  problems: BankProblem[]
}

export interface BankStats {
  grade: number
  domains: Record<Domain, {
    total: number
    approved: number
    flagged: number
    by_quarter: Record<string, { total: number; approved: number; flagged: number }>
  }>
}

export async function fetchReviewQueue(
  domain: Domain,
  grade = 6,
  offset = 0,
  limit = 20,
): Promise<ReviewResponse> {
  const params = new URLSearchParams({
    domain,
    grade: String(grade),
    approved: 'false',
    offset: String(offset),
    limit: String(limit),
  })
  const res = await fetch(`${API_URL}/api/bank/review?${params}`)
  if (!res.ok) throw new Error('Failed to fetch review queue')
  return res.json()
}

export async function approveProblem(
  problem: BankProblem,
  finalQuarter: number,
  notes = '',
  flagged = false,
): Promise<void> {
  const res = await fetch(`${API_URL}/api/bank/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      problem_id: problem.id,
      grade:      problem.grade,
      domain:     problem.domain,
      quarter:    finalQuarter,
      notes,
      flagged,
    }),
  })
  if (!res.ok) throw new Error('Failed to approve problem')
}

export async function deleteProblem(problem: BankProblem): Promise<void> {
  const res = await fetch(`${API_URL}/api/bank/delete`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      problem_id: problem.id,
      grade:      problem.grade,
      domain:     problem.domain,
    }),
  })
  if (!res.ok) throw new Error('Failed to delete problem')
}

export async function fetchBankStats(grade = 6): Promise<BankStats> {
  const res = await fetch(`${API_URL}/api/bank/stats?grade=${grade}`)
  if (!res.ok) throw new Error('Failed to fetch bank stats')
  return res.json()
}
