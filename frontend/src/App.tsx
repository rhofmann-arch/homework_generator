import { useState, useEffect, useCallback } from 'react'
import { generateHomework, checkHealth, type GenerateRequest,
  fetchReviewQueue, approveProblem, fetchBankStats,
  type BankProblem, type Domain, type BankStats,
} from './api'
import {
  getMonday, formatWeekRange, formatISO,
  nextWeek, prevWeek, schoolYearWeeks,
} from './dates'

// ─── Types ────────────────────────────────────────────────────────────────────

type Grade = '5' | '6' | '7' | '8'
type ClassType = 'grade_level' | 'honors'
type Status = 'idle' | 'loading' | 'done' | 'error'
type Page = 'generate' | 'review'

interface Assignment {
  weekStart: string
  grade: Grade
  classType: ClassType
  label: string
  pdfUrl: string
}

// ─── Small components ─────────────────────────────────────────────────────────

function Badge({ children, color = 'blue' }: { children: React.ReactNode; color?: 'blue' | 'green' | 'slate' | 'amber' }) {
  const cls = {
    blue:  'bg-brand-100 text-brand-700',
    green: 'bg-honors-50 text-honors-700',
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
      {online ? 'Backend connected' : 'Backend offline — check Render'}
    </span>
  )
}

// ─── Week Picker ──────────────────────────────────────────────────────────────

function WeekPicker({ value, onChange }: { value: Date; onChange: (d: Date) => void }) {
  const weeks = schoolYearWeeks()
  return (
    <div className="flex items-center gap-2">
      <button onClick={() => onChange(prevWeek(value))} className="p-1.5 rounded hover:bg-slate-200 text-slate-500 hover:text-slate-700 transition" title="Previous week">◀</button>
      <select
        value={formatISO(value)}
        onChange={e => { const d = new Date(e.target.value + 'T12:00:00'); onChange(getMonday(d)) }}
        className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
      >
        {weeks.map((w: Date) => { const iso = formatISO(w); return <option key={iso} value={iso}>{formatWeekRange(w)}</option> })}
      </select>
      <button onClick={() => onChange(nextWeek(value))} className="p-1.5 rounded hover:bg-slate-200 text-slate-500 hover:text-slate-700 transition" title="Next week">▶</button>
    </div>
  )
}

// ─── Assignment History Item ──────────────────────────────────────────────────

function HistoryItem({ item, onRemove }: { item: Assignment; onRemove: () => void }) {
  return (
    <div className="flex items-center justify-between py-2.5 px-3 bg-white border border-slate-200 rounded-lg">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-700 truncate">{item.label}</p>
        <div className="flex gap-1.5 mt-1">
          <Badge color="slate">Grade {item.grade}</Badge>
          <Badge color={item.classType === 'honors' ? 'green' : 'blue'}>{item.classType === 'honors' ? 'Honors' : 'Grade Level'}</Badge>
        </div>
      </div>
      <div className="flex items-center gap-2 ml-3">
        <a href={item.pdfUrl} download={`hw_grade${item.grade}_${item.weekStart}.pdf`} className="text-xs font-medium text-brand-600 hover:text-brand-800 underline">Download</a>
        <button onClick={onRemove} className="text-slate-300 hover:text-slate-500 text-lg leading-none" title="Remove">×</button>
      </div>
    </div>
  )
}

// ─── Domain labels ─────────────────────────────────────────────────────────────

const DOMAIN_LABELS: Record<Domain, string> = {
  fractions_decimals:    'Fractions & Decimals',
  expressions_equations: 'Expressions & Equations',
  geometry:              'Geometry',
  stats_probability:     'Stats & Probability',
}

const DOMAINS = Object.keys(DOMAIN_LABELS) as Domain[]

// ─── LaTeX renderer (uses MathJax loaded via index.html) ──────────────────────

