// !! FEATURE CHECKLIST — DO NOT REMOVE ANY OF THESE !!
// [1] DAY PICKER: Mon–Thu buttons, specific_date sent to backend, generate disabled until day selected
// [2] BANK REVIEW MODE: mode switcher in header, full review panel with approve/flag/delete
// [3] PROBLEM EDITOR: edit LaTeX per-problem, recompile, save to bank
// [4] HW + KEY: separate download links for homework and answer key

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  generateHomework, fetchHomeworkProblems, recompileHomework, refreshProblem,
  fetchBankStats, fetchReviewQueue, approveProblem, flagProblem, deleteProblem,
  saveProblemToBank, checkHealth,
  type GenerateRequest, type HomeworkProblems, type HomeworkProblem,
  type BankStats, type BankProblem, type Domain,
} from './api'
import {
  getMonday, formatWeekRange, formatISO, nextWeek, prevWeek, schoolYearWeeks,
} from './dates'

// ─── Types ────────────────────────────────────────────────────────────────────

type Grade     = '5' | '6' | '7' | '8'
type ClassType = 'grade_level' | 'honors'
type Status    = 'idle' | 'loading' | 'done' | 'error'
type AppMode   = 'generate' | 'bank'

interface Assignment {
  weekStart:    string
  specificDate?: string
  grade:        Grade
  classType:    ClassType
  label:        string
  pdfUrl:       string
  keyUrl:       string
  sessionKey:   string
}

// ─── Shared tiny components ───────────────────────────────────────────────────

function Badge({ children, color = 'blue' }: {
  children: React.ReactNode
  color?: 'blue' | 'green' | 'slate' | 'amber' | 'red' | 'purple'
}) {
  const cls: Record<string, string> = {
    blue:   'bg-blue-100 text-blue-700',
    green:  'bg-green-50 text-green-700',
    slate:  'bg-slate-100 text-slate-600',
    amber:  'bg-amber-50 text-amber-700',
    red:    'bg-red-50 text-red-600',
    purple: 'bg-purple-50 text-purple-700',
  }
  return <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${cls[color]}`}>{children}</span>
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
        {weeks.map(w => { const iso = formatISO(w); return <option key={iso} value={iso}>{formatWeekRange(w)}</option> })}
      </select>
      <button onClick={() => onChange(nextWeek(value))}
        className="p-1.5 rounded hover:bg-slate-200 text-slate-500 transition">▶</button>
    </div>
  )
}

// ─── Day Picker ───────────────────────────────────────────────────────────────
// !! HIGH IMPORTANCE — DO NOT REMOVE !!
// Generates one homework per day (Mon–Thu). specific_date sent to backend.

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu']

function DayPicker({ week, value, onChange }: {
  week: Date; value: string | null; onChange: (iso: string | null) => void
}) {
  const days = Array.from({ length: 4 }, (_, i) => {
    const d = new Date(week); d.setDate(week.getDate() + i); return d
  })
  return (
    <div className="grid grid-cols-4 gap-2">
      {days.map((d, i) => {
        const iso = formatISO(d); const sel = value === iso
        return (
          <button key={iso} onClick={() => onChange(sel ? null : iso)}
            className={['py-1.5 rounded-lg border text-sm font-medium transition',
              sel ? 'bg-blue-600 border-blue-600 text-white shadow-sm'
                  : 'bg-white border-slate-300 text-slate-600 hover:border-blue-400',
            ].join(' ')}>
            <span className="block text-xs">{DAY_LABELS[i]}</span>
            <span className="block text-xs opacity-70">{d.getDate()}</span>
          </button>
        )
      })}
    </div>
  )
}

// ─── History Item ─────────────────────────────────────────────────────────────

function HistoryItem({ item, isEditing, onEdit, onRemove }: {
  item: Assignment; isEditing: boolean; onEdit: () => void; onRemove: () => void
}) {
  return (
    <div className={`flex items-center justify-between py-2.5 px-3 border rounded-lg transition ${
      isEditing ? 'bg-blue-50 border-blue-300' : 'bg-white border-slate-200'}`}>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-700 truncate">{item.label}</p>
        <div className="flex gap-1.5 mt-1">
          <Badge color="slate">Grade {item.grade}</Badge>
          <Badge color={item.classType === 'honors' ? 'green' : 'blue'}>
            {item.classType === 'honors' ? 'Honors' : 'Grade Level'}
          </Badge>
        </div>
      </div>
      <div className="flex items-center gap-2 ml-3 shrink-0">
        <a href={item.pdfUrl} download className="text-xs font-medium text-blue-600 hover:text-blue-800">HW</a>
        <a href={item.keyUrl} download className="text-xs font-medium text-slate-500 hover:text-slate-700">Key</a>
        <button onClick={onEdit}
          className={`text-xs font-medium px-2 py-1 rounded transition ${
            isEditing ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-blue-100 hover:text-blue-700'}`}>
          ✏️ Edit
        </button>
        <button onClick={onRemove} className="text-slate-300 hover:text-slate-500 text-lg leading-none">×</button>
      </div>
    </div>
  )
}

