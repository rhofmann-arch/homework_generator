from __future__ import annotations
#!/usr/bin/env python3
"""
Quick local smoke test.  Run from the repo root:
  python scripts/test_pacing.py

Prints the week context for the first homework week in the pacing guide.
Does NOT call the Claude API or compile LaTeX.
"""

import sys
sys.path.insert(0, 'backend')

from services.pacing import get_week_context

week = "2026-08-24"   # First real homework week
ctx = get_week_context(week_start=week, grade="6")

print(f"Week start:        {ctx.week_start}")
print(f"HW days:           {ctx.hw_days}")
print(f"Current lessons:   {ctx.current_lessons}")
print(f"Covered topics:    {ctx.covered_topics[:10]}  ...")
print(f"Lesson title:      {ctx.lesson_title}")
print(f"HW numbers:        {ctx.hw_numbers}")
