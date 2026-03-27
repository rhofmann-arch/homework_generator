#!/usr/bin/env python3
"""
scripts/init_bank.py

Creates the problem_bank directory tree for all supported grades.
Safe to re-run — skips directories that already exist.

Usage (from repo root):
    python scripts/init_bank.py            # grade 6 only
    python scripts/init_bank.py --grades 5 6 7 8
"""

import os
import argparse

DOMAINS = [
    "fractions_decimals",
    "expressions_equations",
    "geometry",
    "stats_probability",
]

QUARTERS = ["q1", "q2", "q3", "q4"]


def init_bank(bank_root: str, grades: list[int]) -> None:
    created = 0
    for grade in grades:
        for domain in DOMAINS:
            for quarter in QUARTERS:
                path = os.path.join(bank_root, f"grade_{grade}", domain, quarter)
                if not os.path.exists(path):
                    os.makedirs(path)
                    # Add a .gitkeep so empty dirs are tracked by git
                    with open(os.path.join(path, ".gitkeep"), "w") as f:
                        pass
                    print(f"  created  {path}")
                    created += 1
                else:
                    print(f"  exists   {path}")

    if created:
        print(f"\n✅  Created {created} new directories.")
    else:
        print("\n✅  All directories already exist — nothing to do.")


if __name__ == "__main__":
    repo_root = os.path.join(os.path.dirname(__file__), "..")
    default_bank_root = os.path.join(repo_root, "problem_bank")

    parser = argparse.ArgumentParser(description="Initialize problem_bank directory tree")
    parser.add_argument(
        "--bank-root",
        default=default_bank_root,
        help="Path to problem_bank root (default: ./problem_bank)",
    )
    parser.add_argument(
        "--grades",
        nargs="+",
        type=int,
        default=[6],
        help="Grade levels to initialize (default: 6)",
    )
    args = parser.parse_args()

    print(f"Initializing problem bank at: {os.path.abspath(args.bank_root)}")
    print(f"Grades: {args.grades}\n")
    init_bank(args.bank_root, args.grades)
