from __future__ import annotations
#!/usr/bin/env python3
"""
End-to-end test: pacing → Claude API → LaTeX → PDF
Requires ANTHROPIC_API_KEY to be set.

Usage (from repo root):
    export ANTHROPIC_API_KEY=sk-ant-...
    python scripts/test_e2e.py

Optional args:
    python scripts/test_e2e.py --week 2026-09-21 --grade 6 --type honors
    python scripts/test_e2e.py --week 2026-09-21 --grade 6 --type grade_level
"""

import sys, os, asyncio, argparse, json
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))

def check_env():
    key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not key or not key.startswith("sk-"):
        print("ERROR: ANTHROPIC_API_KEY not set or invalid.")
        print("  export ANTHROPIC_API_KEY=sk-ant-...")
        sys.exit(1)

async def run(week: str, grade: str, class_type: str):
    from services.pacing import get_week_context
    from services.claude_service import generate_problems
    from services.latex_builder import build_pdf

    print(f"\n{'='*60}")
    print(f"  Grade {grade} · {class_type} · {week}")
    print(f"{'='*60}")

    # ── Step 1: Pacing ────────────────────────────────────────
    print("\n[1/3] Reading pacing guide...")
    ctx = get_week_context(week_start=week, grade=grade)
    print(f"  HW days:         {[d['day_num'] for d in ctx.hw_days]}")
    print(f"  Current lessons: {ctx.current_lessons}")
    print(f"  Covered topics:  {ctx.covered_topics[-5:]} (last 5 of {len(ctx.covered_topics)})")

    if not ctx.current_lessons:
        print("  WARNING: No current lessons found for this week. Check the date.")
        return

    # ── Step 2: Claude ────────────────────────────────────────
    print("\n[2/3] Calling Claude API...")
    print("  (front + challenge concurrent, then back — ~15-20 sec)")
    problems = await generate_problems(context=ctx, class_type=class_type)

    print(f"  Spiral topics:   {problems['spiral_topics']}")
    print(f"  Lesson title:    {problems['lesson_title']}")
    print(f"  Front problems:  {len(problems['front_problems'])}")
    print(f"  Back problems:   {len(problems['back_problems'])}")
    print(f"  Challenge:       {len(problems['challenge_problems'])}")

    # Show first problem from each section for a quick sanity check
    if problems['front_problems']:
        print(f"\n  Front #1 preview:")
        print(f"    {problems['front_problems'][0]['latex'][:120]}")
    if problems['back_problems']:
        print(f"\n  Back #1 preview:")
        print(f"    {problems['back_problems'][0]['latex'][:120]}")
    if problems['challenge_problems']:
        print(f"\n  Challenge #1 preview:")
        print(f"    {problems['challenge_problems'][0]['latex'][:120]}")

    # ── Step 3: Compile ───────────────────────────────────────
    print("\n[3/3] Compiling LaTeX → PDF...")
    pdf_path = await build_pdf(context=ctx, problems=problems, class_type=class_type)

    import shutil
    dest = f"/tmp/hw_e2e_grade{grade}_{class_type}_{week}.pdf"
    shutil.copy(pdf_path, dest)

    size_kb = os.path.getsize(dest) // 1024
    print(f"\n✅  Success! PDF saved to: {dest}  ({size_kb} KB)")
    print("    Open with:  open " + dest)
    print()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--week",  default="2026-09-21", help="Monday of target week (YYYY-MM-DD)")
    parser.add_argument("--grade", default="6",          help="Grade level (5-8)")
    parser.add_argument("--type",  default="honors",     dest="class_type",
                        choices=["honors", "grade_level"])
    args = parser.parse_args()

    check_env()
    asyncio.run(run(week=args.week, grade=args.grade, class_type=args.class_type))
