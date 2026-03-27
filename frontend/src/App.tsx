import { useState, useEffect, useCallback } from 'react'
import {
  generateHomework, checkHealth, type GenerateRequest,
  fetchReviewQueue, approveProblem, deleteProblem, fetchBankStats,
  type BankProblem, type Domain, type BankStats,
} from './api'

// ─── Types ────────────────────────────────────────────────────────────────────

type Grade = '5' | '6' | '7' | '8'
type ClassType = 'grade_level' | 'honors'
type Status = 'idle' | 'loading' | 'done' | 'error'
type Page = 'generate' | 'review'

interface SchoolDay {
  date: string   // YYYY-MM-DD
  dow: string    // Mon/Tue/etc
  day_num: string
}

interface SchoolWeek {
  week_start: string
  days: SchoolDay[]
}

interface Assignment {
  date: string
  label: string
  pdfUrl: string
}

// ─── API helpers (inline to avoid touching api.ts) ────────────────────────────

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

async function fetchWeeks(grade: Grade): Promise<SchoolWeek[]> {
  const res = await fetch(`${API_URL}/api/weeks/${grade}`)
  if (!res.ok) throw new Error('Failed to fetch weeks')
  const data = await res.json()
  return data.weeks as SchoolWeek[]
}

function formatWeekLabel(week: SchoolWeek): string {
  const d = new Date(week.week_start + 'T12:00:00')
  const fri = new Date(d)
  fri.setDate(d.getDate() + 4)
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (d.getMonth() === fri.getMonth()) {
    return `${months[d.getMonth()]} ${d.getDate()} – ${fri.getDate()}, ${fri.getFullYear()}`
  }
  return `${months[d.getMonth()]} ${d.getDate()} – ${months[fri.getMonth()]} ${fri.getDate()}, ${fri.getFullYear()}`
}

// ─── Small components ─────────────────────────────────────────────────────────

function Badge({ children, color = 'blue' }: { children: React.ReactNode; color?: 'blue'|'green'|'slate'|'amber' }) {
  const cls = {
    blue:  'bg-blue-100 text-blue-700',
    green: 'bg-green-50 text-green-700',
    slate: 'bg-slate-100 text-slate-600',
    amber: 'bg-amber-100 text-amber-700',
  }[color]
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
      {online ? 'Backend connected' : 'Backend offline'}
    </span>
  )
}

// ─── Assignment History Item ──────────────────────────────────────────────────

function HistoryItem({ item, onRemove }: { item: Assignment; onRemove: () => void }) {
  return (
    <div className="flex items-center justify-between py-2.5 px-3 bg-white border border-slate-200 rounded-lg">
      <p className="text-sm font-medium text-slate-700 truncate flex-1">{item.label}</p>
      <div className="flex items-center gap-2 ml-3">
        <a href={item.pdfUrl} download={`hw_${item.date}.pdf`}
           className="text-xs font-medium text-blue-600 hover:text-blue-800 underline">
          Download
        </a>
        <button onClick={onRemove} className="text-slate-300 hover:text-slate-500 text-lg leading-none">×</button>
      </div>
    </div>
  )
}

// ─── Domain labels ────────────────────────────────────────────────────────────

const DOMAIN_LABELS: Record<Domain, string> = {
  fractions_decimals:    'Fractions & Decimals',
  expressions_equations: 'Expressions & Equations',
  geometry:              'Geometry',
  stats_probability:     'Stats & Probability',
}
const DOMAINS = Object.keys(DOMAIN_LABELS) as Domain[]

// ─── LaTeX renderer ───────────────────────────────────────────────────────────

function LatexBlock({ latex }: { latex: string }) {
  useEffect(() => {
    if (typeof window !== 'undefined' && (window as any).MathJax?.typesetPromise) {
      setTimeout(() => { (window as any).MathJax.typesetPromise() }, 50)
    }
  }, [latex])
  const processed = latex.replace(/\$\$([^$]+)\$\$/g, '\\[$1\\]')
  return (
    <div className="text-sm text-slate-800 leading-relaxed"
         dangerouslySetInnerHTML={{ __html: processed }} />
  )
}