// ─── Problem Card (editor) ────────────────────────────────────────────────────

function ProblemCard({ number, problem, section, grade, onUpdate, onRefresh, isRefreshing }: {
  number: number; problem: HomeworkProblem; section: 'front' | 'back' | 'challenge'
  grade: Grade; onUpdate: (u: HomeworkProblem) => void
  onRefresh?: () => Promise<void>; isRefreshing?: boolean
}) {
  const [editing, setEditing]     = useState(false)
  const [draft, setDraft]         = useState(problem.latex)
  const [savedToBank, setSaved]   = useState(false)
  const [bankMsg, setBankMsg]     = useState('')
  const previewRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!editing && previewRef.current) {
      const mj = (window as any).MathJax
      if (mj?.typesetPromise) mj.typesetPromise([previewRef.current]).catch(() => {})
    }
  }, [editing, problem.latex])

  const handleSave   = () => { onUpdate({ ...problem, latex: draft }); setEditing(false) }
  const handleCancel = () => { setDraft(problem.latex); setEditing(false) }

  const handleBank = async () => {
    setBankMsg('Saving…')
    try {
      await saveProblemToBank({ latex: problem.latex, answer_latex: problem.answer_latex ?? '', section, grade: Number(grade) })
      setSaved(true); setBankMsg('✓ Saved')
    } catch (e: unknown) { setBankMsg(e instanceof Error ? e.message : 'Failed') }
  }

  return (
    <div className="border border-slate-200 rounded-xl bg-white overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-slate-50 border-b border-slate-100">
        <span className="text-xs font-semibold text-slate-500">#{number}</span>
        <div className="flex gap-2 items-center">
          {onRefresh && (
            <button onClick={onRefresh} disabled={isRefreshing || editing}
              title="Get a different problem"
              className={`text-xs font-medium transition ${isRefreshing ? 'text-slate-300 cursor-wait' : 'text-slate-400 hover:text-blue-600'}`}>
              {isRefreshing ? '↻…' : '↻'}
            </button>
          )}
          {!editing && <button onClick={() => { setDraft(problem.latex); setEditing(true) }}
            className="text-xs text-blue-600 hover:text-blue-800 font-medium">Edit LaTeX</button>}
          <button onClick={handleBank} disabled={savedToBank}
            className={`text-xs font-medium ${savedToBank ? 'text-green-600 cursor-default' : 'text-slate-400 hover:text-slate-600'}`}>
            {bankMsg || '+ Bank'}
          </button>
        </div>
      </div>
      <div className="px-3 py-3">
        {editing ? (
          <div className="space-y-2">
            <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={4}
              className="w-full text-xs font-mono border border-slate-300 rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-y" spellCheck={false}/>
            <div className="flex gap-2">
              <button onClick={handleSave} className="px-3 py-1 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 transition">Save</button>
              <button onClick={handleCancel} className="px-3 py-1 bg-slate-100 text-slate-600 text-xs font-medium rounded-lg hover:bg-slate-200 transition">Cancel</button>
            </div>
          </div>
        ) : (
          <div ref={previewRef} className="text-sm text-slate-700 leading-relaxed min-h-[1.5rem]"
            dangerouslySetInnerHTML={{ __html: problem.latex }}/>
        )}
      </div>
    </div>
  )
}

