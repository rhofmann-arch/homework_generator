# Session Notes — March 27, 2026 (Afternoon)

## What Was Accomplished This Session

### 1. Problem Bank Infrastructure (Phase 1)

**New files:**
- `scripts/init_bank.py` — creates the full directory tree for the bank
- `scripts/ingest_pdf.py` — ingests DeltaMath PDFs into structured JSON

**Bank structure:**
```
problem_bank/
  grade_6/
    fractions_decimals/      q1/ q2/ q3/ q4/
    expressions_equations/   q1/ q2/ q3/ q4/
    geometry/                q1/ q2/ q3/ q4/
    stats_probability/       q1/ q2/ q3/ q4/
```

**Grade-namespaced from the start** — when grades 5/7/8 are added, run:
```bash
python3 scripts/init_bank.py --grades 5 7 8
```

**Ingest pipeline:**
- Rasterizes each PDF page with `pdftoppm` (requires `brew install poppler`)
- Sends page images to Claude vision with forced `tool_use` for clean JSON
- Claude extracts problems, suggests quarterly placement, fills answers from key PDF
- Writes one JSON file per problem: `eq_6q1_0001.json`

**JSON schema:**
```json
{
  "id": "eq_6q1_0001",
  "domain": "expressions_equations",
  "grade": 6,
  "quarter": 1,
  "topic": "one-step addition equation, whole numbers",
  "latex": "Find the value of $x$.\n$$17 = x + 13$$",
  "answer_latex": "x = 4",
  "source_file": "Equations.pdf",
  "source_problem_number": 1,
  "approved": false,
  "flagged": false,
  "notes": ""
}
```

**290 problems ingested from 5 DeltaMath PDFs:**

| Domain | Problems |
|--------|----------|
| expressions_equations | 130 |
| geometry | 75 |
| fractions_decimals | 55 |
| stats_probability | 30 |

**To ingest more PDFs:**
```bash
cd ~/Downloads/math-homework-generator

python3 scripts/ingest_pdf.py \
    --pdf ~/Downloads/SomePDF.pdf \
    --key-pdf ~/Downloads/"SomePDF - KEY.pdf" \
    --domain geometry \
    --dry-run   # remove --dry-run to write files

# Then commit
git add problem_bank/
git commit -m "Ingest: geometry chapter 3 problems"
git push
```

---

### 2. Teacher Review UI (Phase 2)

**New backend routes** (`backend/routes/bank.py`):
- `GET /api/bank/review` — returns unapproved problems by domain, paginated
- `POST /api/bank/approve` — approves a problem, optionally moves to different quarter, supports `flagged` field
- `DELETE /api/bank/delete` — permanently deletes a problem
- `GET /api/bank/stats` — summary counts by domain (total / approved / flagged)

**Registered in** `backend/main.py`:
```python
app.include_router(bank.router, prefix="/api")
```

**Frontend** — "Review Bank" tab added to the app:
- Stats panel showing total / approved / pending counts
- Domain tabs with pending count per domain
- One-at-a-time problem review with LaTeX rendered via MathJax
- Quarter confirmation (can override auto-suggestion — moves file to correct folder)
- Notes field
- Three actions: **Approve**, **🚩 Flag** (approved but needs review before use), **🗑 Delete** (with confirmation)

**MathJax** added to `frontend/index.html` for LaTeX rendering in the review UI.

**Key Render env var required:**
```
PROBLEM_BANK_ROOT = /problem_bank
```
Without this, approve/delete writes go to the wrong path and don't persist.

