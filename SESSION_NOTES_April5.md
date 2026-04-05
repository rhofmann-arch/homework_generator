# Session Notes — April 5, 2026

## !! TRANSITION NOTE !!
This session was the last one run in Claude.ai chat. Starting next session,
use **Claude Code** (`cd ~/Downloads/math-homework-generator && claude`).
Claude Code reads repo files directly — no more stale snapshot problem.
At the start of each session: "Read SESSION_NOTES_April5.md and pick up where we left off."

---

## App URLs
- **Frontend:** https://rhofmann-arch.github.io/homework_generator/
- **Backend:** https://homework-generator-9crs.onrender.com
- **Repo:** https://github.com/rhofmann-arch/homework_generator

## Quick Reference Commands
```bash
# Local dev
cd ~/Downloads/math-homework-generator
export ANTHROPIC_API_KEY='sk-ant-...'
PYTHONPATH=backend python3 -m uvicorn backend.main:app --reload --port 8000
# Terminal 2:
cd frontend && VITE_API_URL=http://localhost:8000 npm run dev

# Deploy
git add -A && git commit -m "Description" && git push

# Ingest lesson PDF
python3 scripts/ingest_pdf.py --pdf lesson_pdfs/grade_6/6_X_Y.pdf --lesson X.Y --grade 6

# Commit bank after review
git add problem_bank/ && git commit -m "Bank: description"

# Check bank counts
for domain in arithmetic expressions_equations geometry stats_probability other; do
  count=$(find problem_bank/grade_6/$domain -name "*.json" 2>/dev/null | wc -l)
  echo "$domain: $count"
done
echo "_inbox: $(find problem_bank/grade_6/_inbox -name '*.json' 2>/dev/null | wc -l)"
```

---

## Files Changed This Session

| File | Destination | Change |
|------|-------------|--------|
| `bank.py` | `backend/routes/` | Added `lesson` param to `sample_problems()`; added `from __future__ import annotations` |
| `claude_service.py` | `backend/services/` | Bank-first front assembly with honor/HP filters; lesson template-locked back prompt; `_school_quarter()`; fixed import to `routes.bank` |
| `ingest_pdf.py` | `scripts/` | Added `--lesson` flag; lesson-based ID prefix; `from __future__ import annotations` |
| `App.tsx` | `frontend/src/` | Fixed TS build errors (api call signatures); preview height `82vh`; `maxHeight: 92vh` |
| `generate.py` | `backend/routes/` | Added `specific_date` passthrough (already had session storage from April 4) |

---

## !! HIGH IMPORTANCE — DAY PICKER / PER-DAY GENERATION !!

Rachel generates one homework PDF per **day** (Mon–Thu), NOT one per week.

The UI must always have:
1. Week picker (dropdown + arrows)
2. Day picker (Mon/Tue/Wed/Thu buttons) below week picker
3. Generate disabled until a day is selected
4. `specific_date` (YYYY-MM-DD) sent in every generate/recompile request
5. Assignment label shows day name, not week range

**This feature has been lost ~10 times.** `// !! HIGH IMPORTANCE — DO NOT REMOVE !!`
comment is embedded in the DayPicker component in App.tsx.

---

## !! HIGH IMPORTANCE — PROBLEM SELECTION LOGIC !!

### Grade Level — Front (10 problems)
1. 1 `high_priority=True, approved=True, honors excluded` from bank
2. 9 `approved=True, not high_priority, honors excluded` from bank
3. `max_quarter = _school_quarter(date)` caps to appropriate quarter
4. If bank total < 10: Claude fills shortfall — NO pacing guide reference

### Grade Level — Back (8–10 problems)
- If approved bank problems exist tagged `lesson=current_lesson`: **template-locked** —
  Claude varies numbers only (eliminates topic drift)
- Otherwise: lesson PDF as context + free generation

### Honors — Front (8 problems)
1. 1 `high_priority=True` from bank
2. 4 `honors=True, not high_priority` from bank
3. 3 `approved=True, not honors` from bank
4. If bank total < 8: Claude fills shortfall

