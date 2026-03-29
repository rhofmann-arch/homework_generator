import { useState, useEffect, useCallback } from 'react'
import {
  generateHomework, checkHealth, fetchWeeks,
  fetchReviewQueue, fetchBankStats, approveProblem, flagProblem, deleteProblem, editProblem,
  type GenerateRequest, type HWWeek, type HWDay, type BankProblem, type Domain,
} from './api'
import { formatWeekRange } from './dates'

type Grade = '5' | '6' | '7' | '8'
type ClassType = 'grade_level' | 'honors'
type DayStatus = 'idle' | 'loading' | 'done' | 'error'
type Tab = 'generator' | 'bank'

const DOMAINS = ['arithmetic', 'expressions_equations', 'geometry', 'stats_probability', 'other'] as const
const DOMAIN_LABELS: Record<string, string> = {
  arithmetic: 'Arithmetic',
  expressions_equations: 'Expressions & Equations',
  geometry: 'Geometry',
  stats_probability: 'Stats & Probability',
  other: 'Other',
}

function Badge({ children, color = 'slate' }: { children: React.ReactNode; color?: 'blue' | 'green' | 'slate' | 'amber' }) {
  const cls = { blue: 'bg-blue-100 text-blue-700', green: 'bg-green-100 text-green-700', slate: 'bg-slate-100 text-slate-600', amber: 'bg-amber-100 text-amber-700' }[color]
  return <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{children}</span>
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">{children}</p>
}

function StatusDot({ online }: { online: boolean | null }) {
  if (online === null) return null
  return (
    <span className="flex items-center gap-1.5 text-xs text-white/70">
      <span className={`w-2 h-2 rounded-full ${online ? 'bg-green-400' : 'bg-red-400'}`} />
      {online ? 'Backend connected' : 'Backend offline'}
    </span>
  )
}

