import { useState, useEffect, useCallback } from 'react'
import {
  generateHomework, checkHealth, type GenerateRequest,
  fetchBankStats, fetchBankProblems, approveProblem, flagProblem, deleteProblem,
  type BankProblem, type BankStats,
} from './api'
import {
  getMonday, formatWeekRange, formatISO,
  nextWeek, prevWeek, schoolYearWeeks,
} from './dates'

// ─── Constants ────────────────────────────────────────────────────────────────

const DOMAINS = [
  { val: 'arithmetic',            label: 'Arithmetic' },
  { val: 'expressions_equations', label: 'Expressions & Eq.' },
  { val: 'geometry',              label: 'Geometry' },
  { val: 'stats_probability',     label: 'Stats & Prob.' },
  { val: 'other',                 label: 'Other' },
]

// ─── Types ────────────────────────────────────────────────────────────────────

type Grade = '5' | '6' | '7' | '8'
type ClassType = 'grade_level' | 'honors'
type AppMode = 'generate' | 'bank'
type GenStatus = 'idle' | 'loading' | 'done' | 'error'
type PreviewTab = 'homework' | 'key'

interface Assignment {
  weekStart: string
  grade: Grade
  classType: ClassType
  label: string
  homeworkUrl: string
  keyUrl: string
}

// ─── Shared small components ──────────────────────────────────────────────────

function Badge({ children, color = 'blue' }: { children: React.ReactNode; color?: 'blue' | 'green' | 'amber' | 'slate' }) {
  const cls = {
    blue:  'bg-blue-100 text-blue-700',
    green: 'bg-green-100 text-green-700',
    amber: 'bg-amber-100 text-amber-700',
    slate: 'bg-slate-100 text-slate-600',
  }[color]
  return <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{children}</span>
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">{children}</p>
}

function StatusDot({ online }: { online: boolean | null }) {
  if (online === null) return null
  return (
    <span className="flex items-center gap-1.5 text-xs text-slate-300">
      <span className={`w-2 h-2 rounded-full ${online ? 'bg-green-400' : 'bg-red-400'}`} />
      {online ? 'Backend connected' : 'Backend offline'}
    </span>
  )
}

// ─── Week Picker ──────────────────────────────────────────────────────────────

function WeekPicker({ value, onChange }: { value: Date; onChange: (d: Date) => void }) {
  const weeks = schoolYearWeeks()
  return (
    <div className="flex items-center gap-2">
      <button onClick={() => onChange(prevWeek(value))}
        className="p-1.5 rounded hover:bg-slate-200 text-slate-500 transition">◀</button>
      <select value={formatISO(value)}
        onChange={e => onChange(getMonday(new Date(e.target.value + 'T12:00:00')))}
        className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
        {weeks.map(w => {
          const iso = formatISO(w)
          return <option key={iso} value={iso}>{formatWeekRange(w)}</option>
        })}
      </select>
      <button onClick={() => onChange(nextWeek(value))}
        className="p-1.5 rounded hover:bg-slate-200 text-slate-500 transition">▶</button>
    </div>
  )
}

// ─── History Item ─────────────────────────────────────────────────────────────

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
      <div className="flex items-center gap-3 ml-3">
        <a href={item.homeworkUrl} download={`hw_grade${item.grade}_${item.weekStart}.pdf`}
          className="text-xs font-medium text-blue-600 hover:text-blue-800 underline">HW</a>
        <a href={item.keyUrl} download={`hw_grade${item.grade}_${item.weekStart}_KEY.pdf`}
          className="text-xs font-medium text-blue-600 hover:text-blue-800 underline">Key</a>
        <button onClick={onRemove}
          className="text-slate-300 hover:text-slate-500 text-lg leading-none">×</button>
      </div>
    </div>
  )
}

// ─── Generate Panel ───────────────────────────────────────────────────────────