function LatexBlock({ latex }: { latex: string }) {
  const [html, setHtml] = useState('')

  useEffect(() => {
    // Replace $$...$$ with \[...\] for MathJax display math
    const processed = latex
      .replace(/\$\$([^$]+)\$\$/g, '\\[$1\\]')

    setHtml(processed)

    // Ask MathJax to typeset after DOM update
    if (typeof window !== 'undefined' && (window as any).MathJax?.typesetPromise) {
      setTimeout(() => {
        (window as any).MathJax.typesetPromise()
      }, 50)
    }
  }, [latex])

  return (
    <div
      className="text-sm text-slate-800 leading-relaxed"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

// ─── Stats Summary ─────────────────────────────────────────────────────────────

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
  const [domain, setDomain]           = useState<Domain>('expressions_equations')
  const [problems, setProblems]       = useState<BankProblem[]>([])
  const [total, setTotal]             = useState(0)
  const [offset, setOffset]           = useState(0)
  const [index, setIndex]             = useState(0)   // position within current page
  const [loading, setLoading]         = useState(false)
  const [saving, setSaving]           = useState(false)
  const [selectedQ, setSelectedQ]     = useState<number>(1)
  const [notes, setNotes]             = useState('')
  const [stats, setStats]             = useState<BankStats | null>(null)
  const [toast, setToast]             = useState<string | null>(null)

  const PAGE_SIZE = 20

  // Load stats once
  useEffect(() => {
    fetchBankStats(6).then(s => setStats(s)).catch(() => {})
  }, [])

  // Load problems when domain or offset changes
  useEffect(() => {
    setLoading(true)
    setIndex(0)
    fetchReviewQueue(domain, 6, offset, PAGE_SIZE)
      .then(res => {
        setProblems(res.problems)
        setTotal(res.total)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [domain, offset])

  // Sync quarter selector to current problem
  useEffect(() => {
    const p = problems[index]
    if (p) {
      setSelectedQ(p.quarter)
      setNotes(p.notes ?? '')
    }
  }, [index, problems])

  const current = problems[index]
  const globalIndex = offset + index   // position across all problems

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }

  async function handleApprove() {
    if (!current) return
    setSaving(true)
    try {
      await approveProblem(current, selectedQ, notes)
      showToast(`✅ Approved: ${current.id}`)
      // Refresh stats
      fetchBankStats(6).then(s => setStats(s)).catch(() => {})
      // Move to next problem (remove current from local list)
      const next = problems.filter((_, i) => i !== index)
      setProblems(next)
      setTotal(t => t - 1)
      // Stay at same index (which now points to next problem), or go back
      if (index >= next.length && index > 0) setIndex(index - 1)
    } catch {
      showToast('❌ Failed to save — check backend connection')
    } finally {
      setSaving(false)
    }
  }

  function handleDomainChange(d: Domain) {
    setDomain(d)
    setOffset(0)
    setIndex(0)
  }

  const canPrev = globalIndex > 0
  const canNext = globalIndex < total - 1

  function handlePrev() {
    if (!canPrev) return
    if (index > 0) {
      setIndex(index - 1)
    } else {
      // Go to previous page, last item
      setOffset(Math.max(0, offset - PAGE_SIZE))
      setIndex(PAGE_SIZE - 1)
    }
  }

  function handleNext() {
    if (!canNext) return
    if (index < problems.length - 1) {
      setIndex(index + 1)
    } else {
      // Go to next page
      setOffset(offset + PAGE_SIZE)
      setIndex(0)
    }
  }

  return (
    <div className="space-y-6">
      {/* Stats */}
      <StatsSummary stats={stats} />

      {/* Domain tabs */}
      <div className="flex gap-2 flex-wrap">
        {DOMAINS.map(d => (
          <button
            key={d}
            onClick={() => handleDomainChange(d)}
            className={[
              'px-4 py-2 rounded-lg text-sm font-medium transition border',
              domain === d
                ? 'bg-brand-600 text-white border-brand-600'
                : 'bg-white text-slate-600 border-slate-300 hover:border-brand-400 hover:text-brand-600',
            ].join(' ')}
          >
            {DOMAIN_LABELS[d]}
            {stats && (
              <span className="ml-2 text-xs opacity-70">
                ({stats.domains[d].total - stats.domains[d].approved} left)
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Main review card */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm">

        {/* Card header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-slate-700">Problem Review</span>
            {total > 0 && (
              <Badge color="amber">{total} pending</Badge>
            )}
          </div>
          {total > 0 && current && (
            <span className="text-xs text-slate-400">
              {globalIndex + 1} of {total}
            </span>
          )}
        </div>

        {/* Card body */}
        <div className="p-6">
          {loading && (
            <div className="text-center py-16 text-slate-400 text-sm">Loading problems…</div>
          )}

          {!loading && total === 0 && (
            <div className="text-center py-16">
              <div className="text-4xl mb-3">✅</div>
              <p className="text-sm font-medium text-slate-600">All problems in this domain are approved!</p>
            </div>
          )}

          {!loading && current && (
            <div className="space-y-6">

              {/* Problem metadata */}
              <div className="flex flex-wrap gap-2 items-center">
                <Badge color="slate">#{current.source_problem_number} · {current.source_file}</Badge>
                <Badge color="blue">Auto-suggested: Q{current.quarter}</Badge>
                <span className="text-xs text-slate-400">{current.topic}</span>
              </div>

              {/* Problem latex */}
              <div className="bg-slate-50 rounded-xl p-5 min-h-[100px]">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">Problem</p>
                <LatexBlock latex={current.latex} />
              </div>

              {/* Answer latex */}
              {current.answer_latex && (
                <div className="bg-green-50 rounded-xl p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-green-500 mb-2">Answer</p>
                  <LatexBlock latex={current.answer_latex} />
                </div>
              )}

              {/* Quarter selector */}
              <div>
                <SectionLabel>Confirm Quarter Placement</SectionLabel>
                <div className="grid grid-cols-4 gap-2">
                  {[1, 2, 3, 4].map(q => (
                    <button
                      key={q}
                      onClick={() => setSelectedQ(q)}
                      className={[
                        'py-2.5 rounded-lg border text-sm font-medium transition',
                        selectedQ === q
                          ? 'bg-brand-600 border-brand-600 text-white'
                          : 'bg-white border-slate-300 text-slate-600 hover:border-brand-400',
                      ].join(' ')}
                    >
                      Q{q}
                    </button>
                  ))}
                </div>
                {selectedQ !== current.quarter && (
                  <p className="text-xs text-amber-600 mt-2">
                    ⚠ Moving from Q{current.quarter} → Q{selectedQ}
                  </p>
                )}
              </div>

              {/* Notes */}
              <div>
                <SectionLabel>Notes (optional)</SectionLabel>
                <input
                  type="text"
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="e.g. 'has diagram placeholder — needs manual LaTeX'"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>

              {/* Actions */}
              <div className="flex items-center gap-3">
                <button
                  onClick={handlePrev}
                  disabled={!canPrev}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  ← Prev
                </button>

                <button
                  onClick={handleApprove}
                  disabled={saving}
                  className="flex-1 py-2.5 rounded-xl bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 disabled:opacity-60 transition"
                >
                  {saving ? 'Saving…' : `Approve · Q${selectedQ}`}
                </button>

                <button
                  onClick={handleNext}
                  disabled={!canNext}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  Next →
                </button>
              </div>

            </div>
          )}
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-sm px-5 py-3 rounded-xl shadow-lg z-50">
          {toast}
        </div>
      )}
    </div>
  )
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [online, setOnline]           = useState<boolean | null>(null)
  const [page, setPage]               = useState<Page>('generate')
  const [week, setWeek]               = useState<Date>(() => getMonday(new Date()))
  const [grade, setGrade]             = useState<Grade>('6')
  const [classType, setClassType]     = useState<ClassType>('grade_level')
  const [status, setStatus]           = useState<Status>('idle')
  const [errorMsg, setErrorMsg]       = useState('')
  const [history, setHistory]         = useState<Assignment[]>([])
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null)

  useEffect(() => { checkHealth().then(setOnline) }, [])

  const handleGenerate = useCallback(async () => {
    setStatus('loading')
    setErrorMsg('')
    setPdfPreviewUrl(null)

    const req: GenerateRequest = { week_start: formatISO(week), grade, class_type: classType }

    try {
      const blob = await generateHomework(req)
      const url  = URL.createObjectURL(blob)
      setPdfPreviewUrl(url)

      const label = `${formatWeekRange(week)} · Grade ${grade} · ${classType === 'honors' ? 'Honors' : 'Grade Level'}`
      setHistory(prev => [{ weekStart: formatISO(week), grade, classType, label, pdfUrl: url }, ...prev])
      setStatus('done')
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : 'Unknown error')
      setStatus('error')
    }
  }, [week, grade, classType])

  return (
    <div className="min-h-screen flex flex-col">

      {/* ── Header ── */}
      <header className="bg-brand-600 text-white shadow-md">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Math Homework Generator</h1>
            <p className="text-brand-100 text-sm mt-0.5">Grades 5–8 · Spiral Review + Lesson Practice</p>
          </div>
          <div className="flex items-center gap-6">
            {/* Nav tabs */}
            <nav className="flex gap-1">
              {([
                { key: 'generate', label: 'Generate' },
                { key: 'review',   label: 'Review Bank' },
              ] as { key: Page; label: string }[]).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setPage(key)}
                  className={[
                    'px-4 py-1.5 rounded-lg text-sm font-medium transition',
                    page === key
                      ? 'bg-white text-brand-700'
                      : 'text-brand-100 hover:bg-brand-500',
                  ].join(' ')}
                >
                  {label}
                </button>
              ))}
            </nav>
            <StatusDot online={online} />
          </div>
        </div>
      </header>

      {/* ── Body ── */}
      <main className="flex-1 max-w-5xl mx-auto w-full px-6 py-8">

        {/* ── Generate Page ── */}
        {page === 'generate' && (
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_420px] gap-8 items-start">

            {/* Left: Form */}
            <div className="space-y-6">
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-6">
                <h2 className="text-base font-semibold text-slate-700">Generate Assignment</h2>

                <div>
                  <SectionLabel>Week</SectionLabel>
                  <WeekPicker value={week} onChange={setWeek} />
                </div>

                <div>
                  <SectionLabel>Grade</SectionLabel>
                  <div className="grid grid-cols-4 gap-2">
                    {(['5', '6', '7', '8'] as Grade[]).map(g => (
                      <button
                        key={g}
                        onClick={() => setGrade(g)}
                        disabled={g === '5' || g === '7' || g === '8'}
                        className={[
                          'py-2 rounded-lg border text-sm font-medium transition',
                          grade === g ? 'bg-brand-600 border-brand-600 text-white shadow-sm' : 'bg-white border-slate-300 text-slate-600 hover:border-brand-400 hover:text-brand-600',
                          (g === '5' || g === '7' || g === '8') ? 'opacity-40 cursor-not-allowed' : '',
                        ].join(' ')}
                      >
                        {g === '5' || g === '7' || g === '8' ? `${g} · soon` : `Grade ${g}`}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <SectionLabel>Class Type</SectionLabel>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { val: 'grade_level' as ClassType, label: 'Grade Level', sub: '20 min · 10–12 problems' },
                      { val: 'honors' as ClassType,      label: 'Honors',      sub: '30 min · challenge problems' },
                    ].map(({ val, label, sub }) => (
                      <button
                        key={val}
                        onClick={() => setClassType(val)}
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

                <div className="bg-slate-50 rounded-xl p-3 text-sm text-slate-600">
                  <span className="font-medium">Generating: </span>
                  Grade {grade} · {classType === 'honors' ? 'Honors' : 'Grade Level'} · {formatWeekRange(week)}
                </div>

                {status === 'error' && (
                  <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">
                    <span className="font-semibold">Error: </span>{errorMsg}
                  </div>
                )}

                <button
                  onClick={handleGenerate}
                  disabled={status === 'loading' || !online}
                  className={[
                    'w-full py-3 rounded-xl text-sm font-semibold transition shadow-sm',
                    status === 'loading' ? 'bg-brand-400 text-white cursor-wait'
                    : !online ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                    : 'bg-brand-600 text-white hover:bg-brand-700 active:scale-[0.99]',
                  ].join(' ')}
                >
                  {status === 'loading' ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                      </svg>
                      Generating PDF…
                    </span>
                  ) : 'Generate Homework PDF'}
                </button>
              </div>

              {history.length > 0 && (
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                  <h2 className="text-base font-semibold text-slate-700 mb-3">Generated This Session</h2>
                  <div className="space-y-2">
                    {history.map((item, i) => (
                      <HistoryItem key={i} item={item} onRemove={() => setHistory(prev => prev.filter((_, j) => j !== i))} />
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
                    <a href={pdfPreviewUrl} download={`hw_grade${grade}_${formatISO(week)}.pdf`} className="text-xs font-medium text-brand-600 hover:text-brand-800 flex items-center gap-1">↓ Download PDF</a>
                  )}
                </div>
                {pdfPreviewUrl ? (
                  <iframe src={pdfPreviewUrl} className="w-full" style={{ height: '680px' }} title="Homework PDF preview" />
                ) : (
                  <div className="flex flex-col items-center justify-center text-center py-16 px-8 text-slate-400">
                    <div className="text-5xl mb-4">📄</div>
                    <p className="text-sm font-medium text-slate-500">No preview yet</p>
                    <p className="text-xs mt-1">
                      {status === 'loading' ? 'Generating — this takes about 30 seconds…' : 'Configure options and click Generate'}
                    </p>
                    {status === 'loading' && (
                      <div className="mt-4 w-32 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-brand-400 rounded-full animate-[pulse_1.2s_ease-in-out_infinite]" style={{ width: '60%' }} />
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

          </div>
        )}

        {/* ── Review Page ── */}
        {page === 'review' && <ReviewPage />}

      </main>

      {/* ── Footer ── */}
      <footer className="border-t border-slate-200 py-4 text-center text-xs text-slate-400">
        Math Homework Generator · Grades 5–8 ·{' '}
        <a href="https://github.com" className="hover:text-brand-500">GitHub</a>
      </footer>
    </div>
  )
}
