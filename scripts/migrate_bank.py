from __future__ import annotations
#!/usr/bin/env python3
"""
One-time migration script.

1. Renames fractions_decimals → arithmetic across all grades
2. Moves every existing problem JSON into _inbox/ (stripping domain/quarter from path)
3. Updates the "domain" field inside each JSON to match if it was fractions_decimals

Run from the repo root:
    python3 scripts/migrate_bank.py --bank-root problem_bank [--dry-run]
"""

import argparse
import json
import os
import shutil
from pathlib import Path

DOMAIN_RENAME = {"fractions_decimals": "arithmetic"}


def migrate(bank_root: Path, dry_run: bool) -> None:
    if not bank_root.exists():
        print(f"Bank root not found: {bank_root}")
        return

    moved = 0
    renamed_domain = 0

    for grade_dir in sorted(bank_root.iterdir()):
        if not grade_dir.is_dir() or grade_dir.name.startswith("_"):
            continue

        inbox = grade_dir / "_inbox"
        if not dry_run:
            inbox.mkdir(exist_ok=True)
        else:
            print(f"[dry-run] Would create: {inbox}")

        # Collect all .json files under domain/quarter subfolders
        for json_path in sorted(grade_dir.rglob("*.json")):
            # Skip anything already in _inbox
            if "_inbox" in json_path.parts:
                continue

            dest = inbox / json_path.name

            # Handle filename collisions
            if dest.exists():
                stem = json_path.stem
                suffix = 1
                while dest.exists():
                    dest = inbox / f"{stem}_{suffix}.json"
                    suffix += 1

            print(f"{'[dry-run] ' if dry_run else ''}Move: {json_path.relative_to(bank_root)} → {dest.relative_to(bank_root)}")

            if not dry_run:
                # Update domain field inside JSON if it was fractions_decimals
                try:
                    data = json.loads(json_path.read_text())
                    old_domain = data.get("domain", "")
                    new_domain = DOMAIN_RENAME.get(old_domain, old_domain)
                    if new_domain != old_domain:
                        data["domain"] = new_domain
                        renamed_domain += 1
                    # Clear approved status — everything goes back to review
                    data["approved"] = False
                    dest.write_text(json.dumps(data, indent=2))
                    json_path.unlink()
                except Exception as e:
                    print(f"  ERROR reading {json_path}: {e}")
                    continue

            moved += 1

        # Rename fractions_decimals folder → arithmetic
        old_domain_dir = grade_dir / "fractions_decimals"
        new_domain_dir = grade_dir / "arithmetic"
        if old_domain_dir.exists():
            print(f"{'[dry-run] ' if dry_run else ''}Rename dir: {old_domain_dir.relative_to(bank_root)} → {new_domain_dir.relative_to(bank_root)}")
            if not dry_run:
                old_domain_dir.rename(new_domain_dir)

    print(f"\n{'[dry-run] ' if dry_run else ''}Done.")
    print(f"  Problems moved to inbox: {moved}")
    print(f"  Domain field updated (fractions_decimals → arithmetic): {renamed_domain}")

    if dry_run:
        print("\nRun without --dry-run to apply changes.")


def main():
    parser = argparse.ArgumentParser(description="Migrate problem bank to inbox-first structure")
    parser.add_argument("--bank-root", default="problem_bank", help="Path to problem_bank directory")
    parser.add_argument("--dry-run", action="store_true", help="Preview changes without writing")
    args = parser.parse_args()

    migrate(Path(args.bank_root), args.dry_run)


if __name__ == "__main__":
    main()
