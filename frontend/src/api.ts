import JSZip from 'jszip'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

export interface GenerateRequest {
  week_start: string         // "YYYY-MM-DD" — Monday of target week
  grade: '5' | '6' | '7' | '8'
  class_type: 'grade_level' | 'honors'
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

  // Find the homework and key files inside the ZIP by suffix
  const files = Object.values(zip.files).filter(f => !f.dir)
  const hwFile  = files.find(f => !f.name.endsWith('_KEY.pdf'))
  const keyFile = files.find(f =>  f.name.endsWith('_KEY.pdf'))

  if (!hwFile || !keyFile) {
    throw new Error('Unexpected ZIP contents from server')
  }

  const [hwBytes, keyBytes] = await Promise.all([
    hwFile.async('arraybuffer'),
    keyFile.async('arraybuffer'),
  ])

  return {
    homeworkBlob: new Blob([hwBytes],  { type: 'application/pdf' }),
    keyBlob:      new Blob([keyBytes], { type: 'application/pdf' }),
  }
}

export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/health`)
    return res.ok
  } catch {
    return false
  }
}
