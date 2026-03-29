from __future__ import annotations
#!/usr/bin/env python3
"""
Ingests Overleaf honors problem zips into the problem bank.

Each zip contains main.tex with \\begin{problem}...\\end{problem} blocks.
Problems are classified by Claude (domain + quarter) and written to _inbox/
with honors=True pre-set.

Usage:
    # Dry run — preview what would be written
    python3 scripts/ingest_honors_tex.py --zip-dir ~/Downloads/Overleaf\ Projects --dry-run

    # Real run
    python3 scripts/ingest_honors_tex.py --zip-dir ~/Downloads/Overleaf\ Projects

    # Limit to first N zips for testing
    python3 scripts/ingest_honors_tex.py --zip-dir ~/Downloads/Overleaf\ Projects --limit 5
"""

import argparse
import json
import os
import re
import zipfile
import tempfile
from pathlib import Path

import anthropic

# ── Config ────────────────────────────────────────────────────────────────────

BANK_ROOT = Path(os.environ.get("PROBLEM_BANK_ROOT", "problem_bank"))
GRADE_DEFAULT = 6
MODEL = "claude-opus-4-5"
BATCH_SIZE = 10  # problems per Claude classification call

DOMAINS = [
    "arithmetic",
    "expressions_equations",
    "geometry",
    "stats_probability",
    "other",
]

# ── Claude tool schema ────────────────────────────────────────────────────────

CLASSIFY_TOOL = {
    "name": "classify_problems",
    "description": "Classify a batch of 6th grade math problems by domain and difficulty quarter.",
    "input_schema": {
        "type": "object",
        "properties": {
            "classifications": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "index": {
                            "type": "integer",
                            "description": "The index of the problem in the input list (0-based)."
                        },
                        "domain": {
                            "type": "string",
                            "enum": DOMAINS,
                            "description": (
                                "Best-fit domain. "
                                "arithmetic=fractions/decimals/integers/ratios/rates/percents; "
                                "expressions_equations=variables, expressions, one- or two-step equations; "
                                "geometry=area, perimeter, volume, angles, coordinate plane; "
                                "stats_probability=data, mean/median/mode, probability; "
                                "other=anything that doesn't fit."
                            )
                        },
                        "suggested_quarter": {
                            "type": "integer",
                            "enum": [1, 2, 3, 4],
                            "description": (
                                "Difficulty quarter for 6th grade honors. "
                                "Q1=straightforward single-step; "
                                "Q2=moderate, may involve fractions or multi-step; "
                                "Q3=challenging, multi-step or non-routine; "
                                "Q4=hardest, competition-style or highly complex."
                            )
                        },
                        "topic": {
                            "type": "string",
                            "description": "Brief topic label, e.g. 'two-step equations with fractions' or 'area of composite figures'."
                        }
                    },
                    "required": ["index", "domain", "suggested_quarter", "topic"]
                }
            }
        },
        "required": ["classifications"]
    }
}

# ── LaTeX parsing ─────────────────────────────────────────────────────────────

def extract_problem_blocks(tex: str) -> list[str]:
    """
    Extract problems from Overleaf honors format:
      \\paragraph{1. } problem text...
      \\paragraph{solution 1. } solution text...

    Returns a list of strings, one per problem, with answer appended if found.
    """
    # Strip everything before \begin{document}
    doc_match = re.search(r'\\begin\{document\}', tex)
    if doc_match:
        tex = tex[doc_match.end():]

    # Find all \paragraph{...} blocks and their content
    # Split on \paragraph to get chunks
    para_pattern = re.compile(r'\\paragraph\{([^}]*)\}')
    splits = list(para_pattern.finditer(tex))

    problems: dict[int, str] = {}   # num → problem text
    solutions: dict[int, str] = {}  # num → solution text

    for i, match in enumerate(splits):
        label = match.group(1).strip().rstrip('.')  # e.g. "1", "solution 1"
        # Content runs until the next \paragraph or \end{document}
        start = match.end()
        end = splits[i + 1].start() if i + 1 < len(splits) else len(tex)
        content = tex[start:end].strip()
        # Remove \vspace and \newpage noise
        content = re.sub(r'\\vspace\{[^}]*\}', '', content)
        content = re.sub(r'\\newpage', '', content)
        content = content.strip()

        # Remove \end{document} if it leaked into the last block
        content = re.sub(r'\\end\{document\}', '', content).strip()

        sol_match = re.match(r'solution\s+(\d+)', label, re.IGNORECASE)
        num_match = re.match(r'^(\d+)$', label)

        if sol_match:
            solutions[int(sol_match.group(1))] = content
        elif num_match:
            num = int(num_match.group(1))
            if num in problems:
                # Second occurrence of same number = unlabeled solution
                solutions[num] = content
            else:
                problems[num] = content

    # Pair problems with solutions
    blocks = []
    for num in sorted(problems.keys()):
        prob_text = problems[num]
        if not prob_text:
            continue
        sol_text = solutions.get(num, "")
        if sol_text:
            block = f"{prob_text}\n\n\\textbf{{Answer:}} {sol_text}"
        else:
            block = prob_text
        blocks.append(block)

    return blocks


