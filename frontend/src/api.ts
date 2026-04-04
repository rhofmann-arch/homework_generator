import JSZip from 'jszip'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

// ── Generate ──────────────────────────────────────────────────────────────────

export interface GenerateRequest {
  week_start: string
  grade: '5' | '6' | '7' | '8'
  class_type: 'grade_level' | 'honors'
  specific_date?: string
}

export interface GenerateResult {
  homeworkBlob: Blob
  keyBlob: Blob
}

export async function generateHomework(req: GenerateRequest): Promise<GenerateResult> {
  const res = await fetch(`${API_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? 'Generation failed')
  }

  const zipBlob = await res.blob()
  const zip = await JSZip.loadAsync(zipBlob)

  const files = Object.keys(zip.files)
  const hwFile  = files.find(f => !f.includes('_KEY'))
  const keyFile = files.find(f => f.includes('_KEY'))

  if (!hwFile || !keyFile) {
    throw new Error('ZIP response missing expected homework or key file')
  }

  const [hwBlob, keyBlob] = await Promise.all([
    zip.files[hwFile].async('blob').then(b => new Blob([b], { type: 'application/pdf' })),
    zip.files[keyFile].async('blob').then(b => new Blob([b], { type: 'application/pdf' })),
  ])

  return { homeworkBlob: hwBlob, keyBlob }
}

export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/health`)
    return res.ok
  } catch {
    return false
  }
}

// ── Bank ──────────────────────────────────────────────────────────────────────

export interface BankProblem {
  id: string
  domain: string | null
  grade: number
  quarter: number | null
  suggested_quarter?: number
  topic: string
  latex: string
  answer_latex: string
  keep_mc?: boolean
  keep_mc_reason?: string
  choices_latex?: Record<string, string>
  needs_diagram?: boolean
  diagram_notes?: string
  honors?: boolean
  high_priority?: boolean
  source?: string
  source_file?: string
  approved: boolean
  flagged: boolean
  notes: string
}

export interface BankReviewResponse {
  problems: BankProblem[]
  total: number
  offset: number
  limit: number
}

export interface BankStats {
  inbox: { total: number; high_priority: number }
  domains: Record<string, {
    total: number
    approved: number
    flagged: number
    pending: number
    high_priority: number
  }>
  totals: {
    total: number
    approved: number
    flagged: number
    pending: number
    high_priority: number
  }
}

export async function fetchBankStats(grade = 6): Promise<BankStats> {
  const res = await fetch(`${API_URL}/api/bank/stats?grade=${grade}`)
  if (!res.ok) throw new Error('Failed to fetch bank stats')
  return res.json()
}

export async function fetchBankProblems(params: {
  grade?: number
  domain?: string
  quarter?: number
  inbox_only?: boolean
  high_priority?: boolean
  limit?: number
  offset?: number
}): Promise<BankReviewResponse> {
  const q = new URLSearchParams()
  if (params.grade !== undefined)        q.set('grade',        String(params.grade))
  if (params.domain)                     q.set('domain',       params.domain)
  if (params.quarter !== undefined)      q.set('quarter',      String(params.quarter))
  if (params.inbox_only !== undefined)   q.set('inbox_only',   String(params.inbox_only))
  if (params.high_priority !== undefined) q.set('high_priority', String(params.high_priority))
  if (params.limit !== undefined)        q.set('limit',        String(params.limit))
  if (params.offset !== undefined)       q.set('offset',       String(params.offset))

  const res = await fetch(`${API_URL}/api/bank/review?${q}`)
  if (!res.ok) throw new Error('Failed to fetch bank problems')
  return res.json()
}

export async function approveProblem(params: {
  problem_id: string
  domain: string
  quarter: number
  honors?: boolean
  notes?: string
  grade?: number
}): Promise<void> {
  const res = await fetch(`${API_URL}/api/bank/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      problem_id: params.problem_id,
      domain:     params.domain,
      quarter:    params.quarter,
      honors:     params.honors ?? false,
      notes:      params.notes ?? '',
      grade:      params.grade ?? 6,
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? 'Approve failed')
  }
}

export async function flagProblem(params: {
  problem_id: string
  notes?: string
  grade?: number
}): Promise<void> {
  const res = await fetch(`${API_URL}/api/bank/flag`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      problem_id: params.problem_id,
      notes:      params.notes ?? '',
      grade:      params.grade ?? 6,
    }),
  })
  if (!res.ok) throw new Error('Flag failed')
}

export async function deleteProblem(params: {
  problem_id: string
  grade?: number
}): Promise<void> {
  const res = await fetch(`${API_URL}/api/bank/delete`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      problem_id: params.problem_id,
      grade:      params.grade ?? 6,
    }),
  })
  if (!res.ok) throw new Error('Delete failed')
}