// ─── Problem Editor Panel ─────────────────────────────────────────────────────

function ProblemEditor({ assignment, onClose, onRecompiled }: {
  assignment: Assignment; onClose: () => void
  onRecompiled: (newPdf: string, newKey: string) => void
}) {
  const [problems,      setProblems]      = useState<HomeworkProblems | null>(null)
  const [loadError,     setLoadError]     = useState('')
  const [recompiling,   setRecompiling]   = useState(false)
  const [msg,           setMsg]           = useState('')
  // Track which problems are currently being refreshed: "front_0", "back_2", etc.
  const [refreshing,    setRefreshing]    = useState<Set<string>>(new Set())

  useEffect(() => {
    fetchHomeworkProblems(assignment.sessionKey).then(setProblems)
      .catch(e => setLoadError(e instanceof Error ? e.message : 'Failed to load'))
  }, [assignment.sessionKey])

  const updateProblem = (section: keyof HomeworkProblems, idx: number, updated: HomeworkProblem) => {
    setProblems(prev => {
      if (!prev) return prev
      const arr = [...(prev[section] as HomeworkProblem[])]; arr[idx] = updated
      return { ...prev, [section]: arr }
    })
  }

  const handleRefresh = async (section: 'front' | 'back', idx: number) => {
    const key = `${section}_${idx}`
    setRefreshing(prev => new Set(prev).add(key))
    try {
      const updated = await refreshProblem(assignment.sessionKey, section, idx)
      const sectionKey = section === 'front' ? 'front_problems' : 'back_problems'
      updateProblem(sectionKey, idx, updated)
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : 'Refresh failed')
    } finally {
      setRefreshing(prev => { const s = new Set(prev); s.delete(key); return s })
    }
  }

  const handleRecompile = async () => {
    if (!problems) return
    setRecompiling(true); setMsg('')
    try {
      const result = await recompileHomework(assignment.sessionKey, {
        problems,
        week_start: assignment.weekStart,
        grade: assignment.grade,
        class_type: assignment.classType,
        specific_date: assignment.specificDate,
      })
      onRecompiled(URL.createObjectURL(result.homeworkBlob), URL.createObjectURL(result.keyBlob))
      setMsg('✓ PDF updated')
    } catch (e: unknown) { setMsg(e instanceof Error ? e.message : 'Recompile failed') }
    finally { setRecompiling(false) }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 shrink-0">
        <h2 className="text-sm font-semibold text-slate-700">✏️ Edit Problems</h2>
        <div className="flex items-center gap-3">
          {msg && <span className={`text-xs font-medium ${msg.startsWith('✓') ? 'text-green-600' : 'text-red-500'}`}>{msg}</span>}
          <button onClick={handleRecompile} disabled={recompiling || !problems}
            className="px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700 transition disabled:opacity-40">
            {recompiling ? 'Rebuilding…' : 'Recompile PDF'}
          </button>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg leading-none">×</button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
        {loadError && <p className="text-sm text-red-500">{loadError}</p>}
        {!problems && !loadError && <p className="text-sm text-slate-400">Loading…</p>}

        {problems && (
          <>
            <section>
              <SectionLabel>Spiral Review</SectionLabel>
              <div className="space-y-2">
                {problems.front_problems.map((p, i) => (
                  <ProblemCard key={i} number={i + 1} problem={p} section="front" grade={assignment.grade}
                    onUpdate={u => updateProblem('front_problems', i, u)}
                    onRefresh={() => handleRefresh('front', i)}
                    isRefreshing={refreshing.has(`front_${i}`)}/>
                ))}
              </div>
            </section>
            <section>
              <SectionLabel>Lesson Practice{problems.lesson_title ? ` · ${problems.lesson_title}` : ''}</SectionLabel>
              <div className="space-y-2">
                {problems.back_problems.map((p, i) => (
                  <ProblemCard key={i} number={problems.front_problems.length + i + 1} problem={p} section="back" grade={assignment.grade}
                    onUpdate={u => updateProblem('back_problems', i, u)}
                    onRefresh={() => handleRefresh('back', i)}
                    isRefreshing={refreshing.has(`back_${i}`)}/>
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Bank Review Panel ────────────────────────────────────────────────────────
// !! HIGH IMPORTANCE — DO NOT REMOVE !!

const DOMAINS: { value: Domain; label: string }[] = [
  { value: 'arithmetic',            label: 'Arithmetic' },
  { value: 'expressions_equations', label: 'Expressions & Eq.' },
  { value: 'geometry',              label: 'Geometry' },
  { value: 'stats_probability',     label: 'Stats & Prob.' },
  { value: 'other',                 label: 'Other' },
]

function ReviewBank() {
  const [stats,         setStats]         = useState<BankStats | null>(null)
  const [problems,      setProblems]      = useState<BankProblem[]>([])
  const [loading,       setLoading]       = useState(false)
  const [index,         setIndex]         = useState(0)
  const [actionMsg,     setActionMsg]     = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [hpFilter,      setHpFilter]      = useState(false)
  const [selectedDomain,  setSelectedDomain]  = useState<Domain | ''>('')
  const [selectedQuarter, setSelectedQuarter] = useState<number | ''>('')
  const [notes, setNotes] = useState('')
  const mathJaxRef = useRef<HTMLDivElement>(null)

  const loadQueue = useCallback(async () => {
    setLoading(true)
    try {
      const [qRes, sRes] = await Promise.all([
        fetchReviewQueue({ inbox_only: true, limit: 200 }),
        fetchBankStats(6),
      ])
      setProblems(qRes.problems); setStats(sRes); setIndex(0)
    } catch { setActionMsg('Failed to load queue') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { loadQueue() }, [loadQueue])

  useEffect(() => {
    const mj = (window as any).MathJax
    if (mj?.typesetPromise && mathJaxRef.current) mj.typesetPromise([mathJaxRef.current]).catch(() => {})
  }, [index, problems])

  useEffect(() => {
    const p = problems[index]
    if (p) { setSelectedDomain(p.domain ?? ''); setSelectedQuarter(p.suggested_quarter ?? ''); setNotes(p.notes ?? '') }
    setConfirmDelete(false); setActionMsg('')
  }, [index, problems])

  const filtered = hpFilter ? problems.filter(p => p.high_priority) : problems
  const current  = filtered[index]

  const advance = () => {
    if (index < filtered.length - 1) setIndex(i => i + 1)
    else loadQueue()
  }

  const handleApprove = async () => {
    if (!current || !selectedDomain || !selectedQuarter) { setActionMsg('Select a domain and quarter first.'); return }
    try {
      await approveProblem(current.id, selectedDomain as Domain, Number(selectedQuarter), notes)
      setActionMsg('✓ Approved'); advance()
    } catch (e: unknown) { setActionMsg(e instanceof Error ? e.message : 'Failed') }
  }

  const handleFlag = async () => {
    if (!current) return
    try {
      await flagProblem(current.id, notes)
      setActionMsg('⚑ Flagged'); advance()
    } catch (e: unknown) { setActionMsg(e instanceof Error ? e.message : 'Failed') }
  }

  const handleDelete = async () => {
    if (!current) return
    if (!confirmDelete) { setConfirmDelete(true); return }
    try {
      await deleteProblem(current.id)
      setActionMsg('Deleted'); advance()
    } catch (e: unknown) { setActionMsg(e instanceof Error ? e.message : 'Failed') }
  }

  return (
    <div className="space-y-4">
      {/* Stats bar */}
      {stats && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
          <div className="flex flex-wrap gap-3 text-xs text-slate-600">
            <span className="font-semibold">Inbox: <span className="text-blue-600">{stats.inbox.total}</span></span>
            {DOMAINS.map(({ value, label }) => (
              <span key={value}>{label}: <span className="font-medium">{stats.domains[value]?.approved ?? 0}</span></span>
            ))}
          </div>
        </div>
      )}

      {/* Filter bar */}
      <div className="flex items-center gap-3">
        <button onClick={() => { setHpFilter(f => !f); setIndex(0) }}
          className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition ${
            hpFilter ? 'bg-purple-600 border-purple-600 text-white' : 'border-slate-300 text-slate-600 hover:border-purple-400'}`}>
          ⭐ HP only
        </button>
        <span className="text-xs text-slate-400">
          {loading ? 'Loading…' : `${filtered.length} problems in queue`}
        </span>
        {index > 0 && (
          <button onClick={() => setIndex(i => Math.max(0, i - 1))}
            className="ml-auto text-xs text-slate-500 hover:text-slate-700">← Back</button>
        )}
      </div>

      {/* Problem card */}
      {current ? (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          {/* Card header */}
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-500">{index + 1} / {filtered.length}</span>
            {current.high_priority && <Badge color="purple">⭐ High Priority</Badge>}
            {current.honors && <Badge color="green">Honors</Badge>}
            {current.source && <Badge color="slate">{current.source}</Badge>}
            {current.suggested_quarter && <Badge color="amber">Suggested Q{current.suggested_quarter}</Badge>}
          </div>

          {current.topic && <div className="px-4 pt-3 text-xs text-slate-500 italic">{current.topic}</div>}

          {/* LaTeX preview */}
          <div ref={mathJaxRef} className="px-4 py-4">
            <div className="text-sm text-slate-700 leading-relaxed"
              dangerouslySetInnerHTML={{ __html: current.latex }}/>
            {current.answer_latex && (
              <div className="mt-3 pt-3 border-t border-slate-100">
                <span className="text-xs font-medium text-slate-400 mr-2">Answer:</span>
                <span className="text-sm text-slate-600" dangerouslySetInnerHTML={{ __html: current.answer_latex }}/>
              </div>
            )}
          </div>

          {/* Controls */}
          <div className="px-4 pb-4 space-y-3 border-t border-slate-100 pt-3">
            <div>
              <SectionLabel>Domain</SectionLabel>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {DOMAINS.map(({ value, label }) => (
                  <button key={value} onClick={() => setSelectedDomain(value)}
                    className={['py-1.5 px-2 rounded-lg border text-xs font-medium transition text-left',
                      selectedDomain === value
                        ? 'bg-blue-600 border-blue-600 text-white'
                        : 'bg-white border-slate-300 text-slate-600 hover:border-blue-400',
                    ].join(' ')}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <SectionLabel>Quarter{current.suggested_quarter ? ` (suggested Q${current.suggested_quarter})` : ''}</SectionLabel>
              <div className="grid grid-cols-4 gap-2">
                {[1, 2, 3, 4].map(q => (
                  <button key={q} onClick={() => setSelectedQuarter(q)}
                    className={['py-1.5 rounded-lg border text-xs font-medium transition',
                      selectedQuarter === q
                        ? 'bg-blue-600 border-blue-600 text-white'
                        : 'bg-white border-slate-300 text-slate-600 hover:border-blue-400',
                    ].join(' ')}>
                    Q{q}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <SectionLabel>Notes (optional)</SectionLabel>
              <input value={notes} onChange={e => setNotes(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-400"
                placeholder="Optional notes…"/>
            </div>

            {actionMsg && (
              <p className={`text-xs font-medium ${actionMsg.startsWith('✓') ? 'text-green-600' : actionMsg.startsWith('⚑') ? 'text-amber-600' : 'text-red-500'}`}>
                {actionMsg}
              </p>
            )}
            <div className="flex gap-2">
              <button onClick={handleApprove} disabled={!selectedDomain || !selectedQuarter}
                className="flex-1 py-2 bg-green-600 text-white text-xs font-semibold rounded-lg hover:bg-green-700 transition disabled:opacity-40 disabled:cursor-not-allowed">
                ✓ Approve
              </button>
              <button onClick={handleFlag}
                className="px-3 py-2 bg-amber-50 text-amber-700 border border-amber-200 text-xs font-semibold rounded-lg hover:bg-amber-100 transition">
                ⚑ Flag
              </button>
              <button onClick={handleDelete}
                className={`px-3 py-2 text-xs font-semibold rounded-lg border transition ${
                  confirmDelete
                    ? 'bg-red-600 text-white border-red-600'
                    : 'bg-white text-red-500 border-red-200 hover:bg-red-50'}`}>
                {confirmDelete ? 'Confirm?' : '✕'}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-10 text-center text-slate-400">
          <p className="text-sm font-medium">{loading ? 'Loading…' : 'Inbox empty'}</p>
          <p className="text-xs mt-1">{loading ? '' : 'All caught up!'}</p>
        </div>
      )}
    </div>
  )
}

// ─── Generate Panel ───────────────────────────────────────────────────────────

function GeneratePanel() {
  const [online,        setOnline]        = useState<boolean | null>(null)
  const [week,          setWeek]          = useState<Date>(() => getMonday(new Date()))
  const [specificDate,  setSpecificDate]  = useState<string | null>(null)
  const [grade,         setGrade]         = useState<Grade>('6')
  const [classType,     setClassType]     = useState<ClassType>('grade_level')
  const [nBack,         setNBack]         = useState<number>(10)
  const [status,        setStatus]        = useState<Status>('idle')
  const [errorMsg,      setErrorMsg]      = useState('')
  const [history,       setHistory]       = useState<Assignment[]>([])
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null)
  const [editorItem,    setEditorItem]    = useState<Assignment | null>(null)

  useEffect(() => { checkHealth().then(setOnline) }, [])

  const handleWeekChange = useCallback((d: Date) => { setWeek(d); setSpecificDate(null) }, [])

  const handleGenerate = useCallback(async () => {
    setStatus('loading'); setErrorMsg(''); setEditorItem(null)
    const req: GenerateRequest = {
      week_start: formatISO(week), grade, class_type: classType,
      specific_date: specificDate ?? undefined,
      n_back: nBack,
    }
    try {
      const { homeworkBlob, keyBlob, sessionKey } = await generateHomework(req)
      const hwUrl  = URL.createObjectURL(homeworkBlob)
      const keyUrl = URL.createObjectURL(keyBlob)
      setPdfPreviewUrl(hwUrl)
      const dayLabel = specificDate
        ? new Date(specificDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
        : formatWeekRange(week)
      const label = `${dayLabel} · Grade ${grade} · ${classType === 'honors' ? 'Honors' : 'Grade Level'}`
      setHistory(prev => [{ weekStart: formatISO(week), specificDate: specificDate ?? undefined, grade, classType, label, pdfUrl: hwUrl, keyUrl, sessionKey }, ...prev])
      setStatus('done')
    } catch (e: unknown) { setErrorMsg(e instanceof Error ? e.message : 'Unknown error'); setStatus('error') }
  }, [week, specificDate, grade, classType, nBack])

  const handleRecompiled = useCallback((key: string, newPdf: string, newKey: string) => {
    setPdfPreviewUrl(newPdf)
    setHistory(prev => prev.map(a => a.sessionKey === key ? { ...a, pdfUrl: newPdf, keyUrl: newKey } : a))
    setEditorItem(prev => prev?.sessionKey === key ? { ...prev, pdfUrl: newPdf, keyUrl: newKey } : prev)
  }, [])

  const handleEditClick = useCallback((item: Assignment) => {
    setEditorItem(prev => prev?.sessionKey === item.sessionKey ? null : item)
  }, [])

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_520px] gap-8 items-start">
      {/* Left: form + history */}
      <div className="space-y-6">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-6">
          <h2 className="text-base font-semibold text-slate-700">Generate Assignment</h2>

          <div><SectionLabel>Week</SectionLabel><WeekPicker value={week} onChange={handleWeekChange}/></div>

          {/* DAY PICKER — required, do not remove */}
          <div>
            <SectionLabel>Day</SectionLabel>
            <DayPicker week={week} value={specificDate} onChange={setSpecificDate}/>
            {!specificDate && <p className="text-xs text-amber-600 mt-1.5">Select a day to generate that day's assignment.</p>}
          </div>

          <div>
            <SectionLabel>Grade</SectionLabel>
            <div className="grid grid-cols-4 gap-2">
              {(['5', '6', '7', '8'] as Grade[]).map(g => (
                <button key={g} onClick={() => setGrade(g)} disabled={g !== '6'}
                  className={['py-2 rounded-lg border text-sm font-medium transition',
                    grade === g ? 'bg-blue-600 border-blue-600 text-white shadow-sm'
                                : 'bg-white border-slate-300 text-slate-600 hover:border-blue-400',
                    g !== '6' ? 'opacity-40 cursor-not-allowed' : '',
                  ].join(' ')}>
                  {g === '6' ? 'Grade 6' : `${g} · soon`}
                </button>
              ))}
            </div>
          </div>

          <div>
            <SectionLabel>Class Type</SectionLabel>
            <div className="grid grid-cols-2 gap-3">
              {[
                { val: 'grade_level' as ClassType, label: 'Grade Level', sub: '20 min · 10 problems' },
                { val: 'honors'      as ClassType, label: 'Honors',      sub: '30 min · 8 problems' },
              ].map(({ val, label, sub }) => (
                <button key={val} onClick={() => setClassType(val)}
                  className={['text-left p-3 rounded-xl border-2 transition',
                    classType === val
                      ? val === 'honors' ? 'border-green-600 bg-green-50' : 'border-blue-500 bg-blue-50'
                      : 'border-slate-200 bg-white hover:border-slate-300',
                  ].join(' ')}>
                  <p className={`text-sm font-semibold ${classType === val && val === 'honors' ? 'text-green-700' : classType === val ? 'text-blue-700' : 'text-slate-700'}`}>
                    {label}
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">{sub}</p>
                </button>
              ))}
            </div>
          </div>

          <div>
            <SectionLabel>Lesson Practice Problems</SectionLabel>
            <div className="flex items-center gap-3">
              <button onClick={() => setNBack(n => Math.max(6, n - 1))}
                disabled={nBack <= 6}
                className="w-8 h-8 rounded-lg border border-slate-300 text-slate-600 text-base font-bold hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition">
                −
              </button>
              <span className="w-6 text-center text-sm font-semibold text-slate-700">{nBack}</span>
              <button onClick={() => setNBack(n => Math.min(20, n + 1))}
                disabled={nBack >= 20}
                className="w-8 h-8 rounded-lg border border-slate-300 text-slate-600 text-base font-bold hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition">
                +
              </button>
              <span className="text-xs text-slate-400">problems on back page (6–20)</span>
            </div>
          </div>

          {/* Summary */}
          <div className="bg-slate-50 rounded-xl p-3 text-sm text-slate-600">
            <span className="font-medium">Generating: </span>
            Grade {grade} · {classType === 'honors' ? 'Honors' : 'Grade Level'} ·{' '}
            {specificDate
              ? new Date(specificDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
              : formatWeekRange(week)}
          </div>

          {status === 'error' && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">
              <span className="font-semibold">Error: </span>{errorMsg}
            </div>
          )}

          <button onClick={handleGenerate}
            disabled={status === 'loading' || !online || !specificDate}
            className={['w-full py-3 rounded-xl text-sm font-semibold transition shadow-sm',
              status === 'loading'
                ? 'bg-blue-400 text-white cursor-wait'
                : !online || !specificDate
                  ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                  : 'bg-blue-600 text-white hover:bg-blue-700 active:scale-[0.99]',
            ].join(' ')}>
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
                <HistoryItem
                  key={item.sessionKey}
                  item={item}
                  isEditing={editorItem?.sessionKey === item.sessionKey}
                  onEdit={() => handleEditClick(item)}
                  onRemove={() => setHistory(prev => prev.filter((_, j) => j !== i))}/>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Right: preview or editor */}
      {/* HEIGHT: height: 92vh gives ProblemEditor a fixed container so flex-1/overflow-y-auto works */}
      <div className="lg:sticky lg:top-6">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col" style={{ height: '92vh' }}>
          {editorItem ? (
            <ProblemEditor assignment={editorItem} onClose={() => setEditorItem(null)}
              onRecompiled={(p, k) => handleRecompiled(editorItem.sessionKey, p, k)}/>
          ) : (
            <>
              <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between shrink-0">
                <h2 className="text-sm font-semibold text-slate-700">Preview</h2>
                <StatusDot online={online}/>
              </div>
              {pdfPreviewUrl ? (
                <iframe src={pdfPreviewUrl} className="w-full flex-1" style={{ height: '82vh' }} title="Preview"/>
              ) : (
                <div className="flex flex-col items-center justify-center text-center py-16 px-8 text-slate-400">
                  <div className="text-5xl mb-4">📄</div>
                  <p className="text-sm font-medium text-slate-500">No preview yet</p>
                  <p className="text-xs mt-1">
                    {status === 'loading' ? 'Generating — about 30 seconds…' : 'Select a day and click Generate'}
                  </p>
                  {status === 'loading' && (
                    <div className="mt-4 w-32 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-400 rounded-full animate-pulse" style={{ width: '60%' }}/>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Root App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [mode, setMode] = useState<AppMode>('generate')
  const [online, setOnline] = useState<boolean | null>(null)

  useEffect(() => { checkHealth().then(setOnline) }, [])

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-blue-700 text-white shadow-md">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Math Homework Generator</h1>
            <p className="text-blue-100 text-sm mt-0.5">Grades 5–8 · Spiral Review + Lesson Practice</p>
          </div>
          <div className="flex items-center gap-4">
            <StatusDot online={online}/>
            {/* Mode switcher — DO NOT REMOVE */}
            <div className="flex rounded-lg overflow-hidden border border-blue-500">
              {([
                { id: 'generate' as AppMode, label: '📄 Generate' },
                { id: 'bank'     as AppMode, label: '🗂 Bank Review' },
              ]).map(({ id, label }) => (
                <button key={id} onClick={() => setMode(id)}
                  className={`px-3 py-1.5 text-xs font-semibold transition ${
                    mode === id ? 'bg-white text-blue-700' : 'text-blue-100 hover:bg-blue-600'}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-5xl mx-auto w-full px-6 py-8">
        {mode === 'generate' ? <GeneratePanel/> : <ReviewBank/>}
      </main>

      <footer className="border-t border-slate-200 py-4 text-center text-xs text-slate-400">
        Math Homework Generator · Grades 5–8
      </footer>
    </div>
  )
}
