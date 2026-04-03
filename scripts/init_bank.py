from __future__ import annotations
#!/usr/bin/env python3
"""
Creates the problem bank directory structure.

Usage:
    python3 scripts/init_bank.py              # Grade 6 only (default)
    python3 scripts/init_bank.py --grades 5 6 7 8
"""

import argparse
import os
from pathlib import Path

DOMAINS = [
    "arithmetic",           # Fractions, decimals, division review, integers
    "expressions_equations",
    "geometry",
    "stats_probability",
    "other",                # Useful problems that don't fit the four main domains
]

QUARTERS = ["q1", "q2", "q3", "q4"]
BANK_ROOT = Path("problem_bank")


def init_bank(grades: list[int]) -> None:
    for grade in grades:
        grade_dir = BANK_ROOT / f"grade_{grade}"

        # Inbox — all problems land here at ingest time
        inbox = grade_dir / "_inbox"
        inbox.mkdir(parents=True, exist_ok=True)
        print(f"  {inbox}")

        # Domain / quarter subfolders (populated at review time)
        for domain in DOMAINS:
            for quarter in QUARTERS:
                d = grade_dir / domain / quarter
                d.mkdir(parents=True, exist_ok=True)
                print(f"  {d}")

    print(f"\nBank initialized at: {BANK_ROOT.resolve()}")
    print(f"Grades: {grades}")
    print(f"Domains: {', '.join(DOMAINS)}")
    print(f"\nIngest sends all problems to _inbox/. Domain + quarter are assigned during review.")


def main():
    parser = argparse.ArgumentParser(description="Initialize problem bank directory structure")
    parser.add_argument("--grades", nargs="+", type=int, default=[6], help="Grade numbers to create (default: 6)")
    args = parser.parse_args()
    init_bank(args.grades)


if __name__ == "__main__":
    main()
