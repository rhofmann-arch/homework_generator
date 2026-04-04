import { useState, useEffect, useCallback, useRef } from 'react'
import {
  generateHomework, fetchHomeworkProblems, recompileHomework, saveProblemToBank,
  checkHealth,
  type GenerateRequest, type HomeworkProblems, type HomeworkProblem,
} from './api'
import {
  getMonday, formatWeekRange, formatISO,
  nextWeek, prevWeek, schoolYearWeeks,
} from './dates'

// ─── Types ────────────────────────────────────────────────────────────────────

type Grade = '5' | '6' | '7' | '8'
type ClassType = 'grade_level' | 'honors'
type Status = 'idle' | 'loading' | 'done' | 'error'

interface Assignment {
  weekStart:   string
  specificDate?: string
  grade:       Grade
  classType:   ClassType
  label:       string
  pdfUrl:      string
  keyUrl:      string
  sessionKey:  string
}

// ─── Tiny shared components ───────────────────────────────────────────────────

function Badge({ children, color = 'blue' }: { children: React.ReactNode; color?: 'blue' | 'green' | 'slate' | 'amber' }) {
  const cls = {
    blue:  'bg-brand-100 text-brand-700',
    green: 'bg-honors-50 text-honors-700',
    slate: 'bg-slate-100 text-slate-600',
    amber: 'bg-amber-50 text-amber-700',
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
      <button
        onClick={() => onChange(prevWeek(value))}
        className="p-1.5 rounded hover:bg-slate-200 text-slate-500 hover:text-slate-700 transition"
      >◀</button>
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
      <button
        onClick={() => onChange(nextWeek(value))}
        className="p-1.5 rounded hover:bg-slate-200 text-slate-500 hover:text-slate-700 transition"
      >▶</button>
    </div>
  )
}

// ─── Day Picker ───────────────────────────────────────────────────────────────
// !! HIGH IMPORTANCE — DO NOT REMOVE !!
// Each day Mon–Thu gets its own separate homework PDF.
// specificDate (YYYY-MM-DD) is sent to the backend; the pacing guide maps it
// to that day's lesson. This must always be present — do not collapse back to
// week-only generation.

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu']

function DayPicker({
  week,
  value,
  onChange,
}: {
  week: Date
  value: string | null   // YYYY-MM-DD or null
  onChange: (iso: string | null) => void
}) {
  // Build Mon–Thu dates for this week
  const days = Array.from({ length: 4 }, (_, i) => {
    const d = new Date(week)
    d.setDate(week.getDate() + i)
    return d
  })

  return (
    <div className="grid grid-cols-4 gap-2">
      {days.map((d, i) => {
        const iso = formatISO(d)
        const selected = value === iso
        return (
          <button
            key={iso}
            onClick={() => onChange(selected ? null : iso)}
            className={[
              'py-1.5 rounded-lg border text-sm font-medium transition',
              selected
                ? 'bg-brand-600 border-brand-600 text-white shadow-sm'
                : 'bg-white border-slate-300 text-slate-600 hover:border-brand-400',
            ].join(' ')}
          >
            <span className="block text-xs">{DAY_LABELS[i]}</span>
            <span className="block text-xs opacity-70">{d.getDate()}</span>
          </button>
        )
      })}
    </div>
  )
}

// ─── History Item ─────────────────────────────────────────────────────────────

function HistoryItem({
  item,
  isEditing,
  onEdit,
  onRemove,
}: {
  item: Assignment
  isEditing: boolean
  onEdit: () => void
  onRemove: () => void
}) {
  return (
    <div className={`flex items-center justify-between py-2.5 px-3 border rounded-lg transition ${
      isEditing ? 'bg-brand-50 border-brand-300' : 'bg-white border-slate-200'
    }`}>
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
        <a href={item.pdfUrl} download className="text-xs font-medium text-brand-600 hover:text-brand-800">HW</a>
        <a href={item.keyUrl} download className="text-xs font-medium text-slate-500 hover:text-slate-700">Key</a>
        <button
          onClick={onEdit}
          className={`text-xs font-medium px-2 py-1 rounded transition ${
            isEditing
              ? 'bg-brand-600 text-white'
              : 'bg-slate-100 text-slate-600 hover:bg-brand-100 hover:text-brand-700'
          }`}
          title="Edit problems"
        >
          ✏️ Edit
        </button>
        <button onClick={onRemove} className="text-slate-300 hover:text-slate-500 text-lg leading-none">×</button>
      </div>
    </div>
  )
}