### Honors — Back (5–7 problems)
- Same as grade level

### NO challenge block — removed. Honors = honors-flagged front problems.

### Quarter mapping (`_school_quarter`):
- Aug/Sep/Oct → Q1 | Nov/Dec/Jan → Q2 | Feb/Mar → Q3 | Apr–Jun → Q4

---

## Lesson PDF Bank Ingest — LIVE

**This is the permanent fix for back-page topic drift.**

### How it works:
1. Ingest lesson PDF with `--lesson 2.5` → problems tagged `lesson: "2.5"` in `_inbox`
2. Teacher reviews and approves in Bank Review UI (assigns domain + quarter)
3. At generation time, `_back_prompt()` calls `sample_problems(lesson="2.5")`
4. If templates found: Claude only varies numbers — cannot invent new problem types
5. If no templates: falls back to PDF context + free generation (old behavior)

### Status as of end of session:
- **Chapter 1 (lessons 1.1–1.6): ingested and approved** ✅
- **Lesson 2.5: ingested and approved** ✅
- All other chapters: not yet ingested (old PDF-only behavior still active)

### Ingest remaining chapters (run lesson by lesson):
```bash
# Chapter 2 (2.1–2.8) — PDFs are 6_2_1.pdf through 6_2_8.pdf
python3 scripts/ingest_pdf.py --pdf lesson_pdfs/grade_6/6_2_1.pdf --lesson 2.1 --grade 6
# ... etc

# Grade-level chapters 3–10 use mapped PDFs — use the ADV chapter numbers
# (e.g. GL lesson 3.1 → file 6_8_1.pdf per lesson_map.json)
# Pass the GL lesson number to --lesson, the system handles the PDF lookup separately
```

### Key: `lesson` field in bank JSON
Each approved lesson problem has `"lesson": "2.5"` in its JSON.
The `sample_problems()` function filters by this field.
Problems without a `lesson` field (DeltaMath, EOC bank, practicepages) are unaffected.

---

## `sample_problems()` Signature — Current (bank.py)

```python
def sample_problems(
    domain: str | None,    # None = all domains
    grade: int,
    max_quarter: int,      # ignored when lesson is set
    n: int,
    honors_only: bool = False,
    exclude_honors: bool = False,
    high_priority_only: bool = False,
    exclude_high_priority: bool = False,
    lesson: str | None = None,  # e.g. "2.5" — filters by lesson field
) -> list[dict]:
```

---

## Architecture Overview

```
frontend/src/
  App.tsx          — full UI: Generate mode + Bank Review mode
  api.ts           — all API calls (generateHomework, recompileHomework, bank API)
  dates.ts         — week/date helpers
  index.html       — MathJax CDN included

backend/
  main.py          — FastAPI app, registers routes
  routes/
    generate.py    — /api/generate, /api/homework/{key}/problems,
                     /api/homework/{key}/recompile
    bank.py        — /api/bank/review, /api/bank/stats, /api/bank/approve,
                     /api/bank/flag, /api/bank/delete, /api/bank/from_homework
                     + sample_problems() function
  services/
    claude_service.py  — all Claude API calls, problem assembly
    latex_builder.py   — LaTeX → PDF compilation
    pacing.py          — reads pacing guide XLSX, returns WeekContext
    lesson_pdf.py      — finds lesson PDF for a given lesson + class_type
                         (uses lesson_map.json for grade-level remapping)

scripts/
  ingest_pdf.py          — ingest worksheet PDFs into bank inbox
  ingest_screenshots.py  — ingest EOC screenshot folders (Q1–Q4 subfolders)

lesson_pdfs/
  grade_6/         — all lesson PDFs (6_1_1.pdf, 6_2_5.pdf, etc.)
  lesson_map.json  — remaps GL lesson numbers to advanced chapter PDF filenames

problem_bank/
  grade_6/
    _inbox/        — unreviewed problems
    arithmetic/q1/ through q4/
    expressions_equations/
    geometry/
    stats_probability/
    other/
```