// ─── Stats Summary ────────────────────────────────────────────────────────────

function StatsSummary({ stats }: { stats: BankStats | null }) {
  if (!stats) return null
  const total    = Object.values(stats.domains).reduce((s, d) => s + d.total, 0)
  const approved = Object.values(stats.domains).reduce((s, d) => s + d.approved, 0)
  const pending  = total - approved
  return (
    <div className="grid grid-cols-3 gap-3 mb-6">
      {[
        { label: 'Total Problems', value: total,    color: 'text-slate-700' },
        { label: 'Approved',       value: approved, color: 'text-green-600' },
        { label: 'Pending Review', value: pending,  color: 'text-amber-600' },
      ].map(({ label, value, color }) => (
        <div key={label} className="bg-white rounded-xl border border-slate-200 p-4 text-center">
          <p className={`text-2xl font-bold ${color}`}>{value}</p>
          <p className="text-xs text-slate-400 mt-0.5">{label}</p>
        </div>
      ))}
    </div>
  )
}

// ─── Review Page ──────────────────────────────────────────────────────────────

function ReviewPage() {
  const [domain, setDomain]               = useState<Domain>('expressions_equations')
  const [problems, setProblems]           = useState<BankProblem[]>([])
  const [total, setTotal]                 = useState(0)
  const [offset, setOffset]               = useState(0)
  const [index, setIndex]                 = useState(0)
  const [loading, setLoading]             = useState(false)
  const [saving, setSaving]               = useState(false)
  const [selectedQ, setSelectedQ]         = useState(1)
  const [notes, setNotes]                 = useState('')
  const [stats, setStats]                 = useState<BankStats | null>(null)
  const [toast, setToast]                 = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const PAGE_SIZE = 20

  useEffect(() => { fetchBankStats(6).then(s => setStats(s)).catch(() => {}) }, [])

  useEffect(() => {
    setLoading(true); setIndex(0)
    fetchReviewQueue(domain, 6, offset, PAGE_SIZE)
      .then(res => { setProblems(res.problems); setTotal(res.total); setLoading(false) })
      .catch(() => setLoading(false))
  }, [domain, offset])

  useEffect(() => {
    const p = problems[index]
    if (p) { setSelectedQ(p.quarter); setNotes(p.notes ?? '') }
  }, [index, problems])

  const current     = problems[index]
  const globalIndex = offset + index

  function showToast(msg: string) {
    setToast(msg); setTimeout(() => setToast(null), 2500)
  }

  function advanceAfterAction() {
    fetchBankStats(6).then(s => setStats(s)).catch(() => {})
    const next = problems.filter((_, i) => i !== index)
    setProblems(next); setTotal(t => t - 1)
    if (index >= next.length && index > 0) setIndex(index - 1)
  }

  async function handleApprove(flagged = false) {
    if (!current) return
    setSaving(true)
    try {
      await approveProblem(current, selectedQ, notes, flagged)
      showToast(flagged ? `🚩 Flagged: ${current.id}` : `✅ Approved: ${current.id}`)
      advanceAfterAction()
    } catch { showToast('❌ Failed to save — check backend') }
    finally { setSaving(false) }
  }

  async function handleDelete() {
    if (!current) return
    setSaving(true)
    try {
      await deleteProblem(current)
      showToast(`🗑 Deleted: ${current.id}`)
      advanceAfterAction()
    } catch { showToast('❌ Failed to delete — check backend') }
    finally { setSaving(false); setConfirmDelete(false) }
  }

  function handleDomainChange(d: Domain) { setDomain(d); setOffset(0); setIndex(0) }

  const canPrev = globalIndex > 0
  const canNext = globalIndex < total - 1

  function handlePrev() {
    if (!canPrev) return
    if (index > 0) { setIndex(index - 1) }
    else { setOffset(Math.max(0, offset - PAGE_SIZE)); setIndex(PAGE_SIZE - 1) }
  }
  function handleNext() {
    if (!canNext) return
    if (index < problems.length - 1) { setIndex(index + 1) }
    else { setOffset(offset + PAGE_SIZE); setIndex(0) }
  }

  return (
    <div className="space-y-6">
      <StatsSummary stats={stats} />

      {/* Domain tabs */}
      <div className="flex gap-2 flex-wrap">
        {DOMAINS.map(d => (
          <button key={d} onClick={() => handleDomainChange(d)}
            className={['px-4 py-2 rounded-lg text-sm font-medium transition border',
              domain === d ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white text-slate-600 border-slate-300 hover:border-blue-400 hover:text-blue-600',
            ].join(' ')}>
            {DOMAIN_LABELS[d]}
            {stats && <span className="ml-2 text-xs opacity-70">({stats.domains[d].total - stats.domains[d].approved} left)</span>}
          </button>
        ))}
      </div>

      {/* Review card */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-slate-700">Problem Review</span>
            {total > 0 && <Badge color="amber">{total} pending</Badge>}
          </div>
          {total > 0 && current && <span className="text-xs text-slate-400">{globalIndex + 1} of {total}</span>}
        </div>

        <div className="p-6">
          {loading && <div className="text-center py-16 text-slate-400 text-sm">Loading problems…</div>}

          {!loading && total === 0 && (
            <div className="text-center py-16">
              <div className="text-4xl mb-3">✅</div>
              <p className="text-sm font-medium text-slate-600">All problems in this domain are approved!</p>
            </div>
          )}

          {!loading && current && (
            <div className="space-y-6">
              <div className="flex flex-wrap gap-2 items-center">
                <Badge color="slate">#{current.source_problem_number} · {current.source_file}</Badge>
                <Badge color="blue">Auto-suggested: Q{current.quarter}</Badge>
                <span className="text-xs text-slate-400">{current.topic}</span>
              </div>

              <div className="bg-slate-50 rounded-xl p-5 min-h-[100px]">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">Problem</p>
                <LatexBlock latex={current.latex} />
              </div>

              {current.answer_latex && (
                <div className="bg-green-50 rounded-xl p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-green-500 mb-2">Answer</p>
                  <LatexBlock latex={current.answer_latex} />
                </div>
              )}

              <div>
                <SectionLabel>Confirm Quarter Placement</SectionLabel>
                <div className="grid grid-cols-4 gap-2">
                  {[1,2,3,4].map(q => (
                    <button key={q} onClick={() => setSelectedQ(q)}
                      className={['py-2.5 rounded-lg border text-sm font-medium transition',
                        selectedQ === q ? 'bg-blue-600 border-blue-600 text-white'
                                        : 'bg-white border-slate-300 text-slate-600 hover:border-blue-400',
                      ].join(' ')}>Q{q}</button>
                  ))}
                </div>
                {selectedQ !== current.quarter && (
                  <p className="text-xs text-amber-600 mt-2">⚠ Moving from Q{current.quarter} → Q{selectedQ}</p>
                )}
              </div>

              <div>
                <SectionLabel>Notes (optional)</SectionLabel>
                <input type="text" value={notes} onChange={e => setNotes(e.target.value)}
                  placeholder="e.g. 'has diagram placeholder — needs manual LaTeX'"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>

              <div className="space-y-3">
                {/* Primary: Prev / Approve / Next */}
                <div className="flex items-center gap-3">
                  <button onClick={handlePrev} disabled={!canPrev}
                    className="px-4 py-2 rounded-lg border border-slate-300 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition">
                    ← Prev
                  </button>
                  <button onClick={() => handleApprove(false)} disabled={saving}
                    className="flex-1 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-60 transition">
                    {saving ? 'Saving…' : `Approve · Q${selectedQ}`}
                  </button>
                  <button onClick={handleNext} disabled={!canNext}
                    className="px-4 py-2 rounded-lg border border-slate-300 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition">
                    Next →
                  </button>
                </div>

                {/* Secondary: Flag / Delete */}
                <div className="flex items-center gap-3">
                  <button onClick={() => handleApprove(true)} disabled={saving}
                    className="flex-1 py-2 rounded-xl border-2 border-amber-400 text-amber-700 text-sm font-medium hover:bg-amber-50 disabled:opacity-60 transition">
                    🚩 Flag — needs review
                  </button>
                  {!confirmDelete ? (
                    <button onClick={() => setConfirmDelete(true)} disabled={saving}
                      className="flex-1 py-2 rounded-xl border-2 border-red-300 text-red-600 text-sm font-medium hover:bg-red-50 disabled:opacity-60 transition">
                      🗑 Delete
                    </button>
                  ) : (
                    <div className="flex-1 flex gap-2">
                      <button onClick={handleDelete} disabled={saving}
                        className="flex-1 py-2 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-60 transition">
                        Confirm delete
                      </button>
                      <button onClick={() => setConfirmDelete(false)}
                        className="px-3 py-2 rounded-xl border border-slate-300 text-sm text-slate-600 hover:bg-slate-50 transition">
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-sm px-5 py-3 rounded-xl shadow-lg z-50">
          {toast}
        </div>
      )}
    </div>
  )
}

// ─── Generate Page ────────────────────────────────────────────────────────────

function GeneratePage({ online }: { online: boolean | null }) {
  const [grade, setGrade]             = useState<Grade>('6')
  const [classType, setClassType]     = useState<ClassType>('grade_level')
  const [weeks, setWeeks]             = useState<SchoolWeek[]>([])
  const [selectedWeek, setSelectedWeek] = useState<SchoolWeek | null>(null)
  const [selectedDay, setSelectedDay] = useState<SchoolDay | null>(null)  // null = full week
  const [status, setStatus]           = useState<Status>('idle')
  const [errorMsg, setErrorMsg]       = useState('')
  const [history, setHistory]         = useState<Assignment[]>([])
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null)
  const [generatingDay, setGeneratingDay] = useState<string | null>(null)

  // Load weeks from backend when grade changes
  useEffect(() => {
    setWeeks([]); setSelectedWeek(null); setSelectedDay(null)
    fetchWeeks(grade)
      .then(w => { setWeeks(w); setSelectedWeek(w[0] ?? null) })
      .catch(() => {})
  }, [grade])

  // Reset day selection when week changes
  useEffect(() => { setSelectedDay(null) }, [selectedWeek])

  const handleGenerate = useCallback(async () => {
    if (!selectedWeek) return
    setStatus('loading'); setErrorMsg(''); setPdfPreviewUrl(null)

    const daysToGenerate: (SchoolDay | null)[] = selectedDay
      ? [selectedDay]
      : selectedWeek.days

    try {
      let lastUrl: string | null = null
      for (const day of daysToGenerate) {
        setGeneratingDay(day?.dow ?? 'Full week')
        const req: GenerateRequest = {
          week_start:    selectedWeek.week_start,
          grade,
          class_type:    classType,
          specific_date: day?.date,
        }
        const blob = await generateHomework(req)
        const url  = URL.createObjectURL(blob)
        lastUrl    = url

        const dowLabel  = day ? day.dow : 'Full week'
        const dateLabel = day ? day.date : selectedWeek.week_start
        const label     = `${formatWeekLabel(selectedWeek)} · ${dowLabel} · Grade ${grade} · ${classType === 'honors' ? 'Honors' : 'Grade Level'}`
        setHistory(prev => [{ date: dateLabel, label, pdfUrl: url }, ...prev])
      }
      if (lastUrl) setPdfPreviewUrl(lastUrl)
      setStatus('done')
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : 'Unknown error')
      setStatus('error')
    } finally {
      setGeneratingDay(null)
    }
  }, [selectedWeek, selectedDay, grade, classType])

  const weekDays = selectedWeek?.days ?? []

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_420px] gap-8 items-start">

      {/* Left: Form */}
      <div className="space-y-6">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-6">
          <h2 className="text-base font-semibold text-slate-700">Generate Assignment</h2>

          {/* Grade */}
          <div>
            <SectionLabel>Grade</SectionLabel>
            <div className="grid grid-cols-4 gap-2">
              {(['5','6','7','8'] as Grade[]).map(g => (
                <button key={g} onClick={() => setGrade(g)}
                  disabled={g !== '6'}
                  className={['py-2 rounded-lg border text-sm font-medium transition',
                    grade === g ? 'bg-blue-600 border-blue-600 text-white shadow-sm'
                                : 'bg-white border-slate-300 text-slate-600 hover:border-blue-400 hover:text-blue-600',
                    g !== '6' ? 'opacity-40 cursor-not-allowed' : '',
                  ].join(' ')}>
                  {g !== '6' ? `${g} · soon` : `Grade ${g}`}
                </button>
              ))}
            </div>
          </div>

          {/* Week picker */}
          <div>
            <SectionLabel>Week</SectionLabel>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  const i = weeks.findIndex(w => w.week_start === selectedWeek?.week_start)
                  if (i > 0) setSelectedWeek(weeks[i - 1])
                }}
                disabled={!selectedWeek || weeks.indexOf(selectedWeek) === 0}
                className="p-1.5 rounded hover:bg-slate-200 text-slate-500 disabled:opacity-30 transition">◀</button>
              <select
                value={selectedWeek?.week_start ?? ''}
                onChange={e => setSelectedWeek(weeks.find(w => w.week_start === e.target.value) ?? null)}
                className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                {weeks.map(w => (
                  <option key={w.week_start} value={w.week_start}>{formatWeekLabel(w)}</option>
                ))}
              </select>
              <button
                onClick={() => {
                  const i = weeks.findIndex(w => w.week_start === selectedWeek?.week_start)
                  if (i < weeks.length - 1) setSelectedWeek(weeks[i + 1])
                }}
                disabled={!selectedWeek || weeks.indexOf(selectedWeek) === weeks.length - 1}
                className="p-1.5 rounded hover:bg-slate-200 text-slate-500 disabled:opacity-30 transition">▶</button>
            </div>
          </div>

          {/* Day selector */}
          {weekDays.length > 0 && (
            <div>
              <SectionLabel>Day</SectionLabel>
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => setSelectedDay(null)}
                  className={['px-3 py-2 rounded-lg border text-sm font-medium transition',
                    selectedDay === null
                      ? 'bg-blue-600 border-blue-600 text-white'
                      : 'bg-white border-slate-300 text-slate-600 hover:border-blue-400',
                  ].join(' ')}>
                  Full Week
                </button>
                {weekDays.map(day => (
                  <button key={day.date}
                    onClick={() => setSelectedDay(day)}
                    className={['px-3 py-2 rounded-lg border text-sm font-medium transition',
                      selectedDay?.date === day.date
                        ? 'bg-blue-600 border-blue-600 text-white'
                        : 'bg-white border-slate-300 text-slate-600 hover:border-blue-400',
                    ].join(' ')}>
                    {day.dow}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Class type */}
          <div>
            <SectionLabel>Class Type</SectionLabel>
            <div className="grid grid-cols-2 gap-3">
              {[
                { val: 'grade_level' as ClassType, label: 'Grade Level', sub: '20 min · 10–12 problems' },
                { val: 'honors'      as ClassType, label: 'Honors',      sub: '30 min · challenge problems' },
              ].map(({ val, label, sub }) => (
                <button key={val} onClick={() => setClassType(val)}
                  className={['text-left p-3 rounded-xl border-2 transition',
                    classType === val
                      ? val === 'honors' ? 'border-green-600 bg-green-50' : 'border-blue-500 bg-blue-50'
                      : 'border-slate-200 bg-white hover:border-slate-300',
                  ].join(' ')}>
                  <p className={`text-sm font-semibold ${classType === val && val === 'honors' ? 'text-green-700' : classType === val ? 'text-blue-700' : 'text-slate-700'}`}>{label}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{sub}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Summary */}
          {selectedWeek && (
            <div className="bg-slate-50 rounded-xl p-3 text-sm text-slate-600">
              <span className="font-medium">Generating: </span>
              Grade {grade} · {classType === 'honors' ? 'Honors' : 'Grade Level'} ·{' '}
              {selectedDay ? `${selectedDay.dow}, ${selectedDay.date}` : `Full week of ${formatWeekLabel(selectedWeek)}`}
            </div>
          )}

          {/* Error */}
          {status === 'error' && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">
              <span className="font-semibold">Error: </span>{errorMsg}
            </div>
          )}

          {/* Generate button */}
          <button onClick={handleGenerate}
            disabled={status === 'loading' || !online || !selectedWeek}
            className={['w-full py-3 rounded-xl text-sm font-semibold transition shadow-sm',
              status === 'loading' ? 'bg-blue-400 text-white cursor-wait'
              : !online || !selectedWeek ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
              : 'bg-blue-600 text-white hover:bg-blue-700 active:scale-[0.99]',
            ].join(' ')}>
            {status === 'loading' ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                </svg>
                {generatingDay ? `Generating ${generatingDay}…` : 'Generating PDF…'}
              </span>
            ) : selectedDay ? 'Generate PDF' : `Generate Full Week (${weekDays.length} PDFs)`}
          </button>
        </div>

        {/* History */}
        {history.length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
            <h2 className="text-base font-semibold text-slate-700 mb-3">Generated This Session</h2>
            <div className="space-y-2">
              {history.map((item, i) => (
                <HistoryItem key={i} item={item}
                  onRemove={() => setHistory(prev => prev.filter((_, j) => j !== i))} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Right: Preview */}
      <div className="lg:sticky lg:top-6">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700">Preview</h2>
            {pdfPreviewUrl && (
              <a href={pdfPreviewUrl} download="homework.pdf"
                 className="text-xs font-medium text-blue-600 hover:text-blue-800">↓ Download PDF</a>
            )}
          </div>
          {pdfPreviewUrl ? (
            <iframe src={pdfPreviewUrl} className="w-full" style={{ height: '680px' }} title="Preview" />
          ) : (
            <div className="flex flex-col items-center justify-center text-center py-16 px-8 text-slate-400">
              <div className="text-5xl mb-4">📄</div>
              <p className="text-sm font-medium text-slate-500">No preview yet</p>
              <p className="text-xs mt-1">
                {status === 'loading'
                  ? 'Generating — this takes about 30 seconds…'
                  : 'Configure options and click Generate'}
              </p>
              {status === 'loading' && (
                <div className="mt-4 w-32 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-400 rounded-full animate-pulse" style={{ width: '60%' }} />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [online, setOnline] = useState<boolean | null>(null)
  const [page, setPage]     = useState<Page>('generate')

  useEffect(() => { checkHealth().then(setOnline) }, [])

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-blue-700 text-white shadow-md">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Math Homework Generator</h1>
            <p className="text-blue-100 text-sm mt-0.5">Grades 5–8 · Spiral Review + Lesson Practice</p>
          </div>
          <div className="flex items-center gap-6">
            <nav className="flex gap-1">
              {([['generate','Generate'],['review','Review Bank']] as [Page,string][]).map(([key,label]) => (
                <button key={key} onClick={() => setPage(key)}
                  className={['px-4 py-1.5 rounded-lg text-sm font-medium transition',
                    page === key ? 'bg-white text-blue-700' : 'text-blue-100 hover:bg-blue-600',
                  ].join(' ')}>
                  {label}
                </button>
              ))}
            </nav>
            <StatusDot online={online} />
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-5xl mx-auto w-full px-6 py-8">
        {page === 'generate' && <GeneratePage online={online} />}
        {page === 'review'   && <ReviewPage />}
      </main>

      <footer className="border-t border-slate-200 py-4 text-center text-xs text-slate-400">
        Math Homework Generator · Grades 5–8
      </footer>
    </div>
  )
}
