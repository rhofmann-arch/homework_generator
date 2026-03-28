import { useState, useEffect, useCallback, useRef } from 'react'
import {
  generateHomework, checkHealth, fetchReviewQueue, fetchBankStats,
  approveProblem, flagProblem, deleteProblem,
  DOMAINS,
  type GenerateRequest, type BankProblem, type BankStats, type Domain,
} from './api'
import {
  getMonday, formatWeekRange, formatISO,
  nextWeek, prevWeek, schoolYearWeeks,
} from './dates'

// ─── Types ────────────────────────────────────────────────────────────────────

type Grade = '5' | '6' | '7' | '8'
type ClassType = 'grade_level' | 'honors'
type Status = 'idle' | 'loading' | 'done' | 'error'
type AppTab = 'generate' | 'review'

interface Assignment {
  weekStart: string
  grade: Grade
  classType: ClassType
  label: string
  pdfUrl: string
}

// ─── Small components ─────────────────────────────────────────────────────────

function Badge({ children, color = 'blue' }: { children: React.ReactNode; color?: 'blue' | 'green' | 'slate' | 'amber' | 'red' }) {
  const cls = {
    blue:  'bg-brand-100 text-brand-700',
    green: 'bg-honors-50 text-honors-700',
    slate: 'bg-slate-100 text-slate-600',
    amber: 'bg-amber-100 text-amber-700',
    red:   'bg-red-100 text-red-700',
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
        onChange={e => onChange(getMonday(new Date(e.target.value + 'T12:00:00')))}
        className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
      >
        {weeks.map(w => {
          const iso = formatISO(w)
          return <option key={iso} value={iso}>{formatWeekRange(w)}</option>
        })}
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
          <Badge color={item.classType === 'honors' ? 'green' : 'blue'}>
            {item.classType === 'honors' ? 'Honors' : 'Grade Level'}
          </Badge>
        </div>
      </div>
      <div className="flex items-center gap-2 ml-3">
        <a href={item.pdfUrl} download={`hw_grade${item.grade}_${item.weekStart}.pdf`} className="text-xs font-medium text-brand-600 hover:text-brand-800 underline">Download</a>
        <button onClick={onRemove} className="text-slate-300 hover:text-slate-500 text-lg leading-none" title="Remove">×</button>
      </div>
    </div>
  )
}

// ─── Review Bank Tab ──────────────────────────────────────────────────────────