---

## PDF Naming Convention

PDFs are named by **Advanced pacing guide chapter numbers**.
- `6_8_1.pdf` = Adv Ch8 L1 = GL Ch3 L1 (Ratios)
- `6_1_1.pdf` = Adv Ch1 L1 = GL Ch1 L1 (identical in both courses)

**Chapters 1–2:** same in both courses, direct lookup works.
**Chapters 3–10 (GL):** require remapping via `lesson_map.json`.
**Honors:** PDFs named by honors chapter numbers directly, no remapping needed.

Key file: `lesson_pdfs/lesson_map.json`

---

## Python 3.9 Compatibility

Rachel's Mac runs Python 3.9. Any file using `str | None`, `Path | None`,
or other union type syntax MUST have `from __future__ import annotations`
as the **first non-shebang, non-docstring line**.

Files confirmed fixed: `bank.py`, `claude_service.py`, `ingest_pdf.py`

To sweep all remaining files:
```bash
for f in $(find backend scripts -name "*.py"); do
  grep -q "from __future__" "$f" || sed -i '' '2s/^/from __future__ import annotations\n/' "$f"
done
git add -A && git commit -m "Add __future__ annotations to all Python files (Python 3.9 compat)"
```

---

## EOC High-Priority Bank

~40 problems in `problem_bank/grade_6/_inbox` from EOC screenshots.
Tagged `high_priority: true`, `source: "eoc_review"`, pre-set `quarter: N`.
**Still pending:** verify HP problems are showing up in generated front spirals.
Check with: generate a homework and look for a problem with `[DIAGRAM]` or
multiple-choice format (common in EOC problems).

### `needs_diagram` problems
Several EOC problems have `needs_diagram: true` and `diagram_notes` but no TikZ.
They are skipped by `sample_problems()` (not yet approved).
To approve: add TikZ to the `latex` field in Bank Review, then approve.

### Second EOC test — not yet ingested:
```bash
python3 scripts/ingest_screenshots.py --dir path/to/second_eoc/ --grade 6
```

---

## Features NOT Yet Built (Next Session Priorities)

### 1. ⚠️ Refresh a Problem (UI)
Allow re-sampling a single problem in the editor without regenerating the full
assignment. Discussed and designed but not implemented.

**Design:**
- Each front problem needs a `slot` field saved to session JSON:
  `"hp"`, `"honors"`, `"regular"`, or `"fill"`
- New backend endpoint: `POST /api/homework/{key}/refresh`
  - Body: `{section: "front"|"back", index: int}`
  - Front: re-samples from bank using same slot filters
  - Back: re-samples from lesson bank templates OR regenerates 1 problem
  - Returns: `{latex, answer_latex}`
- Frontend: 🔄 button on each ProblemCard in the editor
- Client updates local state; user then hits Recompile PDF

**`generate.py` needs:** session JSON must include `front_slots` array and
`_context` dict `{week_start, specific_date, grade, class_type, current_lessons,
current_topic, pacing_grade}`.

**`claude_service.py` needs:**
- `_assemble_front()` returns `(problems, spiral_topics, slots)` not just 2-tuple
- New `refresh_front_problem(slot, grade, class_type, specific_date)` function
- New `refresh_back_problem(lessons, topic, grade, class_type)` function
- New `SINGLE_PROBLEM_TOOL` for generating exactly 1 replacement

### 2. ⚠️ Back Problem Count Control (UI)
Allow teacher to specify how many lesson practice problems (currently hardcoded
8-10 for GL, 5-7 for honors).

**Design:**
- Add `n_back: int | None = None` to `GenerateRequest` in `generate.py`
- Pass through to `generate_problems()` and `_back_prompt()`
- `_back_prompt()` uses `n_back` instead of hardcoded `"8-10"` / `"5-7"`
- Frontend: stepper control +/- in Class Type section, range 5-10