// ─── Generator Tab ────────────────────────────────────────────────────────────
function GeneratorTab({ online }: { online: boolean | null }) {
  const [weeks, setWeeks]           = useState<HWWeek[]>([])
  const [weeksLoading, setWeeksLoading] = useState(true)
  const [selectedWeek, setSelectedWeek] = useState<HWWeek | null>(null)
  const [grade, setGrade]           = useState<Grade>('6')
  const [classType, setClassType]   = useState<ClassType>('grade_level')
  const [dayStatus, setDayStatus]   = useState<Record<string, DayStatus>>({})
  const [dayErrors, setDayErrors]   = useState<Record<string, string>>({})
  const [generated, setGenerated]   = useState<Array<HWDay & { pdfUrl: string }>>([])
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  useEffect(() => {
    setWeeksLoading(true)
    setSelectedWeek(null)
    fetchWeeks(grade)
      .then(ws => {
        setWeeks(ws)
        const today = new Date().toISOString().slice(0, 10)
        setSelectedWeek(ws.find(w => w.week_start >= today) ?? ws[ws.length - 1] ?? null)
      })
      .catch(() => setWeeks([]))
      .finally(() => setWeeksLoading(false))
  }, [grade])

  useEffect(() => {
    setDayStatus({})
    setDayErrors({})
    setGenerated([])
    setPreviewUrl(null)
  }, [selectedWeek, classType])

  const generateDay = useCallback(async (day: HWDay) => {
    if (!selectedWeek) return
    setDayStatus(s => ({ ...s, [day.date]: 'loading' }))
    setDayErrors(s => { const n = { ...s }; delete n[day.date]; return n })
    try {
      const blob = await generateHomework({
        week_start: selectedWeek.week_start, grade, class_type: classType, specific_date: day.date,
      })
      const url = URL.createObjectURL(blob)
      setGenerated(prev => [...prev.filter(g => g.date !== day.date), { ...day, pdfUrl: url }])
      setPreviewUrl(url)
      setDayStatus(s => ({ ...s, [day.date]: 'done' }))
    } catch (e: unknown) {
      setDayStatus(s => ({ ...s, [day.date]: 'error' }))
      setDayErrors(s => ({ ...s, [day.date]: e instanceof Error ? e.message : 'Unknown error' }))
    }
  }, [selectedWeek, grade, classType])

  const generateAllDays = useCallback(async () => {
    if (!selectedWeek) return
    for (const day of selectedWeek.days) await generateDay(day)
  }, [selectedWeek, generateDay])

  const anyLoading = Object.values(dayStatus).some(s => s === 'loading')

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_420px] gap-8 items-start">
      <div className="space-y-6">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-6">
          <h2 className="text-base font-semibold text-slate-700">Generate Assignment</h2>

          <div>
            <SectionLabel>Grade</SectionLabel>
            <div className="grid grid-cols-4 gap-2">
              {(['5','6','7','8'] as Grade[]).map(g => (
                <button key={g} onClick={() => setGrade(g)} disabled={g !== '6'}
                  className={['py-2 rounded-lg border text-sm font-medium transition',
                    grade === g ? 'bg-brand-600 border-brand-600 text-white' : 'bg-white border-slate-300 text-slate-600',
                    g !== '6' ? 'opacity-40 cursor-not-allowed' : 'hover:border-brand-400'].join(' ')}>
                  {g !== '6' ? `${g} · soon` : `Grade ${g}`}
                </button>
              ))}
            </div>
          </div>

          <div>
            <SectionLabel>Class Type</SectionLabel>
            <div className="grid grid-cols-2 gap-3">
              {([
                { val: 'grade_level' as ClassType, label: 'Grade Level', sub: '20 min · 10–12 problems' },
                { val: 'honors'      as ClassType, label: 'Honors',      sub: '30 min · challenge problems' },
              ]).map(({ val, label, sub }) => (
                <button key={val} onClick={() => setClassType(val)}
                  className={['text-left p-3 rounded-xl border-2 transition',
                    classType === val
                      ? val === 'honors' ? 'border-honors-600 bg-honors-50' : 'border-brand-500 bg-brand-50'
                      : 'border-slate-200 bg-white hover:border-slate-300'].join(' ')}>
                  <p className={`text-sm font-semibold ${classType === val ? val === 'honors' ? 'text-honors-700' : 'text-brand-700' : 'text-slate-700'}`}>{label}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{sub}</p>
                </button>
              ))}
            </div>
          </div>

          <div>
            <SectionLabel>Week</SectionLabel>
            {weeksLoading ? (
              <p className="text-sm text-slate-400">Loading pacing guide…</p>
            ) : weeks.length === 0 ? (
              <p className="text-sm text-red-500">Could not load weeks — is the backend running?</p>
            ) : (
              <select value={selectedWeek?.week_start ?? ''}
                onChange={e => setSelectedWeek(weeks.find(x => x.week_start === e.target.value) ?? null)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500">
                {weeks.map(w => (
                  <option key={w.week_start} value={w.week_start}>
                    {formatWeekRange(new Date(w.week_start + 'T12:00:00'))}
                  </option>
                ))}
              </select>
            )}
          </div>

          {selectedWeek && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <SectionLabel>Homework Days This Week</SectionLabel>
                <button onClick={generateAllDays} disabled={anyLoading || !online}
                  className="text-xs font-medium text-brand-600 hover:text-brand-800 disabled:opacity-40 disabled:cursor-not-allowed">
                  Generate all ↓
                </button>
              </div>
              <div className="space-y-2">
                {selectedWeek.days.map(day => {
                  const status = dayStatus[day.date] ?? 'idle'
                  const done = generated.find(g => g.date === day.date)
                  return (
                    <div key={day.date} className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 bg-slate-50">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-700">{day.dow} · {day.day_num}</p>
                        <p className="text-xs text-slate-400">{day.date}</p>
                        {dayErrors[day.date] && <p className="text-xs text-red-500 mt-0.5 truncate">{dayErrors[day.date]}</p>}
                      </div>
                      {done && <>
                        <button onClick={() => setPreviewUrl(done.pdfUrl)} className="text-xs text-brand-600 hover:text-brand-800 font-medium">Preview</button>
                        <a href={done.pdfUrl} download={`hw_grade${grade}_${day.date}.pdf`} className="text-xs text-slate-500 hover:text-slate-700 font-medium">↓ PDF</a>
                      </>}
                      <button onClick={() => generateDay(day)} disabled={status === 'loading' || !online}
                        className={['px-3 py-1.5 rounded-lg text-xs font-semibold transition shrink-0',
                          status === 'loading' ? 'bg-brand-400 text-white cursor-wait'
                            : status === 'done' ? 'bg-green-100 text-green-700 hover:bg-brand-100 hover:text-brand-700'
                            : status === 'error' ? 'bg-red-100 text-red-700'
                            : 'bg-brand-600 text-white hover:bg-brand-700',
                          !online && status !== 'loading' ? 'opacity-40 cursor-not-allowed' : ''].join(' ')}>
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

      <div className="lg:sticky lg:top-6">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700">Preview</h2>
            {previewUrl && <a href={previewUrl} download="homework.pdf" className="text-xs font-medium text-brand-600 hover:text-brand-800">↓ Download</a>}
          </div>
          {previewUrl ? (
            <iframe src={previewUrl} className="w-full" style={{ height: '680px' }} title="Homework PDF" />
          ) : (
            <div className="flex flex-col items-center justify-center text-center py-16 px-8 text-slate-400">
              <div className="text-5xl mb-4">📄</div>
              <p className="text-sm font-medium text-slate-500">No preview yet</p>
              <p className="text-xs mt-1">Select a week and generate a day</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Bank Review Tab ──────────────────────────────────────────────────────────
function BankReviewTab() {
  const [problems, setProblems]     = useState<BankProblem[]>([])
  const [index, setIndex]           = useState(0)
  const [total, setTotal]           = useState(0)
  const [loading, setLoading]       = useState(false)
  const [stats, setStats]           = useState<Record<string, any> | null>(null)
  const [selectedDomain, setSelectedDomain] = useState('')
  const [selectedQuarter, setSelectedQuarter] = useState('')
  const [notes, setNotes]           = useState('')
  const [editingLatex, setEditingLatex] = useState(false)
  const [latexDraft, setLatexDraft] = useState('')
  const [actionMsg, setActionMsg]   = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const loadQueue = useCallback(async () => {
    setLoading(true)
    setActionMsg('')
    try {
      const [qRes, sRes] = await Promise.all([
        fetchReviewQueue('_inbox' as Domain, 6, 0, 50),
        fetchBankStats(6),
      ])
      setProblems(qRes.problems)
      setTotal(qRes.total)
      setStats(sRes.domains ?? sRes)
      setIndex(0)
    } catch (e: any) {
      setActionMsg(`Error: ${e.message}`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadQueue() }, [loadQueue])

  const current = problems[index]

  useEffect(() => {
    if (!current) return
    setSelectedDomain(current.suggested_domain ?? current.domain ?? '')
    setSelectedQuarter(current.suggested_quarter ? String(current.suggested_quarter) : '')
    setNotes(current.notes ?? '')
    setLatexDraft(current.latex ?? '')
    setEditingLatex(false)
    setActionMsg('')
    setConfirmDelete(false)
  }, [index, current?.id])

  const handleApprove = async () => {
    if (!current || !selectedDomain || !selectedQuarter) {
      setActionMsg('Select domain and quarter before approving.')
      return
    }
    try {
      if (editingLatex && latexDraft !== current.latex) {
        await editProblem(current.id, latexDraft, current.grade)
      }
      await approveProblem({
        problem_id: current.id, domain: selectedDomain,
        quarter: Number(selectedQuarter), notes, grade: current.grade,
      })
      setProblems(prev => prev.filter((_, i) => i !== index))
      setTotal(t => t - 1)
      setActionMsg('✓ Approved')
    } catch (e: any) { setActionMsg(`Error: ${e.message}`) }
  }

  const handleFlag = async () => {
    if (!current) return
    try {
      await flagProblem(current.id, notes, current.grade)
      setProblems(prev => prev.filter((_, i) => i !== index))
      setTotal(t => t - 1)
      setActionMsg('🚩 Flagged')
    } catch (e: any) { setActionMsg(`Error: ${e.message}`) }
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
    } catch (e: any) { setActionMsg(`Error: ${e.message}`) }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-8 items-start">
      <div className="space-y-4">
        {/* Stats */}
        {stats && (
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-700">Bank Status — {total} pending review</h3>
              <button onClick={loadQueue} className="text-xs text-brand-600 hover:text-brand-800">↻ Refresh</button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {DOMAINS.filter(d => d !== 'other').map(d => {
                const s = stats[d]
                return (
                  <div key={d} className="text-center p-2 rounded-lg bg-slate-50">
                    <p className="text-xs text-slate-500 mb-1">{DOMAIN_LABELS[d]}</p>
                    <p className="text-lg font-bold text-green-600">{s?.approved ?? 0}</p>
                    <p className="text-xs text-slate-400">approved</p>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Problem card */}
        {loading ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-slate-400">Loading…</div>
        ) : !current ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center">
            <p className="text-slate-500 font-medium mb-1">Inbox empty 🎉</p>
            <p className="text-xs text-slate-400">All problems reviewed.</p>
            <button onClick={loadQueue} className="mt-4 px-4 py-2 rounded-lg bg-brand-600 text-white text-sm">Refresh</button>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
            {/* Progress + nav */}
            <div className="flex items-center justify-between">
              <p className="text-xs text-slate-400">{index + 1} of {total} pending</p>
              <div className="flex gap-3">
                <button onClick={() => setIndex(i => Math.max(0, i-1))} disabled={index === 0}
                  className="text-xs text-slate-500 hover:text-slate-700 disabled:opacity-30">← Prev</button>
                <button onClick={() => setIndex(i => Math.min(problems.length-1, i+1))} disabled={index >= problems.length-1}
                  className="text-xs text-slate-500 hover:text-slate-700 disabled:opacity-30">Next →</button>
              </div>
            </div>

            {/* Metadata */}
            <div className="flex flex-wrap gap-2 text-xs text-slate-400">
              <span>{current.source_file ?? '—'}</span>
              {current.honors && <Badge color="green">⭐ Honors</Badge>}
              {current.suggested_domain && <Badge color="slate">{DOMAIN_LABELS[current.suggested_domain] ?? current.suggested_domain}</Badge>}
              {current.suggested_quarter && <Badge color="slate">Q{current.suggested_quarter} suggested</Badge>}
            </div>

            {current.topic && <p className="text-sm text-slate-600 italic">{current.topic}</p>}

            {/* LaTeX display / editor */}
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 bg-slate-50 border-b border-slate-200">
                <span className="text-xs font-medium text-slate-500">Problem LaTeX</span>
                <button onClick={() => { setEditingLatex(e => !e); setLatexDraft(current.latex) }}
                  className="text-xs text-brand-600 hover:text-brand-800 font-medium">
                  {editingLatex ? 'Cancel edit' : '✎ Edit LaTeX'}
                </button>
              </div>
              {editingLatex ? (
                <textarea value={latexDraft} onChange={e => setLatexDraft(e.target.value)} rows={8}
                  className="w-full px-3 py-2 text-xs font-mono text-slate-800 focus:outline-none resize-y bg-white" />
              ) : (
                <pre className="px-3 py-2 text-xs font-mono text-slate-700 whitespace-pre-wrap overflow-x-auto max-h-52 bg-white">
                  {current.latex}
                </pre>
              )}
            </div>

            {/* Answer */}
            {current.answer_latex && (
              <div className="rounded-lg bg-green-50 border border-green-100 px-3 py-2">
                <p className="text-xs font-semibold text-green-700 mb-0.5">Answer</p>
                <p className="text-xs font-mono text-green-800">{current.answer_latex}</p>
              </div>
            )}

            {/* Domain + Quarter */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <SectionLabel>Domain</SectionLabel>
                <select value={selectedDomain} onChange={e => setSelectedDomain(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500">
                  <option value="">— select —</option>
                  {DOMAINS.map(d => <option key={d} value={d}>{DOMAIN_LABELS[d]}</option>)}
                </select>
              </div>
              <div>
                <SectionLabel>Quarter</SectionLabel>
                <select value={selectedQuarter} onChange={e => setSelectedQuarter(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500">
                  <option value="">— select —</option>
                  {[1,2,3,4].map(q => <option key={q} value={q}>Q{q}</option>)}
                </select>
              </div>
            </div>

            <div>
              <SectionLabel>Notes (optional)</SectionLabel>
              <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any notes…"
                className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
            </div>

            {actionMsg && (
              <p className={`text-sm font-medium ${actionMsg.startsWith('Error') ? 'text-red-600' : actionMsg.startsWith('🚩') ? 'text-amber-600' : 'text-green-600'}`}>
                {actionMsg}
              </p>
            )}

            {/* Action buttons */}
            <div className="flex gap-2">
              <button onClick={handleApprove}
                className="flex-1 py-2.5 rounded-xl bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 transition">
                ✓ Approve
              </button>
              <button onClick={handleFlag}
                className="px-4 py-2.5 rounded-xl border-2 border-amber-300 text-amber-700 text-sm font-medium hover:bg-amber-50 transition">
                🚩 Flag
              </button>
              {!confirmDelete ? (
                <button onClick={handleDelete}
                  className="px-4 py-2.5 rounded-xl border-2 border-red-300 text-red-600 text-sm font-medium hover:bg-red-50 transition">
                  🗑
                </button>
              ) : (
                <div className="flex gap-1">
                  <button onClick={handleDelete} className="px-3 py-2 rounded-xl bg-red-600 text-white text-xs font-semibold hover:bg-red-700">Confirm delete</button>
                  <button onClick={() => setConfirmDelete(false)} className="px-3 py-2 rounded-xl border border-slate-300 text-xs text-slate-600 hover:bg-slate-50">Cancel</button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Right: tips */}
      <div className="lg:sticky lg:top-6 space-y-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4 text-sm space-y-3">
          <p className="font-semibold text-slate-700">Review workflow</p>
          <ol className="list-decimal list-inside space-y-2 text-xs text-slate-500">
            <li>Read the LaTeX — use <strong>✎ Edit LaTeX</strong> to fix errors inline</li>
            <li>Select domain + quarter</li>
            <li><strong>Approve</strong> → moves to bank for generation</li>
            <li><strong>🚩 Flag</strong> → keeps in inbox, excluded from generation</li>
            <li><strong>🗑 Delete</strong> → permanently removes (confirm required)</li>
          </ol>
          <div className="pt-2 border-t border-slate-100 text-xs text-slate-400">
            After reviewing, commit to save:<br/>
            <code className="bg-slate-100 px-1 rounded text-slate-600">git add problem_bank/ && git commit -m "Review session"</code>
          </div>
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-amber-800 space-y-2">
          <p className="font-semibold">Fixing Honors LaTeX</p>
          <p>• Delete <code>\textbf{'{'}Answer:{'}'}</code> from problem text — move answer to notes or delete if shown</p>
          <p>• Remove <code>\vspace</code>, <code>\newpage</code>, <code>\paragraph</code> commands</p>
          <p>• If the problem has an image/diagram that can't be described in text, delete it</p>
          <p>• Keep edits to the math — don't need to preserve formatting commands</p>
        </div>
      </div>
    </div>
  )
}

// ─── Root ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [online, setOnline] = useState<boolean | null>(null)
  const [tab, setTab]       = useState<Tab>('generator')

  useEffect(() => { checkHealth().then(setOnline) }, [])

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <header className="bg-brand-600 text-white shadow-md">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Math Homework Generator</h1>
            <p className="text-brand-100 text-sm mt-0.5">Grades 5–8 · Spiral Review + Lesson Practice</p>
          </div>
          <div className="flex items-center gap-6">
            <nav className="flex gap-1 bg-brand-700 rounded-lg p-1">
              {([
                { id: 'generator' as Tab, label: '📄 Generator' },
                { id: 'bank'      as Tab, label: '🗂 Review Bank' },
              ]).map(({ id, label }) => (
                <button key={id} onClick={() => setTab(id)}
                  className={['px-4 py-1.5 rounded-md text-sm font-medium transition',
                    tab === id ? 'bg-white text-brand-700 shadow-sm' : 'text-brand-100 hover:text-white'].join(' ')}>
                  {label}
                </button>
              ))}
            </nav>
            <StatusDot online={online} />
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-8">
        {tab === 'generator' ? <GeneratorTab online={online} /> : <BankReviewTab />}
      </main>

      <footer className="border-t border-slate-200 py-4 text-center text-xs text-slate-400">
        Math Homework Generator · Grades 5–8
      </footer>
    </div>
  )
}
