# Hybrid 6th-Grade Math — Handoff for Claude Code

**Date:** 2026-06-23
**Purpose:** A new "hybrid" 6th-grade math section has been created. Its pacing guide is
done (see file below). This document is the spec for wiring the hybrid section into the
existing homework generator. **Do not start coding from assumptions — read the touch-points
in §4 against the live repo first; the project snapshot is known to go stale.**

---

## 1. What the hybrid class is

- Uses the **advanced** textbook, materials, and **advanced lesson numbering** (1.1, 2.2, …).
- Runs at a **slower pace** than the advanced section.
- **Drops the two statistics / data-display chapters** (advanced Ch 12 and Ch 13) — those
  standards are covered elsewhere. Nothing in the hybrid pacing references Ch 12/13.
- Covers **advanced Chapters 1–11 only**, stretched across the full year with extra review.

Because it uses advanced lesson numbers directly, the hybrid class looks up lesson PDFs the
**same way "honors" does** — direct lookup by advanced chapter/lesson, **no `lesson_map.json`
remapping needed** (honors entry in lesson_map is `{}`; hybrid is the same).

---

## 2. The new pacing guide (delivered)

**File:** `6th_Grade_Hybrid_Math_Pacing_Guide_2026-2027.xlsx`
Built by copying the advanced guide and re-flowing content, so structure/format is identical.

### Calendar — unchanged from the advanced guide
Every date, weekday, holiday, break, half-day, and quarter/semester boundary is exactly as in
`6th_Grade_Advanced_Math_Pacing_Guide_2026-2027.xlsx`. Only the lesson/topic/homework columns
were re-populated.

- School year: **Thu 2026-08-20 → Fri 2027-06-04**.
- **168 instructional class days** from the start through **Fri 2027-05-28** (the last class day
  before Memorial Day, Mon 2027-05-31).
- Content (Ch 1–11) fills those 168 days exactly: **Chapter 11 test lands on Fri 2027-05-28**.
- **Tue 2027-06-01 → Fri 2027-06-04** are buffer, labeled **"Flex / cumulative review"**
  (last day is half-day).

### Pacing math
- 143 advanced Ch 1–11 lesson-days + 25 added cushion days = 168.
- The 25 cushion days are **extra-practice / review** days distributed at the hardest spots
  (dividing fractions / mixed numbers / decimals in Ch 2; integer & rational operations in
  Ch 4–5; expressions & equations in Ch 6–7; percents in Ch 9; plus geometry in Ch 10–11).
  They are labeled e.g. `Integer add/subtract mixed practice`, `Factors & multiples mixed review`.