def clean_latex(raw: str) -> str:
    """
    Light cleanup of extracted LaTeX:
    - Strip Overleaf boilerplate comments
    - Collapse excessive whitespace
    - Remove \\label{} tags (not useful in bank)
    """
    # Remove LaTeX comments
    raw = re.sub(r'%.*', '', raw)
    # Remove \label{...}
    raw = re.sub(r'\\label\{[^}]*\}', '', raw)
    # Collapse multiple blank lines
    raw = re.sub(r'\n{3,}', '\n\n', raw)
    return raw.strip()

# ── Claude classification ─────────────────────────────────────────────────────

def classify_batch(client: anthropic.Anthropic, problems: list[str]) -> list[dict]:
    """
    Send a batch of LaTeX problem strings to Claude for domain + quarter classification.
    Returns a list of dicts with keys: index, domain, suggested_quarter, topic.
    """
    numbered = "\n\n".join(
        f"[{i}]\n{p}" for i, p in enumerate(problems)
    )

    prompt = (
        "Below are 6th grade honors math problems in LaTeX format, numbered by index.\n"
        "Classify each one by domain, difficulty quarter, and topic.\n\n"
        f"{numbered}"
    )

    response = client.messages.create(
        model=MODEL,
        max_tokens=4096,
        tools=[CLASSIFY_TOOL],
        tool_choice={"type": "tool", "name": "classify_problems"},
        messages=[{"role": "user", "content": prompt}]
    )

    for block in response.content:
        if block.type == "tool_use" and block.name == "classify_problems":
            return block.input.get("classifications", [])

    return []

# ── ID generation ─────────────────────────────────────────────────────────────

def next_id(inbox: Path, prefix: str) -> str:
    existing = list(inbox.glob(f"{prefix}_*.json"))
    nums = []
    for f in existing:
        m = re.search(r"_(\d+)\.json$", f.name)
        if m:
            nums.append(int(m.group(1)))
    next_num = (max(nums) + 1) if nums else 1
    return f"{prefix}_{next_num:04d}"


# ── Main ingest ───────────────────────────────────────────────────────────────