// ─── Problem Card (inside editor) ─────────────────────────────────────────────

interface ProblemCardProps {
  number: number
  problem: HomeworkProblem
  section: 'front' | 'back' | 'challenge'
  grade: Grade
  onUpdate: (updated: HomeworkProblem) => void
}

function ProblemCard({ number, problem, section, grade, onUpdate }: ProblemCardProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState(problem.latex)
  const [savedToBank, setSavedToBank] = useState(false)
  const [bankMsg, setBankMsg] = useState('')
  const previewRef = useRef<HTMLDivElement>(null)

  // Typeset MathJax when rendered preview is visible
  useEffect(() => {
    if (!editing && previewRef.current && typeof window !== 'undefined') {
      const mj = (window as any).MathJax
      if (mj?.typesetPromise) {
        mj.typesetPromise([previewRef.current]).catch(() => {})
      }
    }
  }, [editing, problem.latex])

  const handleSave = () => {
    onUpdate({ ...problem, latex: draft })
    setEditing(false)
  }

  const handleCancel = () => {
    setDraft(problem.latex)
    setEditing(false)
  }

  const handleSaveToBank = async () => {
    setBankMsg('Saving…')
    try {
      await saveProblemToBank({
        latex:       problem.latex,
        answer_latex: problem.answer_latex ?? '',
        section,
        grade: Number(grade),
      })
      setSavedToBank(true)
      setBankMsg('✓ Saved to inbox')
    } catch (e: unknown) {
      setBankMsg(e instanceof Error ? e.message : 'Save failed')
    }
  }

  return (
    <div className="border border-slate-200 rounded-xl bg-white overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-slate-50 border-b border-slate-100">
        <span className="text-xs font-semibold text-slate-500">#{number}</span>
        <div className="flex gap-2">
          {!editing && (
            <button
              onClick={() => { setDraft(problem.latex); setEditing(true) }}
              className="text-xs text-brand-600 hover:text-brand-800 font-medium"
            >
              Edit LaTeX
            </button>
          )}
          <button
            onClick={handleSaveToBank}
            disabled={savedToBank}
            className={`text-xs font-medium transition ${
              savedToBank
                ? 'text-green-600 cursor-default'
                : 'text-slate-400 hover:text-slate-600'
            }`}
            title="Save to problem bank inbox"
          >
            {bankMsg || '+ Bank'}
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="px-3 py-3">
        {editing ? (
          <div className="space-y-2">
            <textarea
              value={draft}
              onChange={e => setDraft(e.target.value)}
              rows={4}
              className="w-full text-xs font-mono border border-slate-300 rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-brand-400 resize-y"
              spellCheck={false}
            />
            <div className="flex gap-2">
              <button
                onClick={handleSave}
                className="px-3 py-1 bg-brand-600 text-white text-xs font-medium rounded-lg hover:bg-brand-700 transition"
              >
                Save
              </button>
              <button
                onClick={handleCancel}
                className="px-3 py-1 bg-slate-100 text-slate-600 text-xs font-medium rounded-lg hover:bg-slate-200 transition"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div ref={previewRef} className="text-sm text-slate-700 leading-relaxed min-h-[1.5rem]"
            dangerouslySetInnerHTML={{ __html: problem.latex }}
          />
        )}
      </div>
    </div>
  )
}

// ─── Problem Editor Panel ─────────────────────────────────────────────────────

interface ProblemEditorProps {
  assignment: Assignment
  onClose: () => void
  onRecompiled: (newPdfUrl: string, newKeyUrl: string) => void
}