**Persistence caveat:** Approvals written on Render persist within a session but
reset on redeploy (Render's ephemeral filesystem). To make approvals permanent:
1. Do reviews locally (start backend with `uvicorn backend.main:app --reload`)
2. Commit the updated JSON files: `git add problem_bank/ && git commit && git push`
3. The approved files are then baked into the Docker image permanently

---

### 3. Day Picker Restored

The morning session's per-day generation UI was accidentally wiped during the
Phase 2 App.tsx rewrite and has been restored.

**How it works:**
- Week dropdown populated from `/api/weeks/6` — only shows weeks with homework days
- Day buttons (Mon/Tue/Wed/Thu) appear dynamically based on pacing guide
- **Full Week** generates one PDF per school day, sequentially
- **Individual day** generates one PDF for that day only
- Generate button label updates: "Generate PDF" vs "Generate Full Week (4 PDFs)"
- Progress indicator shows which day is currently generating during full week runs

---

### 4. Bug Fixes

**`latex_builder.py` — normalize_problems:**
Claude occasionally returns `back_problems` as a list of strings instead of
`[{"latex": "..."}]` objects. Added `_normalize_problems()` to handle both
shapes defensively. Fixes intermittent `TypeError: string indices must be integers`
on honors generation.

**`api.ts` — `specific_date` field:**
Added `specific_date?: string` to the `GenerateRequest` TypeScript interface.
Was missing, causing TypeScript build failures after day picker was restored.

---

## Current App Status

**Frontend:** https://rhofmann-arch.github.io/homework_generator/
**Backend:** https://homework-generator-9crs.onrender.com
**Repo:** https://github.com/rhofmann-arch/homework_generator

### What's Working
- ✅ Per-day and full-week PDF generation (Grade 6, Grade Level + Honors)
- ✅ Week picker shows only school weeks from pacing guide
- ✅ Day picker shows actual school days per week
- ✅ Problem bank: 290 problems ingested across 4 domains
- ✅ Teacher review UI: approve / flag / delete with quarter confirmation
- ✅ MathJax rendering in review UI
- ✅ Honors generation (intermittent string/dict issue fixed)

### Known Issues
- ⚠️ **Spiral review is empty for early-year weeks** (Sep, early Oct) because
  `covered_topics` is too small to generate 10 meaningful problems. Fix is
  Phase 3 (bank sampler) — see Next Session Priorities below.
- ⚠️ **Approvals reset on redeploy** — use local backend for review sessions
  until a persistent storage solution is added (see below).
- ⚠️ **LaTeX rendering issues** in review UI for some problems — doesn't affect
  PDF generation; MathJax handles most cases but some edge cases need manual
  cleanup in the JSON files.
- ⚠️ **Render free tier cold starts** — first request after ~15 min inactivity
  takes 30-60 sec. Fix: upgrade to $7/month Starter tier.

---

## Files Changed This Session

| File | Change |
|------|--------|
| `scripts/init_bank.py` | New — creates bank directory tree |
| `scripts/ingest_pdf.py` | New — DeltaMath PDF → JSON ingest |
| `backend/routes/bank.py` | New — review API routes |
| `backend/main.py` | Modified — register bank router |
| `backend/services/latex_builder.py` | Modified — add `_normalize_problems()` |
| `frontend/src/api.ts` | Modified — bank API functions + `specific_date` field |
| `frontend/src/App.tsx` | Modified — Review Bank tab + restored day picker |
| `frontend/index.html` | Modified — MathJax script added |

---

## Next Session Priorities

### 1. Phase 3 — Wire Bank Into Generation (HIGH PRIORITY)

This fixes the empty spiral review problem for early-year weeks.

**Plan:** Replace the current "generate all 10 from covered_topics" approach
with the spec'd pool system:

| Pool | Count | Source |
|------|-------|--------|
| A | 3 | Fractions & Decimals — sampled from approved bank problems |
| B | 3 | Geometry (1–2) + Expressions/Equations (1–2) — from bank |
| C | 1 | Stats or Probability — from bank |
| D | 3 | Current chapter review — still generated by Claude |

**Files to create/modify:**
- `backend/services/bank_sampler.py` (new) — `sample(domain, grade, max_quarter, n)`
- `backend/services/claude_service.py` — modify front prompt: pass sampled problems
  as basis, Claude changes numbers/names, only generates Pool D from scratch
- `covered_topics` dependency goes away for Pools A/B/C entirely

**Prerequisite:** Enough approved problems in the bank across all 4 domains.
Currently 290 ingested but 0 approved — need a review session first.

---

### 2. Local Review Workflow Setup

To make approvals permanent without fighting Render's ephemeral filesystem:

```bash
# Terminal 1 — backend
cd ~/Downloads/math-homework-generator
export ANTHROPIC_API_KEY="sk-ant-..."
pip3 install fastapi uvicorn openpyxl pandas python-dotenv pypdf
cd backend
uvicorn main:app --reload --port 8000

# Terminal 2 — frontend
cd ~/Downloads/math-homework-generator/frontend
VITE_API_URL=http://localhost:8000 npm run dev
# Open http://localhost:5173
```

After a review session:
```bash
cd ~/Downloads/math-homework-generator
git add problem_bank/
git commit -m "Approve bank problems: [domain] Q[n]"
git push
```

---

### 3. practicepages.pdf Ingestion (Phase 4)

The two `practicepages.pdf` files in the repo are a different format from DeltaMath
(Rachel's own practice pages). These need a classification step added to the ingest
pipeline before quarterly placement — defer until Phase 1–3 are solid.

**When ready:**
```bash
python3 scripts/ingest_pdf.py \
    --pdf practicepages.pdf \
    --domain expressions_equations  # or whichever domain applies
```

---

### 4. Off-Limits Problem Types (from session notes)

Add an `AVOID_STYLES` list to `claude_service.py` for problem types that should
never be generated (identified from `practicepages.pdf`). Needs a review of the
PDF together first to agree on the list. ~20-30 min once list is agreed.

---

### 5. Emphasis / Struggling-Skills Topics

Teachers flag topics the class is struggling with → those topics get extra weight
in spiral review. Options:
- New "Emphasis Topics" tab in the pacing guide Excel
- Or a text field in the app UI

See March 27 morning session notes for full design spec.

---

### 6. Other Lower-Priority Items
- Loading timeout message (>45 sec → "backend may be waking up")
- PDF layout quality review with a teacher
- Upgrade Render to paid tier ($7/month) to eliminate cold starts
- Pacing guide upload endpoint (so teachers can update without git)

---

## Quick Reference

**Add more DeltaMath problems to the bank:**
```bash
python3 scripts/ingest_pdf.py \
    --pdf ~/Downloads/NewTopic.pdf \
    --key-pdf ~/Downloads/"NewTopic - KEY.pdf" \
    --domain geometry   # or fractions_decimals, expressions_equations, stats_probability
git add problem_bank/ && git commit -m "Ingest: ..." && git push
```

**Check bank counts:**
```bash
for domain in expressions_equations fractions_decimals geometry stats_probability; do
  count=$(find problem_bank/grade_6/$domain -name "*.json" | wc -l)
  echo "$domain: $count"
done
```

**Standard deploy:**
```bash
git add . && git commit -m "Description" && git push
```

**Check backend logs:** render.com → homework_generator → Logs
**Check deploy status:** github.com/rhofmann-arch/homework_generator/actions
