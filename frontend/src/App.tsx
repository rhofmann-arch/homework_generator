import { useState, useEffect, useCallback } from 'react'
import {
  generateHomework, checkHealth, fetchWeeks,
  type GenerateRequest, type HWWeek, type HWDay,
} from './api'
import { formatWeekRange } from './dates'

// ─── Types ────────────────────────────────────────────────────────────────────

type Grade = '5' | '6' | '7' | '8'
type ClassType = 'grade_level' | 'honors'
type DayStatus = 'idle' | 'loading' | 'done' | 'error'

interface GeneratedDay {
  date: string
  dow: string
  day_num: string
  pdfUrl: string
  label: string
}

// ─── Small components ─────────────────────────────────────────────────────────

function Badge({ children, color = 'blue' }: { children: React.ReactNode; color?: 'blue' | 'green' | 'slate' }) {
  const cls = { blue: 'bg-brand-100 text-brand-700', green: 'bg-honors-50 text-honors-700', slate: 'bg-slate-100 text-slate-600' }[color]
  return <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{children}</span>
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">{children}</p>
}

function StatusDot({ online }: { online: boolean | null }) {
  if (online === null) return null
  return (
    <span className="flex items-center gap-1.5 text-xs text-slate-500">
      <span className={`w-2 h-2 rounded-full ${online ? 'bg-green-400' : 'bg-red-400'}`} />
      {online ? 'Backend connected' : 'Backend offline — check Render'}
    </span>
  )
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [online, setOnline]         = useState<boolean | null>(null)
  const [weeks, setWeeks]           = useState<HWWeek[]>([])
  const [weeksLoading, setWeeksLoading] = useState(true)
  const [selectedWeek, setSelectedWeek] = useState<HWWeek | null>(null)
  const [grade, setGrade]           = useState<Grade>('6')
  const [classType, setClassType]   = useState<ClassType>('grade_level')

  // Per-day generation state
  const [dayStatus, setDayStatus]   = useState<Record<string, DayStatus>>({})
  const [dayErrors, setDayErrors]   = useState<Record<string, string>>({})
  const [generated, setGenerated]   = useState<GeneratedDay[]>([])
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  // Health check
  useEffect(() => { checkHealth().then(setOnline) }, [])

  // Load weeks from API whenever grade changes
  useEffect(() => {
    setWeeksLoading(true)
    setSelectedWeek(null)
    setGenerated([])
    setPreviewUrl(null)
    fetchWeeks(grade)
      .then(ws => {
        setWeeks(ws)
        // Default to current/nearest upcoming week
        const today = new Date().toISOString().slice(0, 10)
        const upcoming = ws.find(w => w.week_start >= today) ?? ws[ws.length - 1] ?? null
        setSelectedWeek(upcoming)
      })
      .catch(() => setWeeks([]))
      .finally(() => setWeeksLoading(false))
  }, [grade])

  // Reset day states when week or class changes
  useEffect(() => {
    setDayStatus({})
    setDayErrors({})
    setGenerated([])
    setPreviewUrl(null)
  }, [selectedWeek, classType])

  const generateDay = useCallback(async (day: HWDay) => {
    setDayStatus(s => ({ ...s, [day.date]: 'loading' }))
    setDayErrors(s => { const n = { ...s }; delete n[day.date]; return n })

    const req: GenerateRequest = {
      week_start: selectedWeek!.week_start,
      grade,
      class_type: classType,
      specific_date: day.date,
    }

    try {
      const blob = await generateHomework(req)
      const url = URL.createObjectURL(blob)
      const label = `${day.dow} ${day.date} · ${day.day_num}`
      setGenerated(prev => {
        const filtered = prev.filter(g => g.date !== day.date)
        return [...filtered, { ...day, pdfUrl: url, label }]
      })
      setPreviewUrl(url)
      setDayStatus(s => ({ ...s, [day.date]: 'done' }))
    } catch (e: unknown) {
      setDayStatus(s => ({ ...s, [day.date]: 'error' }))
      setDayErrors(s => ({ ...s, [day.date]: e instanceof Error ? e.message : 'Unknown error' }))
    }
  }, [selectedWeek, grade, classType])

  const generateAllDays = useCallback(async () => {
    if (!selectedWeek) return
    // Fire sequentially to avoid overwhelming the backend
    for (const day of selectedWeek.days) {
      await generateDay(day)
    }
  }, [selectedWeek, generateDay])

  const anyLoading = Object.values(dayStatus).some(s => s === 'loading')

  const weekLabel = (w: HWWeek) => {
    const mon = new Date(w.week_start + 'T12:00:00')
    return formatWeekRange(mon)
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="bg-brand-600 text-white shadow-md">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Math Homework Generator</h1>
            <p className="text-brand-100 text-sm mt-0.5">Grades 5–8 · Spiral Review + Lesson Practice</p>
          </div>
          <StatusDot online={online} />
        </div>
      </header>

      <main className="flex-1 max-w-5xl mx-auto w-full px-6 py-8 grid grid-cols-1 lg:grid-cols-[1fr_420px] gap-8 items-start">

        {/* Left: Controls */}
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-6">
            <h2 className="text-base font-semibold text-slate-700">Generate Assignment</h2>

            {/* Grade */}
            <div>
              <SectionLabel>Grade</SectionLabel>
              <div className="grid grid-cols-4 gap-2">
                {(['5', '6', '7', '8'] as Grade[]).map(g => (
                  <button key={g} onClick={() => setGrade(g)}
                    disabled={g !== '6'}
                    className={[
                      'py-2 rounded-lg border text-sm font-medium transition',
                      grade === g ? 'bg-brand-600 border-brand-600 text-white shadow-sm'
                        : 'bg-white border-slate-300 text-slate-600 hover:border-brand-400 hover:text-brand-600',
                      g !== '6' ? 'opacity-40 cursor-not-allowed' : '',
                    ].join(' ')}
                  >
                    {g !== '6' ? `${g} · soon` : `Grade ${g}`}
                  </button>
                ))}
              </div>
            </div>

            {/* Class type */}
            <div>
              <SectionLabel>Class Type</SectionLabel>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { val: 'grade_level' as ClassType, label: 'Grade Level', sub: '20 min · 10–12 problems' },
                  { val: 'honors'      as ClassType, label: 'Honors',      sub: '30 min · challenge problems' },
                ].map(({ val, label, sub }) => (
                  <button key={val} onClick={() => setClassType(val)}
                    className={[
                      'text-left p-3 rounded-xl border-2 transition',
                      classType === val
                        ? val === 'honors' ? 'border-honors-600 bg-honors-50' : 'border-brand-500 bg-brand-50'
                        : 'border-slate-200 bg-white hover:border-slate-300',
                    ].join(' ')}
                  >
                    <p className={`text-sm font-semibold ${classType === val && val === 'honors' ? 'text-honors-700' : classType === val ? 'text-brand-700' : 'text-slate-700'}`}>{label}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{sub}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Week picker */}
            <div>
              <SectionLabel>Week</SectionLabel>
              {weeksLoading ? (
                <p className="text-sm text-slate-400">Loading pacing guide…</p>
              ) : weeks.length === 0 ? (
                <p className="text-sm text-red-500">Could not load weeks — is the backend running?</p>
              ) : (
                <select
                  value={selectedWeek?.week_start ?? ''}
                  onChange={e => {
                    const w = weeks.find(x => x.week_start === e.target.value) ?? null
                    setSelectedWeek(w)
                  }}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  {weeks.map(w => (
                    <option key={w.week_start} value={w.week_start}>
                      {weekLabel(w)}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Day picker */}
            {selectedWeek && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <SectionLabel>Homework Days This Week</SectionLabel>
                  <button
                    onClick={generateAllDays}
                    disabled={anyLoading || !online}
                    className="text-xs font-medium text-brand-600 hover:text-brand-800 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Generate all days ↓
                  </button>
                </div>

                <div className="space-y-2">
                  {selectedWeek.days.map(day => {
                    const status = dayStatus[day.date] ?? 'idle'
                    const err = dayErrors[day.date]
                    const done = generated.find(g => g.date === day.date)

                    return (
                      <div key={day.date} className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 bg-slate-50">
                        {/* Day info */}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-700">
                            {day.dow} · {day.day_num}
                          </p>
                          <p className="text-xs text-slate-400">{day.date}</p>
                          {err && <p className="text-xs text-red-500 mt-0.5 truncate">{err}</p>}
                        </div>

                        {/* Preview link if done */}
                        {done && (
                          <button
                            onClick={() => setPreviewUrl(done.pdfUrl)}
                            className="text-xs text-brand-600 hover:text-brand-800 font-medium"
                          >
                            Preview
                          </button>
                        )}
                        {done && (
                          <a
                            href={done.pdfUrl}
                            download={`hw_grade${grade}_${day.date}.pdf`}
                            className="text-xs text-slate-500 hover:text-slate-700 font-medium"
                          >
                            ↓ PDF
                          </a>
                        )}

                        {/* Generate button */}
                        <button
                          onClick={() => generateDay(day)}
                          disabled={status === 'loading' || !online}
                          className={[
                            'px-3 py-1.5 rounded-lg text-xs font-semibold transition shrink-0',
                            status === 'loading'
                              ? 'bg-brand-400 text-white cursor-wait'
                              : status === 'done'
                              ? 'bg-green-100 text-green-700 hover:bg-brand-100 hover:text-brand-700'
                              : status === 'error'
                              ? 'bg-red-100 text-red-700 hover:bg-brand-100 hover:text-brand-700'
                              : 'bg-brand-600 text-white hover:bg-brand-700',
                            !online && status !== 'loading' ? 'opacity-40 cursor-not-allowed' : '',
                          ].join(' ')}
                        >
                          {status === 'loading' ? '…' : status === 'done' ? '✓ Redo' : status === 'error' ? 'Retry' : 'Generate'}
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right: PDF Preview */}
        <div className="lg:sticky lg:top-6">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-700">Preview</h2>
              {previewUrl && (
                <a href={previewUrl} download="homework.pdf"
                  className="text-xs font-medium text-brand-600 hover:text-brand-800 flex items-center gap-1">
                  ↓ Download PDF
                </a>
              )}
            </div>
            {previewUrl ? (
              <iframe src={previewUrl} className="w-full" style={{ height: '680px' }} title="Homework PDF preview" />
            ) : (
              <div className="flex flex-col items-center justify-center text-center py-16 px-8 text-slate-400">
                <div className="text-5xl mb-4">📄</div>
                <p className="text-sm font-medium text-slate-500">No preview yet</p>
                <p className="text-xs mt-1">Select a week and generate a day</p>
              </div>
            )}
          </div>
        </div>
      </main>

      <footer className="border-t border-slate-200 py-4 text-center text-xs text-slate-400">
        Math Homework Generator · Grades 5–8
      </footer>
    </div>
  )
}