### 3. Preview Panel Size
Currently `height: '82vh'` on iframe, `maxHeight: '92vh'` on container.
User still reports it looks small. Possible cause: the right panel column is
only 420px wide, making the PDF appear small even at full height.
Consider: widen right column from `420px` to `520px`, or go full-width below the form.

---

## App.tsx Feature Checklist (verify at start of every session)

```
// !! FEATURE CHECKLIST — DO NOT REMOVE ANY OF THESE !!
// [1] DAY PICKER: Mon–Thu buttons, specific_date sent to backend
// [2] BANK REVIEW MODE: mode switcher, full review panel
// [3] PROBLEM EDITOR: edit LaTeX, recompile, save to bank
// [4] HW + KEY: separate download links
```

Current App.tsx: 742 lines. If it's shorter than ~700 lines, something was lost.

---

## Known Recurring Bugs / Watch Out For

| Bug | Cause | Fix |
|-----|-------|-----|
| `sample_problems() unexpected keyword 'lesson'` | Old bank.py deployed | Deploy updated bank.py |
| `from services.bank import` fails | Wrong import path | Must be `from routes.bank import` |
| `Path \| None` TypeError | Python 3.9 | Add `from __future__ import annotations` |
| Day picker disappears after rewrite | App.tsx rebuilt from stale snapshot | Check line count; re-add from session notes |
| Deploy fails TS build | api.ts call signatures | `approveProblem(id, domain, quarter, notes)` — positional, not object |

---

## Bank Problem JSON Schema

```json
{
  "id": "les_2p5_g6_0001",
  "domain": "arithmetic",
  "grade": 6,
  "quarter": 1,
  "lesson": "2.5",          // present for lesson-ingested problems; null otherwise
  "topic": "adding decimals",
  "latex": "Find $3.7 + 2.85$.",
  "answer_latex": "$6.55$",
  "suggested_quarter": 1,
  "source_file": "6_2_5.pdf",
  "source_problem_number": 3,
  "approved": true,
  "flagged": false,
  "honors": false,
  "high_priority": false,   // true for EOC bank problems
  "needs_diagram": false,
  "notes": ""
}
```

---

## Lesson Bank Ingest — Remaining Chapters

Chapter 1 and 2.5 done. Remaining ingest order (prioritize current/upcoming chapters):

| GL Chapter | Content | PDF files | Lessons |
|------------|---------|-----------|---------|
| Ch 2 | Fractions/Decimals | `6_2_1` – `6_2_8` | 2.1–2.8 |
| Ch 3 | Ratios/Rates | `6_8_1` – `6_8_6` | 3.1–3.6 |
| Ch 4 | Percents | `6_9_1` – `6_9_3` | 4.1–4.4 |
| Ch 5 | Expressions | `6_6_1` – `6_6_5` | 5.1–5.4 |
| Ch 6 | Equations | `6_7_1` – `6_7_4` | 6.1–6.4 |
| Ch 7 | Geometry | `6_10_1` – `6_10_7` | 7.1–7.7 |
| Ch 8 | Integers/Coord | `6_3_1` – `6_3_6` | 8.1–8.7 |
| Ch 9 | Statistics | `6_12_1` – `6_12_5` | 9.1–9.5 |
| Ch 10 | Stats pt 2 | `6_13_1` – `6_13_5` | 10.1–10.5 |

**Important:** Pass the **GL lesson number** to `--lesson` (e.g. `--lesson 3.1`),
NOT the advanced chapter number. The `lesson` field is what `sample_problems()`
filters on, and the pacing guide uses GL lesson numbers.

For GL chapters 3–10, use the mapped PDF filename (e.g. for lesson 3.1,
the PDF is `6_8_1.pdf` per lesson_map.json):
```bash
python3 scripts/ingest_pdf.py --pdf lesson_pdfs/grade_6/6_8_1.pdf --lesson 3.1 --grade 6
```
