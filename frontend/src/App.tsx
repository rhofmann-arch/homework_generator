import { useState, useEffect, useCallback } from 'react'
import { generateHomework, checkHealth, fetchSchoolWeeks, type GenerateRequest, type SchoolWeek } from './api'
import { getMonday, formatWeekRange, formatISO, shortDow } from './dates'

// --- Types ---

type Grade = '5' | '6' | '7' | '8'
type ClassType = 'grade_level' | 'honors'
type Status = 'idle' | 'loading' | 'done' | 'error'

interface Assignment {
  weekStart: string
  specificDate?: string
  grade: Grade
  classType: ClassType
  label: string
  pdfUrl: string
}

// --- Small components ---

function Badge({ children, color = 'blue' }: { children: React.ReactNode; color?: 'blue' | 'green' | 'slate' }) {
  const cls = {
    blue:  'bg-brand-100 text-brand-700',
    green: 'bg-honors-50 text-honors-700',
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
    <span className="flex items-center gap-1.5 text-xs text-slate-500">
      <span className={`w-2 h-2 rounded-full ${online ? 'bg-green-400' : 'bg-red-400'}`} />
      {online ? 'Backend connected' : 'Backend offline — check Render'}
    </span>
  )
}

// --- Week Picker ---

function WeekPicker({
  value,
  onChange,
  schoolWeeks,
}: {
  value: string
  onChange: (weekStart: string) => void
  schoolWeeks: SchoolWeek[]
}) {
  if (schoolWeeks.length === 0) {
    return <p className="text-sm text-slate-400">Loading calendar...</p>
  }

  const currentIndex = schoolWeeks.findIndex(w => w.week_start === value)

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => { if (currentIndex > 0) onChange(schoolWeeks[currentIndex - 1].week_start) }}
        disabled={currentIndex <= 0}
        className="p-1.5 rounded hover:bg-slate-200 text-slate-500 hover:text-slate-700 transition disabled:opacity-30"
        title="Previous week"
      >
        &#9664;
      </button>

      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
      >
        {schoolWeeks.map(w => (
          <option key={w.week_start} value={w.week_start}>
            {formatWeekRange(w.week_start)}
          </option>
        ))}
      </select>

      <button
        onClick={() => { if (currentIndex < schoolWeeks.length - 1) onChange(schoolWeeks[currentIndex + 1].week_start) }}
        disabled={currentIndex >= schoolWeeks.length - 1}
        className="p-1.5 rounded hover:bg-slate-200 text-slate-500 hover:text-slate-700 transition disabled:opacity-30"
        title="Next week"
      >
        &#9654;
      </button>
    </div>
  )
}

// --- Day Picker ---