def ingest(
    zip_dir: Path,
    grade: int,
    bank_root: Path,
    dry_run: bool,
    limit: int | None,
) -> None:
    client = anthropic.Anthropic()

    inbox = bank_root / f"grade_{grade}" / "_inbox"
    if not dry_run:
        inbox.mkdir(parents=True, exist_ok=True)

    zip_files = sorted(zip_dir.glob("*.zip"))
    if not zip_files:
        print(f"No .zip files found in {zip_dir}")
        return

    if limit:
        zip_files = zip_files[:limit]

    print(f"Found {len(zip_files)} zip file(s) to process.\n")

    # Step 1: extract all problem blocks from all zips
    # Each entry: (source_zip_name, raw_latex)
    all_problems: list[tuple[str, str]] = []

    for zip_path in zip_files:
        with tempfile.TemporaryDirectory() as tmpdir:
            try:
                with zipfile.ZipFile(zip_path, 'r') as zf:
                    zf.extractall(tmpdir)
            except zipfile.BadZipFile:
                print(f"  ⚠ Skipping bad zip: {zip_path.name}")
                continue

            # Find main.tex (search up to 2 levels deep)
            tex_candidates = list(Path(tmpdir).rglob("main.tex"))
            if not tex_candidates:
                print(f"  ⚠ No main.tex found in {zip_path.name}, skipping.")
                continue

            main_tex = tex_candidates[0]
            tex_content = main_tex.read_text(errors='replace')
            blocks = extract_problem_blocks(tex_content)

            if not blocks:
                print(f"  ⚠ No \\begin{{problem}} blocks in {zip_path.name}, skipping.")
                continue

            cleaned = [clean_latex(b) for b in blocks]
            all_problems.extend((zip_path.name, c) for c in cleaned)
            print(f"  {zip_path.name}: {len(cleaned)} problem(s) extracted")

    print(f"\nTotal problems extracted: {len(all_problems)}")
    if dry_run:
        print("[dry-run] Skipping Claude classification and file writes.\n")
        for src, latex in all_problems[:5]:
            print(f"  [{src}] {latex[:80]}...")
        if len(all_problems) > 5:
            print(f"  ... and {len(all_problems) - 5} more.")
        return

    # Step 2: classify in batches
    print(f"\nClassifying in batches of {BATCH_SIZE}...")
    latex_only = [latex for _, latex in all_problems]
    classifications: list[dict | None] = [None] * len(all_problems)

    for batch_start in range(0, len(all_problems), BATCH_SIZE):
        batch_end = min(batch_start + BATCH_SIZE, len(all_problems))
        batch = latex_only[batch_start:batch_end]
        print(f"  Batch {batch_start//BATCH_SIZE + 1}: problems {batch_start}–{batch_end-1}...", end=" ", flush=True)

        results = classify_batch(client, batch)
        for r in results:
            global_idx = batch_start + r["index"]
            if global_idx < len(classifications):
                classifications[global_idx] = r

        print(f"{len(results)} classified")

    # Step 3: write JSON files
    id_prefix = f"hon_g{grade}"
    written = 0
    skipped = 0

    for i, ((source_zip, latex), classification) in enumerate(zip(all_problems, classifications)):
        if classification is None:
            print(f"  ⚠ No classification returned for problem {i} ({source_zip}), skipping.")
            skipped += 1
            continue

        prob_id = next_id(inbox, id_prefix)

        record = {
            "id": prob_id,
            "domain": None,                              # Assigned during review
            "grade": grade,
            "quarter": None,                             # Assigned during review
            "topic": classification.get("topic", ""),
            "latex": latex,
            "answer_latex": "",                          # Not in source tex
            "suggested_quarter": classification.get("suggested_quarter"),
            "suggested_domain": classification.get("domain"),  # hint for review UI
            "source_file": source_zip,
            "source_problem_number": None,
            "honors": True,
            "approved": False,
            "flagged": False,
            "notes": "",
        }

        dest = inbox / f"{prob_id}.json"
        dest.write_text(json.dumps(record, indent=2))
        print(f"  Wrote {dest.name}  |  {record['suggested_domain']}  |  Q{record['suggested_quarter']}  |  {record['topic']}")
        written += 1

    print(f"\n✓ Done. {written} problems written to {inbox}")
    if skipped:
        print(f"  {skipped} problems skipped (classification failed).")
    print("\nNext step: open the review UI (localhost) to confirm domain + quarter and approve.")


# ── CLI ───────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Ingest Overleaf honors problem zips into the bank")
    parser.add_argument("--zip-dir", required=True, help="Folder containing the .zip files")
    parser.add_argument("--grade", type=int, default=GRADE_DEFAULT)
    parser.add_argument("--bank-root", default=str(BANK_ROOT))
    parser.add_argument("--dry-run", action="store_true", help="Preview without Claude calls or file writes")
    parser.add_argument("--limit", type=int, default=None, help="Process only the first N zips (for testing)")
    args = parser.parse_args()

    ingest(
        zip_dir=Path(args.zip_dir).expanduser(),
        grade=args.grade,
        bank_root=Path(args.bank_root),
        dry_run=args.dry_run,
        limit=args.limit,
    )


if __name__ == "__main__":
    main()