function GeneratePanel({ online }: { online: boolean | null }) {
  const [week, setWeek]           = useState<Date>(() => getMonday(new Date()))
  const [grade, setGrade]         = useState<Grade>('6')
  const [classType, setClassType] = useState<ClassType>('grade_level')
  const [status, setStatus]       = useState<GenStatus>('idle')
  const [errorMsg, setErrorMsg]   = useState('')
  const [history, setHistory]     = useState<Assignment[]>([])
  const [previewTab, setPreviewTab] = useState<PreviewTab>('homework')
  const [homeworkUrl, setHomeworkUrl] = useState<string | null>(null)
  const [keyUrl, setKeyUrl]           = useState<string | null>(null)

  const handleGenerate = useCallback(async () => {
    setStatus('loading')
    setErrorMsg('')
    setHomeworkUrl(null)
    setKeyUrl(null)

    const req: GenerateRequest = { week_start: formatISO(week), grade, class_type: classType }

    try {
      const result = await generateHomework(req)
      const hw  = URL.createObjectURL(result.homeworkBlob)
      const key = URL.createObjectURL(result.keyBlob)
      setHomeworkUrl(hw)
      setKeyUrl(key)
      setPreviewTab('homework')
      const label = `${formatWeekRange(week)} · Grade ${grade} · ${classType === 'honors' ? 'Honors' : 'Grade Level'}`
      setHistory(prev => [{ weekStart: formatISO(week), grade, classType, label, homeworkUrl: hw, keyUrl: key }, ...prev])
      setStatus('done')
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : 'Unknown error')
      setStatus('error')
    }
  }, [week, grade, classType])

  const activeUrl = previewTab === 'homework' ? homeworkUrl : keyUrl

  return (
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
                <button key={g} onClick={() => setGrade(g)}
                  disabled={g !== '6'}
                  className={[
                    'py-2 rounded-lg border text-sm font-medium transition',
                    grade === g ? 'bg-blue-600 border-blue-600 text-white shadow-sm'
                                : 'bg-white border-slate-300 text-slate-600 hover:border-blue-400',
                    g !== '6' ? 'opacity-40 cursor-not-allowed' : '',
                  ].join(' ')}>
                  {g !== '6' ? `${g} · soon` : `Grade ${g}`}
                </button>
              ))}
            </div>
          </div>

          <div>
            <SectionLabel>Class Type</SectionLabel>
            <div className="grid grid-cols-2 gap-3">
              {[
                { val: 'grade_level' as ClassType, label: 'Grade Level', sub: '20 min · 10–12 problems' },
                { val: 'honors'      as ClassType, label: 'Honors',      sub: '30 min · honors problems' },
              ].map(({ val, label, sub }) => (
                <button key={val} onClick={() => setClassType(val)}
                  className={[
                    'text-left p-3 rounded-xl border-2 transition',
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

          <div className="bg-slate-50 rounded-xl p-3 text-sm text-slate-600">
            <span className="font-medium">Generating: </span>
            Grade {grade} · {classType === 'honors' ? 'Honors' : 'Grade Level'} · {formatWeekRange(week)}
          </div>

          {status === 'error' && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">
              <span className="font-semibold">Error: </span>{errorMsg}
            </div>
          )}

          <button onClick={handleGenerate} disabled={status === 'loading' || !online}
            className={[
              'w-full py-3 rounded-xl text-sm font-semibold transition shadow-sm',
              status === 'loading' ? 'bg-blue-400 text-white cursor-wait'
                : !online ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                : 'bg-blue-600 text-white hover:bg-blue-700',
            ].join(' ')}>
            {status === 'loading' ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                </svg>
                Generating PDF…
              </span>
            ) : 'Generate Homework + Key'}
          </button>
        </div>

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
            {(homeworkUrl || keyUrl) ? (
              <div className="flex gap-1 bg-slate-100 p-0.5 rounded-lg">
                {(['homework', 'key'] as PreviewTab[]).map(tab => (
                  <button key={tab} onClick={() => setPreviewTab(tab)}
                    className={[
                      'px-3 py-1 rounded-md text-xs font-medium transition',
                      previewTab === tab ? 'bg-white shadow-sm text-slate-700' : 'text-slate-500 hover:text-slate-700',
                    ].join(' ')}>
                    {tab === 'homework' ? 'Homework' : 'Answer Key'}
                  </button>
                ))}
              </div>
            ) : (
              <h2 className="text-sm font-semibold text-slate-700">Preview</h2>
            )}
            {activeUrl && (
              <a href={activeUrl}
                download={`hw_grade${grade}_${formatISO(week)}${previewTab === 'key' ? '_KEY' : ''}.pdf`}
                className="text-xs font-medium text-blue-600 hover:text-blue-800">
                ↓ Download
              </a>
            )}
          </div>

          {activeUrl ? (
            <iframe src={activeUrl} className="w-full" style={{ height: '680px' }} title="Preview" />
          ) : (
            <div className="flex flex-col items-center justify-center text-center py-16 px-8 text-slate-400">
              <div className="text-5xl mb-4">📄</div>
              <p className="text-sm font-medium text-slate-500">No preview yet</p>
              <p className="text-xs mt-1">
                {status === 'loading' ? 'Generating — this takes about 30 seconds…' : 'Configure options and click Generate'}
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

// ─── Bank Stats Bar ───────────────────────────────────────────────────────────

function StatsBar({ stats }: { stats: BankStats }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
      <div className="bg-white border border-slate-200 rounded-xl p-3">
        <p className="text-xs text-slate-400 mb-1">Inbox</p>
        <p className="text-xl font-bold text-slate-700">{stats.inbox.total}</p>
        {stats.inbox.high_priority > 0 && (
          <p className="text-xs text-amber-600 mt-0.5">⭐ {stats.inbox.high_priority} HP</p>
        )}
      </div>
      {DOMAINS.map(({ val, label }) => {
        const d = stats.domains[val]
        if (!d) return null
        return (
          <div key={val} className="bg-white border border-slate-200 rounded-xl p-3">
            <p className="text-xs text-slate-400 mb-1 truncate">{label}</p>
            <p className="text-xl font-bold text-slate-700">{d.approved}</p>
            <p className="text-xs text-slate-400">{d.pending} pending</p>
            {d.high_priority > 0 && (
              <p className="text-xs text-amber-600">⭐ {d.high_priority}</p>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Problem Card ─────────────────────────────────────────────────────────────

function ProblemCard({
  problem,
  onApprove,
  onFlag,
  onDelete,
}: {
  problem: BankProblem
  onApprove: (domain: string, quarter: number, honors: boolean) => Promise<void>
  onFlag: () => Promise<void>
  onDelete: () => Promise<void>
}) {
  const [domain,  setDomain]  = useState(problem.domain ?? 'arithmetic')
  const [quarter, setQuarter] = useState(problem.quarter ?? problem.suggested_quarter ?? 1)
  const [honors,  setHonors]  = useState(problem.honors ?? false)
  const [busy,    setBusy]    = useState(false)

  const act = async (fn: () => Promise<void>) => {
    setBusy(true)
    try { await fn() } finally { setBusy(false) }
  }

  return (
    <div className={[
      'bg-white border rounded-xl p-4 space-y-3',
      problem.flagged ? 'border-amber-300 bg-amber-50' : 'border-slate-200',
    ].join(' ')}>

      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          <Badge color="slate">{problem.id}</Badge>
          {problem.high_priority && <Badge color="amber">⭐ High Priority</Badge>}
          {problem.honors && <Badge color="green">Honors</Badge>}
          {problem.flagged && <Badge color="amber">Flagged</Badge>}
          {problem.keep_mc && <Badge color="slate">MC</Badge>}
          {problem.needs_diagram && <Badge color="slate">Needs diagram</Badge>}
          {problem.source && <Badge color="slate">{problem.source}</Badge>}
        </div>
        {problem.quarter && (
          <span className="text-xs text-slate-400 whitespace-nowrap">Q{problem.quarter}</span>
        )}
      </div>

      {/* Topic */}
      {problem.topic && (
        <p className="text-xs text-slate-500 italic">{problem.topic}</p>
      )}

      {/* LaTeX preview */}
      <div className="bg-slate-50 rounded-lg px-3 py-2 font-mono text-xs text-slate-700 overflow-x-auto whitespace-pre-wrap break-words max-h-32 overflow-y-auto">
        {problem.latex}
      </div>

      {/* Answer */}
      {problem.answer_latex && (
        <p className="text-xs text-slate-500">
          <span className="font-semibold">Answer:</span> {problem.answer_latex}
        </p>
      )}

      {/* MC keep reason */}
      {problem.keep_mc_reason && (
        <p className="text-xs text-slate-400 italic">MC reason: {problem.keep_mc_reason}</p>
      )}

      {/* Diagram notes */}
      {problem.needs_diagram && problem.diagram_notes && (
        <p className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1">
          📐 {problem.diagram_notes}
        </p>
      )}

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        {/* Domain */}
        <select value={domain} onChange={e => setDomain(e.target.value)}
          className="border border-slate-300 rounded-lg px-2 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-blue-400">
          {DOMAINS.map(({ val, label }) => (
            <option key={val} value={val}>{label}</option>
          ))}
        </select>

        {/* Quarter */}
        <select value={quarter} onChange={e => setQuarter(Number(e.target.value))}
          className="border border-slate-300 rounded-lg px-2 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-blue-400">
          {[1, 2, 3, 4].map(q => <option key={q} value={q}>Q{q}</option>)}
        </select>

        {/* Honors toggle */}
        <button onClick={() => setHonors(h => !h)}
          className={[
            'px-2 py-1 rounded-lg text-xs font-medium border transition',
            honors ? 'bg-green-100 border-green-400 text-green-700' : 'bg-white border-slate-300 text-slate-500',
          ].join(' ')}>
          {honors ? '⭐ Honors' : 'Honors'}
        </button>

        <div className="flex gap-1.5 ml-auto">
          <button disabled={busy}
            onClick={() => act(() => onApprove(domain, quarter, honors))}
            className="px-3 py-1 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition">
            ✓ Approve
          </button>
          <button disabled={busy} onClick={() => act(onFlag)}
            className="px-3 py-1 rounded-lg text-xs font-medium border border-amber-400 text-amber-700 hover:bg-amber-50 disabled:opacity-50 transition">
            ⚑ Flag
          </button>
          <button disabled={busy} onClick={() => act(onDelete)}
            className="px-3 py-1 rounded-lg text-xs font-medium border border-red-300 text-red-600 hover:bg-red-50 disabled:opacity-50 transition">
            ✕
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Bank Review Panel ────────────────────────────────────────────────────────

function BankPanel() {
  const [stats,    setStats]    = useState<BankStats | null>(null)
  const [problems, setProblems] = useState<BankProblem[]>([])
  const [total,    setTotal]    = useState(0)
  const [offset,   setOffset]   = useState(0)
  const [loading,  setLoading]  = useState(false)

  // Filters
  const [filterHP,     setFilterHP]     = useState(false)
  const [filterDomain, setFilterDomain] = useState('')
  const [filterSource, setFilterSource] = useState('')

  const LIMIT = 20

  const loadStats = useCallback(async () => {
    try { setStats(await fetchBankStats(6)) } catch { /* ignore */ }
  }, [])

  const loadProblems = useCallback(async (newOffset = 0) => {
    setLoading(true)
    try {
      const res = await fetchBankProblems({
        grade: 6,
        inbox_only: true,
        high_priority: filterHP ? true : undefined,
        domain: filterDomain || undefined,
        limit: LIMIT,
        offset: newOffset,
      })
      setProblems(res.problems)
      setTotal(res.total)
      setOffset(newOffset)
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [filterHP, filterDomain])

  useEffect(() => { loadStats() }, [loadStats])
  useEffect(() => { loadProblems(0) }, [loadProblems])

  const handleApprove = async (problem: BankProblem, domain: string, quarter: number, honors: boolean) => {
    await approveProblem({ problem_id: problem.id, domain, quarter, honors, grade: 6 })
    setProblems(prev => prev.filter(p => p.id !== problem.id))
    setTotal(t => t - 1)
    loadStats()
  }

  const handleFlag = async (problem: BankProblem) => {
    await flagProblem({ problem_id: problem.id, grade: 6 })
    setProblems(prev => prev.map(p => p.id === problem.id ? { ...p, flagged: true } : p))
  }

  const handleDelete = async (problem: BankProblem) => {
    await deleteProblem({ problem_id: problem.id, grade: 6 })
    setProblems(prev => prev.filter(p => p.id !== problem.id))
    setTotal(t => t - 1)
    loadStats()
  }

  const visibleProblems = filterSource
    ? problems.filter(p => p.source === filterSource)
    : problems

  return (
    <div>
      {/* Stats */}
      {stats && <StatsBar stats={stats} />}

      {/* Filter bar */}
      <div className="flex flex-wrap gap-2 mb-4">
        <button onClick={() => setFilterHP(f => !f)}
          className={[
            'px-3 py-1.5 rounded-lg text-xs font-medium border transition',
            filterHP ? 'bg-amber-100 border-amber-400 text-amber-700' : 'bg-white border-slate-300 text-slate-600',
          ].join(' ')}>
          ⭐ High Priority Only
        </button>

        <select value={filterDomain} onChange={e => setFilterDomain(e.target.value)}
          className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-blue-400">
          <option value="">All Domains</option>
          {DOMAINS.map(({ val, label }) => <option key={val} value={val}>{label}</option>)}
        </select>

        <select value={filterSource} onChange={e => setFilterSource(e.target.value)}
          className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-blue-400">
          <option value="">All Sources</option>
          <option value="eoc_review">EOC Review</option>
        </select>

        <button onClick={() => loadProblems(0)}
          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 transition ml-auto">
          ↺ Refresh
        </button>
      </div>

      {/* Problem count */}
      <p className="text-xs text-slate-400 mb-3">
        {loading ? 'Loading…' : `${total} problems in inbox${filterHP ? ' · HP filter on' : ''}`}
      </p>

      {/* Problem list */}
      <div className="space-y-3">
        {visibleProblems.map(problem => (
          <ProblemCard
            key={problem.id}
            problem={problem}
            onApprove={(d, q, h) => handleApprove(problem, d, q, h)}
            onFlag={() => handleFlag(problem)}
            onDelete={() => handleDelete(problem)}
          />
        ))}
        {!loading && visibleProblems.length === 0 && (
          <div className="text-center py-12 text-slate-400 text-sm">
            No problems in inbox.
          </div>
        )}
      </div>

      {/* Pagination */}
      {total > LIMIT && (
        <div className="flex items-center justify-between mt-4">
          <button disabled={offset === 0}
            onClick={() => loadProblems(offset - LIMIT)}
            className="px-3 py-1.5 rounded-lg text-xs border border-slate-300 disabled:opacity-40">
            ← Prev
          </button>
          <span className="text-xs text-slate-400">
            {offset + 1}–{Math.min(offset + LIMIT, total)} of {total}
          </span>
          <button disabled={offset + LIMIT >= total}
            onClick={() => loadProblems(offset + LIMIT)}
            className="px-3 py-1.5 rounded-lg text-xs border border-slate-300 disabled:opacity-40">
            Next →
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [online, setOnline] = useState<boolean | null>(null)
  const [mode,   setMode]   = useState<AppMode>('generate')

  useEffect(() => { checkHealth().then(setOnline) }, [])

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="bg-blue-700 text-white shadow-md">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Math Homework Generator</h1>
            <p className="text-blue-200 text-sm mt-0.5">Grades 5–8 · Spiral Review + Lesson Practice</p>
          </div>
          <div className="flex items-center gap-4">
            {/* Mode tabs */}
            <div className="flex gap-1 bg-blue-800 p-0.5 rounded-lg">
              {([
                { val: 'generate', label: '📄 Generate' },
                { val: 'bank',     label: '🗂 Bank Review' },
              ] as { val: AppMode; label: string }[]).map(({ val, label }) => (
                <button key={val} onClick={() => setMode(val)}
                  className={[
                    'px-3 py-1.5 rounded-md text-xs font-medium transition',
                    mode === val ? 'bg-white text-blue-800 shadow-sm' : 'text-blue-200 hover:text-white',
                  ].join(' ')}>
                  {label}
                </button>
              ))}
            </div>
            <StatusDot online={online} />
          </div>
        </div>
      </header>

      {/* Body */}
      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-8">
        {mode === 'generate'
          ? <GeneratePanel online={online} />
          : <BankPanel />
        }
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 py-4 text-center text-xs text-slate-400">
        Math Homework Generator · Grades 5–8
      </footer>
    </div>
  )
}