function DayPicker({
  schoolWeeks,
  selectedWeek,
  selectedDate,
  onChange,
}: {
  schoolWeeks: SchoolWeek[]
  selectedWeek: string
  selectedDate: string | null
  onChange: (date: string | null) => void
}) {
  const week = schoolWeeks.find(w => w.week_start === selectedWeek)
  if (!week) return null

  return (
    <div>
      <SectionLabel>Day</SectionLabel>
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => onChange(null)}
          className={[
            'px-3 py-2 rounded-lg border text-sm font-medium transition',
            selectedDate === null
              ? 'bg-brand-600 border-brand-600 text-white shadow-sm'
              : 'bg-white border-slate-300 text-slate-600 hover:border-brand-400 hover:text-brand-600',
          ].join(' ')}
        >
          Full week
        </button>
        {week.days.map(day => (
          <button
            key={day.date}
            onClick={() => onChange(day.date)}
            className={[
              'px-3 py-2 rounded-lg border text-sm font-medium transition',
              selectedDate === day.date
                ? 'bg-brand-600 border-brand-600 text-white shadow-sm'
                : 'bg-white border-slate-300 text-slate-600 hover:border-brand-400 hover:text-brand-600',
            ].join(' ')}
          >
            {shortDow(day.dow)}
            <span className="ml-1 text-xs opacity-70">#{day.day_num}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

// --- Assignment History Item ---

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
        <a
          href={item.pdfUrl}
          download={`hw_grade${item.grade}_${item.specificDate ?? item.weekStart}.pdf`}
          className="text-xs font-medium text-brand-600 hover:text-brand-800 underline"
        >
          Download
        </a>
        <button
          onClick={onRemove}
          className="text-slate-300 hover:text-slate-500 text-lg leading-none"
          title="Remove"
        >
          x
        </button>
      </div>
    </div>
  )
}

// --- Main App ---

export default function App() {
  const [online, setOnline]               = useState<boolean | null>(null)
  const [schoolWeeks, setSchoolWeeks]     = useState<SchoolWeek[]>([])
  const [selectedWeek, setSelectedWeek]   = useState<string>('')
  const [selectedDate, setSelectedDate]   = useState<string | null>(null)
  const [grade, setGrade]                 = useState<Grade>('6')
  const [classType, setClassType]         = useState<ClassType>('grade_level')
  const [status, setStatus]               = useState<Status>('idle')
  const [errorMsg, setErrorMsg]           = useState('')
  const [history, setHistory]             = useState<Assignment[]>([])
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null)

  useEffect(() => {
    checkHealth().then(setOnline)
  }, [])

  useEffect(() => {
    setSchoolWeeks([])
    setSelectedWeek('')
    setSelectedDate(null)
    fetchSchoolWeeks(grade)
      .then(weeks => {
        setSchoolWeeks(weeks)
        const todayISO = formatISO(getMonday(new Date()))
        const best = weeks.find(w => w.week_start >= todayISO) ?? weeks[0]
        if (best) setSelectedWeek(best.week_start)
      })
      .catch(() => {})
  }, [grade])

  useEffect(() => {
    setSelectedDate(null)
  }, [selectedWeek])

  const handleGenerate = useCallback(async () => {
    if (!selectedWeek) return
    setStatus('loading')
    setErrorMsg('')
    setPdfPreviewUrl(null)

    const req: GenerateRequest = {
      week_start:    selectedWeek,
      grade,
      class_type:    classType,
      specific_date: selectedDate ?? undefined,
    }

    try {
      const blob = await generateHomework(req)
      const url  = URL.createObjectURL(blob)
      setPdfPreviewUrl(url)

      const weekLabel = formatWeekRange(selectedWeek)
      const dayLabel  = selectedDate
        ? schoolWeeks.find(w => w.week_start === selectedWeek)
            ?.days.find(d => d.date === selectedDate)
            ?.dow ?? selectedDate
        : 'Full week'
      const label = `${weekLabel} · ${dayLabel} · Grade ${grade} · ${classType === 'honors' ? 'Honors' : 'Grade Level'}`

      setHistory(prev => [
        { weekStart: selectedWeek, specificDate: selectedDate ?? undefined, grade, classType, label, pdfUrl: url },
        ...prev,
      ])
      setStatus('done')
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : 'Unknown error')
      setStatus('error')
    }
  }, [selectedWeek, selectedDate, grade, classType, schoolWeeks])

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-brand-600 text-white shadow-md">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Math Homework Generator</h1>
            <p className="text-brand-100 text-sm mt-0.5">Grades 5-8 · Spiral Review + Lesson Practice</p>
          </div>
          <StatusDot online={online} />
        </div>
      </header>

      <main className="flex-1 max-w-5xl mx-auto w-full px-6 py-8 grid grid-cols-1 lg:grid-cols-[1fr_420px] gap-8 items-start">
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-6">
            <h2 className="text-base font-semibold text-slate-700">Generate Assignment</h2>

            <div>
              <SectionLabel>Week</SectionLabel>
              <WeekPicker value={selectedWeek} onChange={setSelectedWeek} schoolWeeks={schoolWeeks} />
            </div>

            {schoolWeeks.length > 0 && selectedWeek && (
              <DayPicker
                schoolWeeks={schoolWeeks}
                selectedWeek={selectedWeek}
                selectedDate={selectedDate}
                onChange={setSelectedDate}
              />
            )}

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

            <div>
              <SectionLabel>Class Type</SectionLabel>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { val: 'grade_level' as ClassType, label: 'Grade Level', sub: '20 min · 10-12 problems' },
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

            <div className="bg-slate-50 rounded-xl p-3 text-sm text-slate-600">
              <span className="font-medium">Generating: </span>
              Grade {grade} · {classType === 'honors' ? 'Honors' : 'Grade Level'} ·{' '}
              {selectedWeek ? formatWeekRange(selectedWeek) : '...'}
              {selectedDate && (
                <span className="ml-1 text-brand-600 font-medium">
                  · {schoolWeeks.find(w => w.week_start === selectedWeek)?.days.find(d => d.date === selectedDate)?.dow ?? selectedDate}
                </span>
              )}
            </div>

            {status === 'error' && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">
                <span className="font-semibold">Error: </span>{errorMsg}
              </div>
            )}

            <button
              onClick={handleGenerate}
              disabled={status === 'loading' || !online || !selectedWeek}
              className={[
                'w-full py-3 rounded-xl text-sm font-semibold transition shadow-sm',
                status === 'loading'
                  ? 'bg-brand-400 text-white cursor-wait'
                  : !online || !selectedWeek
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
                  Generating PDF...
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
                <a
                  href={pdfPreviewUrl}
                  download={`hw_grade${grade}_${selectedDate ?? selectedWeek}.pdf`}
                  className="text-xs font-medium text-brand-600 hover:text-brand-800 flex items-center gap-1"
                >
                  &#8595; Download PDF
                </a>
              )}
            </div>

            {pdfPreviewUrl ? (
              <iframe src={pdfPreviewUrl} className="w-full" style={{ height: '680px' }} title="Homework PDF preview" />
            ) : (
              <div className="flex flex-col items-center justify-center text-center py-16 px-8 text-slate-400">
                <div className="text-5xl mb-4">&#128196;</div>
                <p className="text-sm font-medium text-slate-500">No preview yet</p>
                <p className="text-xs mt-1">
                  {status === 'loading' ? 'Generating - this takes about 30 seconds...' : 'Configure options and click Generate'}
                </p>
                {status === 'loading' && (
                  <div className="mt-4 w-32 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-brand-400 rounded-full animate-pulse" style={{ width: '60%' }} />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </main>

      <footer className="border-t border-slate-200 py-4 text-center text-xs text-slate-400">
        Math Homework Generator · Grades 5-8 ·{' '}
        <a href="https://github.com" className="hover:text-brand-500">GitHub</a>
      </footer>
    </div>
  )
}
