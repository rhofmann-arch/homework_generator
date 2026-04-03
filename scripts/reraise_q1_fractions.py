#!/usr/bin/env python3
"""
Move Q1 arithmetic problems that involve fraction computation back to the
inbox for re-review. Run from the repo root.

Usage:
    python3 scripts/reraise_q1_fractions.py --dry-run   # preview only
    python3 scripts/reraise_q1_fractions.py             # apply

What it does:
  - Scans problem_bank/grade_6/arithmetic/q1/
  - Identifies problems whose topic or latex contains fraction keywords
  - Moves matches back to _inbox/ with approved=False so they appear in
    the review UI (no data is lost — just re-queued)

After running, open the review UI and re-approve each problem at Q2
(or delete it if it doesn't belong at all).
"""

from __future__ import annotations
import argparse
import json
import shutil
from pathlib import Path

BANK_ROOT   = Path("problem_bank")
GRADE       = 6
SOURCE_DIR  = BANK_ROOT / f"grade_{GRADE}" / "arithmetic" / "q1"
INBOX_DIR   = BANK_ROOT / f"grade_{GRADE}" / "_inbox"

# Keywords that suggest fraction computation (case-insensitive match on
# the topic field first, then the latex field as a fallback).
# Edit this list if you want to catch more or fewer problems.
FRACTION_KEYWORDS = [
    "fraction",
    "fractions",
    r"\frac",       # LaTeX fraction command
    "numerator",
    "denominator",
    "mixed number",
    "mixed numbers",
    "improper fraction",
    "simplify",     # often means simplifying a fraction
    "simplest form",
    "equivalent fraction",
]


def is_fraction_problem(data: dict) -> bool:
    topic = (data.get("topic") or "").lower()
    latex = (data.get("latex") or "").lower()

    for kw in FRACTION_KEYWORDS:
        kw_lower = kw.lower()
        if kw_lower in topic or kw_lower in latex:
            return True
    return False


def main():
    parser = argparse.ArgumentParser(
        description="Move fraction computation problems from Q1 arithmetic to inbox."
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Print what would move without touching files."
    )
    parser.add_argument(
        "--bank-root", default=str(BANK_ROOT),
        help=f"Path to problem_bank directory (default: {BANK_ROOT})"
    )
    args = parser.parse_args()

    source = Path(args.bank_root) / f"grade_{GRADE}" / "arithmetic" / "q1"
    inbox  = Path(args.bank_root) / f"grade_{GRADE}" / "_inbox"

    if not source.exists():
        print(f"Source folder not found: {source}")
        print("Are you running from the repo root?")
        return

    if not args.dry_run:
        inbox.mkdir(parents=True, exist_ok=True)

    matched = []
    skipped = []

    for json_file in sorted(source.glob("*.json")):
        try:
            data = json.loads(json_file.read_text())
        except Exception as e:
            print(f"  SKIP (parse error): {json_file.name} — {e}")
            continue

        if is_fraction_problem(data):
            matched.append((json_file, data))
        else:
            skipped.append(json_file.name)

    print(f"\nFound {len(matched)} fraction problems in {source}")
    print(f"Keeping {len(skipped)} non-fraction problems in Q1\n")

    if not matched:
        print("Nothing to move.")
        return

    print("Problems to move to inbox:")
    for json_file, data in matched:
        marker = "[dry-run] " if args.dry_run else ""
        print(f"  {marker}{json_file.name}")
        print(f"    topic : {data.get('topic', '(none)')}")
        print(f"    latex : {data.get('latex', '')[:70]}...")

    if args.dry_run:
        print(f"\n[dry-run] Would move {len(matched)} files to {inbox}")
        print("Run without --dry-run to apply.")
        return

    moved = 0
    for json_file, data in matched:
        # Reset to un-approved so it shows up in the review queue
        data["approved"] = False
        data["domain"]   = None
        data["quarter"]  = None

        dest = inbox / json_file.name
        # Avoid collision if a file with this name already exists in inbox
        if dest.exists():
            stem = json_file.stem + "_q1"
            dest = inbox / f"{stem}.json"

        dest.write_text(json.dumps(data, indent=2))
        json_file.unlink()
        moved += 1

    print(f"\nMoved {moved} problems to {inbox}")
    print("Next: open the review UI, set domain=arithmetic, approve each at Q2.")
    print("Commit when done:")
    print("  git add problem_bank/ && git commit -m 'Re-review: moved Q1 fractions to Q2'")


if __name__ == "__main__":
    main()