### Sheet / column layout (same as advanced; two sheets: `First Semester`, `Second Semester`)
| Col | Header | Meaning |
|-----|--------|---------|
| A | (day #) | Per-quarter class-day counter (tied to calendar; unchanged) |
| B | (date) | Date (datetime) |
| C | (weekday) | `M / T / W / Th / F`, plus end markers like `F/END Q1`, `F/END S1`, `Th/END Q3`, `F/END S2` |
| D | (notes) | Half days, `… NO SCHOOL`, break labels |
| E | Lesson | Advanced lesson number (`1.1`…`11.5`), or `Extra` / `Review`, or test codes (`6_1_test`, `6_2_mc`, `6_2_test`, `6_3_test`, `6_4_test`) |
| F | Topic | Lesson title / `Review` / `Chapter N Test` |
| G | HW Front | **`Day N`** homework counter (the field the pacing parser reads as hw_numbers) |
| H | HW Back | unused |
| I | Extensions? | unused |
| J | HM? | unused |

### Homework numbering convention (column G) — IMPORTANT, this changed
`Day N` runs **1–126** and is assigned only on homework days. **No homework on:**
- **Fridays** (34 days) — lessons still happen Fridays, but no assignment.
- **Chapter tests** (11 days; 3 of them fall on Fridays).

So homework exists **Mon–Thu on non-test days only**. This matches the generator's existing
**Mon–Thu day picker** (see SESSION_NOTES_April4_final.md), so the calendar and the UI agree.
A day with a blank column G = no homework that day.

---

## 3. How the generator works today (relevant bits)

Backend layout (per SESSION_NOTES): `backend/routes/`, `backend/services/`, `frontend/src/`.

- **Pacing parse:** `services/pacing.py` → `get_week_context(week_start, grade)` and
  `get_all_weeks(grade)`. Returns `WeekContext` with `hw_days`, `current_lessons`,
  `lesson_title`, `hw_numbers`, `covered_topics`, etc. **Pacing files are keyed by a `grade`
  string** — the advanced guide is loaded under grade key `"6_advanced"`.
- **Grade resolution:** `generate.py::_pacing_grade(grade, class_type)`
  → `honors + "6"` returns `"6_advanced"`, else returns `grade`.
- **Request models:** `generate.py` `GenerateRequest` / `RecompileRequest` have
  `class_type: Literal["grade_level", "honors"]` and `grade: Literal["5","6","7","8"]`.
- **PDF lookup:** `services/lesson_pdf.py::find_lesson_pdf(grade, lesson, class_type)`.
  PDFs are named by **advanced** chapter numbers (e.g. `6_8_1.pdf` = Adv Ch8 L1 = Ratios).
  `grade_level` remaps via `lesson_map.json`; `honors` looks up directly.
- **Problem assembly** (`claude_service.py`, canonical per SESSION_NOTES_April4_final.md):
  - Front = spiral review sampled from the **bank**, capped to the date's school quarter
    via `_school_quarter()` (Aug–Oct Q1, Nov–Jan Q2, Feb–Mar Q3, Apr–Jun Q4).
    - grade_level front: 1 high-priority + 9 standard (10 total).
    - honors front: 5 honors-flagged + 3 standard (8 total).
  - Back = Claude-generated on the pacing `current_topic`, lesson PDF passed as context.
    `n = "5-7"` for honors else `"8-10"`. **No challenge block** (removed).
- **UI:** week picker + **Mon–Thu day picker**; `specific_date` (YYYY-MM-DD) sent on every
  generate/recompile. (App.tsx historically regresses — see the "DO NOT REMOVE" notes.)

---

## 4. What to do to support the hybrid section (code touch-points)

Verify each against the live repo before editing.

1. **Place the pacing file** where `services/pacing.py` loads pacing workbooks, and add a
   `grade` key for it (suggested **`"6_hybrid"`**). Find the existing grade→filename mapping
   in `services/pacing.py` and add the hybrid entry alongside `"6_advanced"`.

2. **Add the class type.** Introduce a hybrid option. Two viable shapes — pick one and keep it
   consistent across backend + frontend:
   - (a) New `class_type = "hybrid"`, or
   - (b) Keep honors/grade_level and add a separate grade selection.
   Recommended: **`class_type: "hybrid"`** added to the `Literal[...]` in `GenerateRequest`
   and `RecompileRequest`.

3. **Map hybrid → pacing grade.** Extend `_pacing_grade()`:
   `if class_type == "hybrid" and grade == "6": return "6_hybrid"`.

4. **PDF lookup = direct (like honors).** In `lesson_pdf.py`, treat `hybrid` on the
   honors/direct path (advanced lesson numbers, no `lesson_map`). Hybrid never requests
   Ch 12/13 PDFs, so nothing stats-related is needed.

5. **Back-page length.** Decide hybrid's `n` in `_back_prompt` (see §5).

6. **Front-page mix.** Decide hybrid's bank sampling profile (see §5).

7. **Frontend:** add hybrid to the mode/class selector and to `api.ts` types; keep the
   **Mon–Thu day picker** (no Friday option — consistent with the pacing guide).

8. **Session/file keys:** `_session_key` and `_build_zip` already interpolate `class_type`;
   adding `"hybrid"` flows through naming as `hw_grade6_hybrid_<date>.pdf` etc. Confirm no
   hard-coded `["grade_level","honors"]` lists elsewhere.

---

## 5. Open decisions (need Rachel's input — do not guess)

1. **Front-page profile for hybrid.** Same as honors (5 honors-flagged + 3 standard),
   same as grade_level (1 high-priority + 9 standard), or a new blend? Hybrid is advanced
   content at a gentler pace, so it likely sits **between** the two.
2. **Back-page count.** Honors uses 5–7, grade_level 8–10. Which for hybrid?
3. **Bank flags.** Should hybrid draw from honors-flagged problems, the general pool, or a new
   `hybrid` flag on bank problems?
4. **Friday review.** Fridays carry a lesson but no homework. Confirm that's the intended rule
   for the generator (today's Mon–Thu picker already enforces it).

---

## 6. Suggested next-step checklist

- [ ] Confirm `services/pacing.py` pacing-file directory + grade-key mapping; drop in
      `6_hybrid` → `6th_Grade_Hybrid_Math_Pacing_Guide_2026-2027.xlsx`.
- [ ] Add `"hybrid"` to request `Literal`s; extend `_pacing_grade`.
- [ ] Route hybrid through the direct (honors-style) PDF lookup.
- [ ] Resolve §5 decisions; implement front/back profiles.
- [ ] Frontend selector + types; keep Mon–Thu day picker.
- [ ] Smoke test: `get_week_context("2026-08-24", grade="6_hybrid")` returns sane
      `hw_days` / `current_lessons` / `hw_numbers`; generate one Mon–Thu sheet and one Friday
      (Friday should produce no homework / be unselectable).

---

## Files in this handoff
- `6th_Grade_Hybrid_Math_Pacing_Guide_2026-2027.xlsx` — the new pacing guide (deliverable).
- `6th_Grade_Advanced_Math_Pacing_Guide_2026-2027.xlsx` — source advanced guide (reference;
  identical calendar, includes Ch 12/13 stats that hybrid omits).
- `HYBRID_CLASS_HANDOFF.md` — this document.