function ProblemEditor({ assignment, onClose, onRecompiled }: ProblemEditorProps) {
  const [problems, setProblems] = useState<HomeworkProblems | null>(null)
  const [loadError, setLoadError] = useState('')
  const [recompiling, setRecompiling] = useState(false)
  const [recompileMsg, setRecompileMsg] = useState('')

  // Load problems on mount
  useEffect(() => {
    fetchHomeworkProblems(assignment.sessionKey)
      .then(setProblems)
      .catch(e => setLoadError(e instanceof Error ? e.message : 'Failed to load problems'))
  }, [assignment.sessionKey])

  const updateProblem = (
    section: 'front_problems' | 'back_problems' | 'challenge_problems',
    idx: number,
    updated: HomeworkProblem
  ) => {
    setProblems(prev => {
      if (!prev) return prev
      const arr = [...prev[section]]
      arr[idx] = updated
      return { ...prev, [section]: arr }
    })
    setRecompileMsg('')  // clear stale success message
  }

  const handleRecompile = async () => {
    if (!problems) return
    setRecompiling(true)
    setRecompileMsg('')
    try {
      const result = await recompileHomework(assignment.sessionKey, {
        problems,
        week_start:    assignment.weekStart,
        grade:         assignment.grade,
        class_type:    assignment.classType,
        specific_date: assignment.specificDate,
      })
      const newPdfUrl = URL.createObjectURL(result.homeworkBlob)
      const newKeyUrl = URL.createObjectURL(result.keyBlob)
      onRecompiled(newPdfUrl, newKeyUrl)
      setRecompileMsg('✓ PDF updated')
    } catch (e: unknown) {
      setRecompileMsg(e instanceof Error ? e.message : 'Recompile failed')
    } finally {
      setRecompiling(false)
    }
  }

  // ── Render ──

  if (loadError) {
    return (
      <div className="flex flex-col h-full">
        <EditorHeader assignment={assignment} onClose={onClose} onRecompile={handleRecompile} recompiling={recompiling} recompileMsg={recompileMsg} />
        <div className="flex-1 flex items-center justify-center p-6 text-center">
          <div>
            <p className="text-sm font-medium text-red-600 mb-1">Could not load problems</p>
            <p className="text-xs text-slate-500">{loadError}</p>
          </div>
        </div>
      </div>
    )
  }

  if (!problems) {
    return (
      <div className="flex flex-col h-full">
        <EditorHeader assignment={assignment} onClose={onClose} onRecompile={handleRecompile} recompiling={false} recompileMsg="" />
        <div className="flex-1 flex items-center justify-center">
          <span className="text-xs text-slate-400 animate-pulse">Loading problems…</span>
        </div>
      </div>
    )
  }

  const hasChallenges = problems.challenge_problems.length > 0

  return (
    <div className="flex flex-col h-full">
      <EditorHeader
        assignment={assignment}
        onClose={onClose}
        onRecompile={handleRecompile}
        recompiling={recompiling}
        recompileMsg={recompileMsg}
      />

      {/* Scrollable problem list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5">

        {/* Spiral Review */}
        <section>
          <SectionLabel>Spiral Review — Front</SectionLabel>
          {problems.spiral_topics && (
            <p className="text-xs text-slate-400 italic mb-2">{problems.spiral_topics}</p>
          )}
          <div className="space-y-2">
            {problems.front_problems.map((p, i) => (
              <ProblemCard
                key={i}
                number={i + 1}
                problem={p}
                section="front"
                grade={assignment.grade}
                onUpdate={updated => updateProblem('front_problems', i, updated)}
              />
            ))}
          </div>
        </section>

        {/* Lesson Practice */}
        <section>
          <SectionLabel>Lesson Practice — Back</SectionLabel>
          {problems.lesson_title && (
            <p className="text-xs text-slate-400 italic mb-2">{problems.lesson_title}</p>
          )}
          <div className="space-y-2">
            {problems.back_problems.map((p, i) => (
              <ProblemCard
                key={i}
                number={problems.front_problems.length + i + 1}
                problem={p}
                section="back"
                grade={assignment.grade}
                onUpdate={updated => updateProblem('back_problems', i, updated)}
              />
            ))}
          </div>
        </section>

        {/* Challenge (honors only) */}
        {hasChallenges && (
          <section>
            <SectionLabel>Challenge</SectionLabel>
            <div className="space-y-2">
              {problems.challenge_problems.map((p, i) => (
                <ProblemCard
                  key={i}
                  number={problems.front_problems.length + problems.back_problems.length + i + 1}
                  problem={p}
                  section="challenge"
                  grade={assignment.grade}
                  onUpdate={updated => updateProblem('challenge_problems', i, updated)}
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

// Small header sub-component to avoid repetition
function EditorHeader({
  assignment, onClose, onRecompile, recompiling, recompileMsg,
}: {
  assignment: Assignment
  onClose: () => void
  onRecompile: () => void
  recompiling: boolean
  recompileMsg: string
}) {
  return (
    <div className="px-4 py-3 border-b border-slate-100 bg-white flex items-center gap-3">
      <button
        onClick={onClose}
        className="text-xs text-slate-400 hover:text-slate-600 transition shrink-0"
        title="Back to PDF preview"
      >
        ← PDF
      </button>
      <span className="text-sm font-semibold text-slate-700 flex-1 truncate">
        ✏️ Edit Problems
      </span>
      {recompileMsg && (
        <span className={`text-xs shrink-0 ${recompileMsg.startsWith('✓') ? 'text-green-600' : 'text-red-500'}`}>
          {recompileMsg}
        </span>
      )}
      <button
        onClick={onRecompile}
        disabled={recompiling}
        className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
          recompiling
            ? 'bg-brand-300 text-white cursor-wait'
            : 'bg-brand-600 text-white hover:bg-brand-700'
        }`}
      >
        {recompiling ? 'Building…' : 'Recompile PDF'}
      </button>
    </div>
  )
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [online,        setOnline]        = useState<boolean | null>(null)
  const [week,          setWeek]          = useState<Date>(() => getMonday(new Date()))
  const [specificDate,  setSpecificDate]  = useState<string | null>(null)
  const [grade,         setGrade]         = useState<Grade>('6')
  const [classType,     setClassType]     = useState<ClassType>('grade_level')
  const [status,        setStatus]        = useState<Status>('idle')
  const [errorMsg,      setErrorMsg]      = useState('')
  const [history,       setHistory]       = useState<Assignment[]>([])
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null)
  const [editorItem,    setEditorItem]    = useState<Assignment | null>(null)

  useEffect(() => { checkHealth().then(setOnline) }, [])

  // Clear day selection when week changes
  const handleWeekChange = useCallback((d: Date) => {
    setWeek(d)
    setSpecificDate(null)
  }, [])

  const handleGenerate = useCallback(async () => {
    setStatus('loading')
    setErrorMsg('')
    setEditorItem(null)

    const req: GenerateRequest = {
      week_start:    formatISO(week),
      grade,
      class_type:    classType,
      specific_date: specificDate ?? undefined,
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
      const item: Assignment = {
        weekStart:    formatISO(week),
        specificDate: specificDate ?? undefined,
        grade,
        classType,
        label,
        pdfUrl:  hwUrl,
        keyUrl,
        sessionKey,
      }
      setHistory(prev => [item, ...prev])
      setStatus('done')
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : 'Unknown error')
      setStatus('error')
    }
  }, [week, specificDate, grade, classType])

  // When recompile completes: update urls in history + preview, keep editor open
  const handleRecompiled = useCallback((itemKey: string, newPdfUrl: string, newKeyUrl: string) => {
    setPdfPreviewUrl(newPdfUrl)
    setHistory(prev =>
      prev.map(a => a.sessionKey === itemKey ? { ...a, pdfUrl: newPdfUrl, keyUrl: newKeyUrl } : a)
    )
    setEditorItem(prev => prev?.sessionKey === itemKey ? { ...prev, pdfUrl: newPdfUrl, keyUrl: newKeyUrl } : prev)
  }, [])

  const handleEditClick = useCallback((item: Assignment) => {
    setEditorItem(prev => prev?.sessionKey === item.sessionKey ? null : item)
  }, [])

  const rightPanelTitle = editorItem ? 'Editor' : 'Preview'

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

      {/* Body */}
      <main className="flex-1 max-w-5xl mx-auto w-full px-6 py-8 grid grid-cols-1 lg:grid-cols-[1fr_420px] gap-8 items-start">

        {/* Left: Form + History */}
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-6">
            <h2 className="text-base font-semibold text-slate-700">Generate Assignment</h2>

            {/* Week picker */}
            <div>
              <SectionLabel>Week</SectionLabel>
              <WeekPicker value={week} onChange={handleWeekChange} />
            </div>

            {/* Day picker — REQUIRED: generates one homework per day, not per week */}
            <div>
              <SectionLabel>Day</SectionLabel>
              <DayPicker week={week} value={specificDate} onChange={setSpecificDate} />
              {!specificDate && (
                <p className="text-xs text-amber-600 mt-1.5">Select a day to generate that day's assignment.</p>
              )}
            </div>

            {/* Grade */}
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
                      grade === g
                        ? 'bg-brand-600 border-brand-600 text-white shadow-sm'
                        : 'bg-white border-slate-300 text-slate-600 hover:border-brand-400 hover:text-brand-600',
                      (g === '5' || g === '7' || g === '8') ? 'opacity-40 cursor-not-allowed' : '',
                    ].join(' ')}
                  >
                    {g === '5' || g === '7' || g === '8' ? `${g} · soon` : `Grade ${g}`}
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
                    <p className={`text-sm font-semibold ${classType === val && val === 'honors' ? 'text-honors-700' : classType === val ? 'text-brand-700' : 'text-slate-700'}`}>
                      {label}
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">{sub}</p>
                  </button>
                ))}
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

            {/* Error */}
            {status === 'error' && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">
                <span className="font-semibold">Error: </span>{errorMsg}
              </div>
            )}

            {/* Generate button */}
            <button
              onClick={handleGenerate}
              disabled={status === 'loading' || !online || !specificDate}
              className={[
                'w-full py-3 rounded-xl text-sm font-semibold transition shadow-sm',
                status === 'loading'
                  ? 'bg-brand-400 text-white cursor-wait'
                  : !online
                    ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                    : !specificDate
                      ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
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

          {/* History */}
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
                    onRemove={() => setHistory(prev => prev.filter((_, j) => j !== i))}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right: PDF Preview or Editor */}
        <div className="lg:sticky lg:top-6">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col" style={{ maxHeight: '85vh' }}>

            {editorItem ? (
              <ProblemEditor
                assignment={editorItem}
                onClose={() => setEditorItem(null)}
                onRecompiled={(newPdf, newKey) =>
                  handleRecompiled(editorItem.sessionKey, newPdf, newKey)
                }
              />
            ) : (
              <>
                <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between shrink-0">
                  <h2 className="text-sm font-semibold text-slate-700">Preview</h2>
                  {pdfPreviewUrl && (
                    <a
                      href={pdfPreviewUrl}
                      download
                      className="text-xs font-medium text-brand-600 hover:text-brand-800"
                    >
                      ↓ Download PDF
                    </a>
                  )}
                </div>

                {pdfPreviewUrl ? (
                  <iframe
                    src={pdfPreviewUrl}
                    className="w-full flex-1"
                    style={{ height: '680px' }}
                    title="Homework PDF preview"
                  />
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
                        <div className="h-full bg-brand-400 rounded-full animate-[pulse_1.2s_ease-in-out_infinite]" style={{ width: '60%' }} />
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 py-4 text-center text-xs text-slate-400">
        Math Homework Generator · Grades 5–8 ·{' '}
        <a href="https://github.com" className="hover:text-brand-500">GitHub</a>
      </footer>
    </div>
  )
}
