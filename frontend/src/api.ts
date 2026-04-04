import JSZip from 'jszip'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GenerateRequest {
  week_start: string
  grade: '5' | '6' | '7' | '8'
  class_type: 'grade_level' | 'honors'
  specific_date?: string
}

export interface HomeworkProblem {
  latex: string
  answer_latex?: string
  bank_id?: string        // set if problem came from the bank
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function unzipResponse(res: Response): Promise<{ hw: Blob; key: Blob; sessionKey: string }> {
  const sessionKey = res.headers.get('X-Session-Key') ?? ''
  const zipBlob = await res.blob()
  const zip = await JSZip.loadAsync(zipBlob)

  let hwBlob: Blob | null = null
  let keyBlob: Blob | null = null

  for (const [name, file] of Object.entries(zip.files)) {
    if (name.endsWith('_KEY.pdf')) {
      keyBlob = new Blob([await file.async('arraybuffer')], { type: 'application/pdf' })
    } else if (name.endsWith('.pdf')) {
      hwBlob = new Blob([await file.async('arraybuffer')], { type: 'application/pdf' })
    }
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

// ─── API calls ────────────────────────────────────────────────────────────────

export async function generateHomework(req: GenerateRequest): Promise<GenerateResult> {
  const res = await fetch(`${API_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
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

export async function recompileHomework(
  sessionKey: string,
  req: RecompileRequest
): Promise<GenerateResult> {
  const res = await fetch(`${API_URL}/api/homework/${encodeURIComponent(sessionKey)}/recompile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  await throwIfError(res)
  const { hw, key } = await unzipResponse(res)
  return { homeworkBlob: hw, keyBlob: key, sessionKey }
}

export interface SaveToBankRequest {
  latex: string
  answer_latex?: string
  section: 'front' | 'back' | 'challenge'
  topic?: string
  grade?: number
}

export async function saveProblemToBank(req: SaveToBankRequest): Promise<{ problem_id: string }> {
  const res = await fetch(`${API_URL}/api/bank/from_homework`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  await throwIfError(res)
  return res.json()
}

export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/health`)
    return res.ok
  } catch {
    return false
  }
}
