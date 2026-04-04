import JSZip from 'jszip'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

// ─── Generate types ───────────────────────────────────────────────────────────

export interface GenerateRequest {
  week_start: string
  grade: '5' | '6' | '7' | '8'
  class_type: 'grade_level' | 'honors'
  specific_date?: string
}

export interface HomeworkProblem {
  latex: string
  answer_latex?: string
  bank_id?: string
}

export interface HomeworkProblems {
  spiral_topics: string
  front_problems: HomeworkProblem[]
  lesson_title: string
  back_problems: HomeworkProblem[]
  challenge_problems: HomeworkProblem[]
}

export interface GenerateResult {
  homeworkBlob: Blob
  keyBlob: Blob
  sessionKey: string
}

// ─── Bank types ───────────────────────────────────────────────────────────────

export type Domain = 'arithmetic' | 'expressions_equations' | 'geometry' | 'stats_probability' | 'other'

export interface BankProblem {
  id: string
  latex: string
  answer_latex?: string
  topic?: string
  notes?: string
  domain?: Domain
  quarter?: number
  approved?: boolean
  flagged?: boolean
  honors?: boolean
  high_priority?: boolean
  source?: string
  suggested_quarter?: number
  keep_mc?: boolean
  needs_diagram?: boolean
  diagram_notes?: string
}

export interface BankStats {
  inbox: { total: number; high_priority?: number }
  domains: Record<string, { total: number; approved: number; flagged: number; pending: number }>
  totals: { total: number; approved: number; flagged: number; pending: number }
}

export interface BankQueue {
  problems: BankProblem[]
  total: number
  offset: number
  limit: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function unzipResponse(res: Response): Promise<{ hw: Blob; key: Blob; sessionKey: string }> {
  const sessionKey = res.headers.get('X-Session-Key') ?? ''
  const zip = await JSZip.loadAsync(await res.blob())
  let hwBlob: Blob | null = null
  let keyBlob: Blob | null = null
  for (const [name, file] of Object.entries(zip.files)) {
    if (name.endsWith('_KEY.pdf')) keyBlob = new Blob([await file.async('arraybuffer')], { type: 'application/pdf' })
    else if (name.endsWith('.pdf')) hwBlob = new Blob([await file.async('arraybuffer')], { type: 'application/pdf' })
  }
  if (!hwBlob || !keyBlob) throw new Error('ZIP did not contain expected PDF files')
  return { hw: hwBlob, key: keyBlob, sessionKey }
}

async function throwIfError(res: Response): Promise<void> {
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? 'Request failed')
  }
}

async function postJSON(path: string, body: unknown): Promise<Response> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  await throwIfError(res)
  return res
}

// ─── Generate API ─────────────────────────────────────────────────────────────

export async function generateHomework(req: GenerateRequest): Promise<GenerateResult> {
  const res = await fetch(`${API_URL}/api/generate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req),
  })
  await throwIfError(res)
  const { hw, key, sessionKey } = await unzipResponse(res)
  return { homeworkBlob: hw, keyBlob: key, sessionKey }
}

export async function fetchHomeworkProblems(sessionKey: string): Promise<HomeworkProblems> {
  const res = await fetch(`${API_URL}/api/homework/${encodeURIComponent(sessionKey)}/problems`)
  await throwIfError(res)
  return res.json()
}

export interface RecompileRequest {
  problems: HomeworkProblems
  week_start: string
  grade: '5' | '6' | '7' | '8'
  class_type: 'grade_level' | 'honors'
  specific_date?: string
}

export async function recompileHomework(sessionKey: string, req: RecompileRequest): Promise<GenerateResult> {
  const res = await fetch(`${API_URL}/api/homework/${encodeURIComponent(sessionKey)}/recompile`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req),
  })
  await throwIfError(res)
  const { hw, key } = await unzipResponse(res)
  return { homeworkBlob: hw, keyBlob: key, sessionKey }
}

// ─── Bank API ─────────────────────────────────────────────────────────────────

export async function fetchBankStats(grade = 6): Promise<BankStats> {
  const res = await fetch(`${API_URL}/api/bank/stats?grade=${grade}`)
  await throwIfError(res)
  return res.json()
}

export async function fetchReviewQueue(params: {
  grade?: number; inbox_only?: boolean; domain?: string;
  high_priority?: boolean; limit?: number; offset?: number
}): Promise<BankQueue> {
  const q = new URLSearchParams()
  if (params.grade)        q.set('grade', String(params.grade))
  if (params.inbox_only !== undefined) q.set('inbox_only', String(params.inbox_only))
  if (params.domain)       q.set('domain', params.domain)
  if (params.limit)        q.set('limit', String(params.limit))
  if (params.offset)       q.set('offset', String(params.offset))
  const res = await fetch(`${API_URL}/api/bank/review?${q}`)
  await throwIfError(res)
  return res.json()
}

export async function approveProblem(
  problem_id: string, domain: Domain, quarter: number, notes = '', grade = 6
): Promise<void> {
  await postJSON('/api/bank/approve', { problem_id, domain, quarter, notes, grade })
}

export async function flagProblem(problem_id: string, notes = '', grade = 6): Promise<void> {
  await postJSON('/api/bank/flag', { problem_id, notes, grade })
}

export async function deleteProblem(problem_id: string, grade = 6): Promise<void> {
  const res = await fetch(`${API_URL}/api/bank/delete`, {
    method: 'DELETE', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ problem_id, grade }),
  })
  await throwIfError(res)
}

export async function saveProblemToBank(req: {
  latex: string; answer_latex?: string; section: string; grade?: number
}): Promise<{ problem_id: string }> {
  const res = await postJSON('/api/bank/from_homework', req)
  return res.json()
}

export async function checkHealth(): Promise<boolean> {
  try { return (await fetch(`${API_URL}/health`)).ok } catch { return false }
}
