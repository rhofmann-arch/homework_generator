from __future__ import annotations
"""
Samples approved problems from the problem bank for spiral review.

Quarter boundaries (calendar-based):
  Q1: Aug 20 – Oct 17
  Q2: Oct 18 – Jan 16
  Q3: Jan 17 – Mar 20
  Q4: Mar 21 – Jun 5

Spiral review pool spec (7 bank problems; Pool D = 3 from lesson PDF):
  Pool A (3): arithmetic
  Pool B (3): geometry (2) + expressions_equations (1)
  Pool C (1): stats_probability
"""

import json, random, os
from datetime import date
from pathlib import Path

BANK_ROOT = Path(os.environ.get("PROBLEM_BANK_ROOT", "problem_bank"))


def current_quarter(for_date: date | None = None) -> int:
    d = for_date or date.today()
    m, day = d.month, d.day
    if   (m, day) >= (8, 20) and ((m, day) < (10, 18)):  return 1
    elif (m, day) >= (10, 18) or (m < 8):                 return 2  # wraps Jan
    elif (m, day) >= (1, 17) and (m, day) < (3, 21):      return 3
    else:                                                   return 4


def _load_approved(grade: int, domain: str, quarter: int, honors: bool) -> list[dict]:
    folder = BANK_ROOT / f"grade_{grade}" / domain / f"q{quarter}"
    if not folder.exists():
        return []
    out = []
    for path in folder.glob("*.json"):
        try:
            data = json.loads(path.read_text())
        except Exception:
            continue
        if not data.get("approved") or data.get("flagged"):
            continue
        if honors and not data.get("honors", False):
            continue
        out.append(data)
    return out


def _sample(pool: list[dict], n: int) -> list[dict]:
    return random.sample(pool, min(n, len(pool)))


def sample_spiral(grade: int = 6, quarter: int | None = None,
                  honors: bool = False, for_date: date | None = None) -> dict:
    q = quarter or current_quarter(for_date)
    missing = []

    arith = _load_approved(grade, "arithmetic", q, honors)
    pool_a = _sample(arith, 3)
    if not arith: missing.append("arithmetic")

    geo  = _load_approved(grade, "geometry", q, honors)
    expr = _load_approved(grade, "expressions_equations", q, honors)
    if geo and expr:
        pool_b = _sample(geo, 2) + _sample(expr, 1)
    elif geo:
        pool_b = _sample(geo, 3); missing.append("expressions_equations")
    elif expr:
        pool_b = _sample(expr, 3); missing.append("geometry")
    else:
        pool_b = []; missing += ["geometry", "expressions_equations"]

    stats  = _load_approved(grade, "stats_probability", q, honors)
    pool_c = _sample(stats, 1)
    if not stats: missing.append("stats_probability")

    return {
        "quarter": q,
        "pool_a": pool_a, "pool_b": pool_b, "pool_c": pool_c,
        "total":  len(pool_a) + len(pool_b) + len(pool_c),
        "missing": missing,
    }


def format_for_prompt(sampled: dict) -> str:
    all_problems = sampled["pool_a"] + sampled["pool_b"] + sampled["pool_c"]
    if not all_problems:
        return ""
    lines = [
        f"Use these approved bank problems as the basis for spiral review (Q{sampled['quarter']}).",
        "Vary numbers and context but preserve structure and difficulty.\n",
    ]
    for i, p in enumerate(all_problems, 1):
        lines.append(f"[{i}] Topic: {p.get('topic', '')}")
        lines.append(f"    Problem: {p.get('latex', '').strip()}")
        if p.get("answer_latex"):
            lines.append(f"    Answer: {p['answer_latex'].strip()}")
        lines.append("")
    return "\n".join(lines)
