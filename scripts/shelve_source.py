from __future__ import annotations
"""
Move inbox problems from specific source PDFs to a holding shelf,
or restore them back to the inbox.

Usage:
  # Shelve problems from specific PDFs:
  python3 scripts/shelve_source.py --shelve "Honors Math 6 13.zip" "Honors Math 6 12.zip"

  # Shelve ALL problems whose source_file contains "Honors Math 6":
  python3 scripts/shelve_source.py --shelve --match "Honors Math 6"

  # List what's on the shelf:
  python3 scripts/shelve_source.py --list

  # Restore everything from the shelf back to inbox:
  python3 scripts/shelve_source.py --restore

  # Restore only specific source:
  python3 scripts/shelve_source.py --restore --match "Honors Math 6 13"
"""

import argparse
import json
import shutil
from pathlib import Path

BANK_ROOT  = Path("problem_bank")
INBOX      = BANK_ROOT / "grade_6" / "_inbox"
SHELF      = BANK_ROOT / "grade_6" / "_shelf"


def load(p: Path) -> dict:
    return json.loads(p.read_text())


def shelve_problems(match: str, dry_run: bool = False):
    SHELF.mkdir(parents=True, exist_ok=True)
    moved = 0
    for f in sorted(INBOX.glob("*.json")):
        data = load(f)
        src = data.get("source_file", "")
        if match.lower() in src.lower():
            dest = SHELF / f.name
            print(f"  {'[dry]' if dry_run else 'MOVE'} {f.name}  ({src})")
            if not dry_run:
                shutil.move(str(f), str(dest))
            moved += 1
    print(f"\n{'Would move' if dry_run else 'Moved'} {moved} problems to _shelf/")


def list_shelf():
    if not SHELF.exists():
        print("Shelf is empty (folder doesn't exist).")
        return
    files = sorted(SHELF.glob("*.json"))
    if not files:
        print("Shelf is empty.")
        return
    # Count by source
    counts: dict[str, int] = {}
    for f in files:
        src = load(f).get("source_file", "unknown")
        counts[src] = counts.get(src, 0) + 1
    print(f"{len(files)} problems on shelf:\n")
    for src, n in sorted(counts.items()):
        print(f"  {n:3d}  {src}")


def restore_problems(match: str | None, dry_run: bool = False):
    if not SHELF.exists():
        print("Shelf is empty.")
        return
    INBOX.mkdir(parents=True, exist_ok=True)
    moved = 0
    for f in sorted(SHELF.glob("*.json")):
        if match:
            src = load(f).get("source_file", "")
            if match.lower() not in src.lower():
                continue
        dest = INBOX / f.name
        print(f"  {'[dry]' if dry_run else 'RESTORE'} {f.name}")
        if not dry_run:
            shutil.move(str(f), str(dest))
        moved += 1
    print(f"\n{'Would restore' if dry_run else 'Restored'} {moved} problems to _inbox/")


def main():
    parser = argparse.ArgumentParser(description="Shelve/restore inbox problems by source PDF.")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--shelve",   action="store_true", help="Move matching problems to shelf")
    group.add_argument("--restore",  action="store_true", help="Move problems from shelf back to inbox")
    group.add_argument("--list",     action="store_true", help="List what's on the shelf")
    parser.add_argument("--match",   type=str, default=None,
                        help="Substring to match against source_file (case-insensitive)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Show what would happen without moving files")
    args = parser.parse_args()

    if args.list:
        list_shelf()
    elif args.shelve:
        if not args.match:
            parser.error("--shelve requires --match")
        print(f"Shelving problems matching: '{args.match}'\n")
        shelve_problems(args.match, dry_run=args.dry_run)
    elif args.restore:
        suffix = f" (match: '{args.match}')" if args.match else " (all)"
        print(f"Restoring from shelf{suffix}...\n")
        restore_problems(args.match, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