function ReviewBank() {
  const [stats, setStats] = useState<BankStats | null>(null)
  const [problems, setProblems] = useState<BankProblem[]>([])
  const [total, setTotal] = useState(0)
  const [index, setIndex] = useState(0)       // current position in queue
  const [loading, setLoading] = useState(false)
  const [actionMsg, setActionMsg] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Per-problem selections
  const [selectedDomain, setSelectedDomain] = useState<Domain | ''>('')
  const [selectedQuarter, setSelectedQuarter] = useState<number | ''>('')
  const [notes, setNotes] = useState('')

  const mathJaxRef = useRef<HTMLDivElement>(null)

  const loadQueue = useCallback(async () => {
    setLoading(true)
    try {
      const [queueRes, statsRes] = await Promise.all([
        fetchReviewQueue({ inbox_only: true, limit: 200 }),
        fetchBankStats(6),
      ])
      setProblems(queueRes.problems)
      setTotal(queueRes.total)
      setStats(statsRes)
      setIndex(0)
    } catch (e) {
      setActionMsg('Failed to load queue')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadQueue() }, [loadQueue])

  // Re-render MathJax when problem changes
  useEffect(() => {
    if (typeof window !== 'undefined' && (window as any).MathJax?.typesetPromise && mathJaxRef.current) {
      ;(window as any).MathJax.typesetPromise([mathJaxRef.current]).catch(() => {})
    }
  }, [index, problems])

  // Reset selections when moving to a new problem
  useEffect(() => {
    const p = problems[index]
    if (p) {
      setSelectedDomain(p.domain ?? '')
      setSelectedQuarter(p.suggested_quarter ?? '')
      setNotes(p.notes ?? '')
    }
    setConfirmDelete(false)
    setActionMsg('')
  }, [index, problems])

  const current = problems[index]

  const advance = () => {
    if (index < problems.length - 1) setIndex(i => i + 1)
    else loadQueue()  // refresh stats when queue exhausted
  }

  const handleApprove = async () => {
    if (!current || !selectedDomain || !selectedQuarter) {
      setActionMsg('Please select a domain and quarter before approving.')
      return
    }
    try {
      await approveProblem({
        problem_id: current.id,
        domain: selectedDomain as Domain,
        quarter: Number(selectedQuarter),
        notes,
        grade: current.grade,
      })
      setProblems(prev => prev.filter((_, i) => i !== index))
      setTotal(t => t - 1)
      setActionMsg('✓ Approved')
      // Don't advance — stay at same index (next problem slides in)
    } catch (e: any) {
      setActionMsg(`Error: ${e.message}`)
    }
  }

  const handleFlag = async () => {
    if (!current) return
    try {
      await flagProblem(current.id, notes, current.grade)
      setProblems(prev => prev.filter((_, i) => i !== index))
      setTotal(t => t - 1)
      setActionMsg('🚩 Flagged')
    } catch (e: any) {
      setActionMsg(`Error: ${e.message}`)
    }
  }

  const handleDelete = async () => {
    if (!current) return
    if (!confirmDelete) { setConfirmDelete(true); return }
    try {
      await deleteProblem(current.id, current.grade)
      setProblems(prev => prev.filter((_, i) => i !== index))
      setTotal(t => t - 1)
      setActionMsg('🗑 Deleted')
      setConfirmDelete(false)
    } catch (e: any) {
      setActionMsg(`Error: ${e.message}`)
    }
  }

  // ── Stats panel ──
  const StatsPanel = () => (
    <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-700">Bank Status</h3>
        <button onClick={loadQueue} className="text-xs text-brand-600 hover:text-brand-800">↻ Refresh</button>
      </div>
      {stats ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-500">📥 Inbox (awaiting review)</span>
            <span className="font-semibold text-amber-600">{stats.inbox.total}</span>
          </div>
          {DOMAINS.map(({ value, label }) => {
            const d = stats.domains[value]
            if (!d) return null
            return (
              <div key={value} className="flex items-center justify-between text-xs text-slate-500">
                <span>{label}</span>
                <span>
                  <span className="text-green-600 font-medium">{d.approved} approved</span>
                  {d.flagged > 0 && <span className="text-amber-500 ml-2">{d.flagged} flagged</span>}
                  {d.pending > 0 && <span className="text-slate-400 ml-2">{d.pending} pending</span>}
                </span>
              </div>
            )
          })}
        </div>
      ) : (
        <p className="text-xs text-slate-400">Loading stats…</p>
      )}
    </div>
  )

  if (loading) {
    return (
      <div className="space-y-4">
        <StatsPanel />
        <div className="text-center py-12 text-slate-400 text-sm">Loading queue…</div>
      </div>
    )
  }

  if (problems.length === 0) {
    return (
      <div className="space-y-4">
        <StatsPanel />
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
          <p className="text-2xl mb-2">🎉</p>
          <p className="text-sm font-medium text-slate-600">Inbox is empty</p>
          <p className="text-xs text-slate-400 mt-1">All ingested problems have been reviewed.</p>
          <p className="text-xs text-slate-400 mt-3">To add more: run <code className="bg-slate-100 px-1 rounded">python3 scripts/ingest_pdf.py --pdf yourfile.pdf</code></p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <StatsPanel />

      {/* Progress */}
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>Problem {index + 1} of {problems.length} in queue</span>
        <div className="flex gap-2">
          <button onClick={() => setIndex(i => Math.max(0, i - 1))} disabled={index === 0} className="px-2 py-1 rounded border border-slate-200 disabled:opacity-30 hover:bg-slate-50">← Prev</button>
          <button onClick={() => setIndex(i => Math.min(problems.length - 1, i + 1))} disabled={index >= problems.length - 1} className="px-2 py-1 rounded border border-slate-200 disabled:opacity-30 hover:bg-slate-50">Next →</button>
        </div>
      </div>

      {/* Problem card */}
      {current && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">

          {/* Meta */}
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex flex-wrap gap-2 items-center">
            <Badge color="slate">{current.id}</Badge>
            <Badge color="slate">📄 {current.source_file}</Badge>
            {current.source_problem_number && <Badge color="slate">#{current.source_problem_number}</Badge>}
            {current.suggested_quarter && <Badge color="amber">Suggested Q{current.suggested_quarter}</Badge>}
          </div>

          {/* Topic */}
          {current.topic && (
            <div className="px-4 pt-3 text-xs text-slate-500 italic">{current.topic}</div>
          )}

          {/* LaTeX */}
          <div ref={mathJaxRef} className="px-4 py-4">
            <div className="text-sm text-slate-700 leading-relaxed" dangerouslySetInnerHTML={{ __html: current.latex }} />
            {current.answer_latex && (
              <div className="mt-3 pt-3 border-t border-slate-100">
                <span className="text-xs font-medium text-slate-400 mr-2">Answer:</span>
                <span className="text-sm text-slate-600" dangerouslySetInnerHTML={{ __html: current.answer_latex }} />
              </div>
            )}
          </div>

          {/* Review controls */}
          <div className="px-4 pb-4 space-y-3 border-t border-slate-100 pt-3">

            {/* Domain selector */}
            <div>
              <SectionLabel>Domain</SectionLabel>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {DOMAINS.map(({ value, label }) => (
                  <button
                    key={value}
                    onClick={() => setSelectedDomain(value)}
                    className={[
                      'py-1.5 px-2 rounded-lg border text-xs font-medium transition text-left',
                      selectedDomain === value
                        ? 'bg-brand-600 border-brand-600 text-white'
                        : 'bg-white border-slate-300 text-slate-600 hover:border-brand-400',
                    ].join(' ')}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Quarter selector */}
            <div>
              <SectionLabel>Quarter{current.suggested_quarter ? ` (suggested: Q${current.suggested_quarter})` : ''}</SectionLabel>
              <div className="grid grid-cols-4 gap-2">
                {[1, 2, 3, 4].map(q => (
                  <button
                    key={q}
                    onClick={() => setSelectedQuarter(q)}
                    className={[
                      'py-1.5 rounded-lg border text-xs font-medium transition',
                      selectedQuarter === q
                        ? 'bg-brand-600 border-brand-600 text-white'
                        : 'bg-white border-slate-300 text-slate-600 hover:border-brand-400',
                    ].join(' ')}
                  >
                    Q{q}
                  </button>
                ))}
              </div>
            </div>

            {/* Notes */}
            <div>
              <SectionLabel>Notes (optional)</SectionLabel>
              <input
                type="text"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="e.g. double check answer, unusual format…"
                className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-brand-400"
              />
            </div>

            {/* Action feedback */}
            {actionMsg && (
              <p className={`text-xs ${actionMsg.startsWith('Error') ? 'text-red-600' : 'text-green-600'}`}>
                {actionMsg}
              </p>
            )}

            {/* Action buttons */}
            <div className="flex gap-2">
              <button
                onClick={handleApprove}
                disabled={!selectedDomain || !selectedQuarter}
                className="flex-1 py-2 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                ✓ Approve
              </button>
              <button
                onClick={handleFlag}
                className="py-2 px-3 rounded-lg border border-amber-300 text-amber-700 text-sm font-medium hover:bg-amber-50 transition"
                title="Keep but mark for review"
              >
                🚩 Flag
              </button>
              <button
                onClick={handleDelete}
                className={`py-2 px-3 rounded-lg border text-sm font-medium transition ${confirmDelete ? 'bg-red-600 border-red-600 text-white' : 'border-red-200 text-red-500 hover:bg-red-50'}`}
                title={confirmDelete ? 'Click again to confirm delete' : 'Delete permanently'}
              >
                {confirmDelete ? 'Confirm?' : '🗑'}
              </button>
            </div>
            {confirmDelete && (
              <p className="text-xs text-red-500 text-center">This will permanently delete the problem. Click 🗑 Confirm again, or navigate away to cancel.</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Generate Tab ─────────────────────────────────────────────────────────────

function GenerateTab() {
  const [week, setWeek] = useState<Date>(() => getMonday(new Date()))
  const [grade, setGrade] = useState<Grade>('6')
  const [classType, setClassType] = useState<ClassType>('grade_level')
  const [status, setStatus] = useState<Status>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [history, setHistory] = useState<Assignment[]>([])
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null)

  const handleGenerate = useCallback(async () => {
    setStatus('loading')
    setErrorMsg('')
    setPdfPreviewUrl(null)

    const req: GenerateRequest = { week_start: formatISO(week), grade, class_type: classType }

    try {
      const blob = await generateHomework(req)
      const url = URL.createObjectURL(blob)
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
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_420px] gap-8 items-start">
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
                { val: 'honors' as ClassType, label: 'Honors', sub: '30 min · challenge problems' },
              ].map(({ val, label, sub }) => (
                <button
                  key={val}
                  onClick={() => setClassType(val)}
                  className={[
                    'text-left p-3 rounded-xl border-2 transition',
                    classType === val ? (val === 'honors' ? 'border-honors-600 bg-honors-50' : 'border-brand-500 bg-brand-50') : 'border-slate-200 bg-white hover:border-slate-300',
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
            disabled={status === 'loading'}
            className={[
              'w-full py-3 rounded-xl text-sm font-semibold transition shadow-sm',
              status === 'loading' ? 'bg-brand-400 text-white cursor-wait' : 'bg-brand-600 text-white hover:bg-brand-700 active:scale-[0.99]',
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
  )
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [online, setOnline] = useState<boolean | null>(null)
  const [tab, setTab] = useState<AppTab>('generate')

  useEffect(() => { checkHealth().then(setOnline) }, [])

  return (
    <div className="min-h-screen flex flex-col">
      {/* ── Header ── */}
      <header className="bg-brand-600 text-white shadow-md">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Math Homework Generator</h1>
            <p className="text-brand-100 text-sm mt-0.5">Grades 5–8 · Spiral Review + Lesson Practice</p>
          </div>
          <StatusDot online={online} />
        </div>

        {/* ── Tabs ── */}
        <div className="max-w-5xl mx-auto px-6 flex gap-1 pb-0">
          {([
            { id: 'generate', label: '📄 Generate' },
            { id: 'review',   label: '📥 Review Bank' },
          ] as { id: AppTab; label: string }[]).map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={[
                'px-4 py-2 text-sm font-medium rounded-t-lg transition',
                tab === id
                  ? 'bg-white text-brand-700'
                  : 'text-brand-100 hover:text-white hover:bg-brand-500',
              ].join(' ')}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      {/* ── Body ── */}
      <main className="flex-1 max-w-5xl mx-auto w-full px-6 py-8">
        {tab === 'generate' ? <GenerateTab /> : <ReviewBank />}
      </main>

      {/* ── Footer ── */}
      <footer className="border-t border-slate-200 py-4 text-center text-xs text-slate-400">
        Math Homework Generator · Grades 5–8 ·{' '}
        <a href="https://github.com" className="hover:text-brand-500">GitHub</a>
      </footer>
    </div>
  )
}
