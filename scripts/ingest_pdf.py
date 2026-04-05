#!/usr/bin/env python3
from __future__ import annotations
"""
Ingests a DeltaMath (or practice pages) PDF into the problem bank.

ALL problems land in _inbox/ regardless of domain. Domain and quarter
are assigned during the teacher review session, not at ingest time.

Requirements:
    pip install anthropic pillow
    brew install poppler   # for pdftoppm

Usage:
    python3 scripts/ingest_pdf.py --pdf uploads/Equations.pdf
    python3 scripts/ingest_pdf.py --pdf uploads/Equations.pdf --key-pdf uploads/Equations_KEY.pdf
    python3 scripts/ingest_pdf.py --pdf uploads/Equations.pdf --dry-run
    python3 scripts/ingest_pdf.py --pdf uploads/Equations.pdf --grade 6 --bank-root problem_bank
"""

import argparse
import base64
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path

import anthropic

# ── Config ────────────────────────────────────────────────────────────────────

BANK_ROOT = Path(os.environ.get("PROBLEM_BANK_ROOT", "problem_bank"))
GRADE_DEFAULT = 6
MODEL = "claude-opus-4-5"

DOMAINS = [
    "arithmetic",
    "expressions_equations",
    "geometry",
    "stats_probability",
    "other",
]

# ── Claude tool schema ────────────────────────────────────────────────────────

EXTRACT_TOOL = {
    "name": "extract_problems",
    "description": "Extract all math problems visible on this page into structured JSON.",
    "input_schema": {
        "type": "object",
        "properties": {
            "problems": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "problem_number": {
                            "type": "integer",
                            "description": "Problem number as printed on the page"
                        },
                        "latex": {
                            "type": "string",
                            "description": "Full problem in LaTeX. Use $...$ for inline math, $$...$$ for display math. Include any written instructions (e.g. 'Find the value of x.'). If the problem contains a geometric figure, number line, coordinate plane, table, or any diagram, reproduce it using a TikZ environment (\\begin{tikzpicture}...\\end{tikzpicture}). Place the diagram where it appears relative to the problem text. Do not use \\includegraphics or reference external files."
                        },
                        "answer_latex": {
                            "type": "string",
                            "description": "Answer in LaTeX if known (from key PDF or clearly shown). Empty string if unknown."
                        },
                        "suggested_quarter": {
                            "type": "integer",
                            "enum": [1, 2, 3, 4],
                            "description": "Suggested difficulty quarter. Q1=simplest, Q4=hardest. Base on problem complexity, not page position."
                        },
                        "topic_description": {
                            "type": "string",
                            "description": "Brief topic label, e.g. 'one-step addition equation, whole numbers' or 'area of composite figures'."
                        }
                    },
                    "required": ["problem_number", "latex", "answer_latex", "suggested_quarter", "topic_description"]
                }
            }
        },
        "required": ["problems"]
    }
}

# ── Helpers ───────────────────────────────────────────────────────────────────

def rasterize_pdf(pdf_path: Path, dpi: int = 150) -> list[Path]:
    """Convert PDF pages to PNG images using pdftoppm."""
    with tempfile.TemporaryDirectory() as tmpdir:
        prefix = Path(tmpdir) / "page"
        result = subprocess.run(
            ["pdftoppm", "-r", str(dpi), "-png", str(pdf_path), str(prefix)],
            capture_output=True, text=True
        )
        if result.returncode != 0:
            raise RuntimeError(f"pdftoppm failed: {result.stderr}")

        pages = sorted(Path(tmpdir).glob("page-*.png"))
        # Copy out of tempdir before it's cleaned up
        out_dir = Path(tempfile.mkdtemp())
        kept = []
        for p in pages:
            dest = out_dir / p.name
            dest.write_bytes(p.read_bytes())
            kept.append(dest)
        return kept


def image_to_base64(path: Path) -> str:
    return base64.standard_b64encode(path.read_bytes()).decode()


def extract_problems_from_page(
    client: anthropic.Anthropic,
    page_image: Path,
    key_image: Path | None = None,
) -> list[dict]:
    """Send a page image (+ optional key page) to Claude and extract problems."""

    content = []

    content.append({
        "type": "image",
        "source": {"type": "base64", "media_type": "image/png", "data": image_to_base64(page_image)}
    })

    if key_image and key_image.exists():
        content.append({
            "type": "text",
            "text": "This is the student worksheet. The next image is the answer key for the same page. Use the key to fill in answer_latex for each problem."
        })
        content.append({
            "type": "image",
            "source": {"type": "base64", "media_type": "image/png", "data": image_to_base64(key_image)}
        })

    content.append({
        "type": "text",
        "text": (
            "Extract every math problem visible on this worksheet page. "
            "For each problem: capture the full problem in LaTeX (including any written instructions), "
            "suggest a difficulty quarter (Q1=simplest, Q4=hardest), "
            "IMPORTANT: If any problem includes a diagram, figure, number line, coordinate plane, "
            "table, or geometric shape, reproduce it faithfully using TikZ "
            "(\\begin{tikzpicture}...\\end{tikzpicture}) placed inline with the problem text. "
            "Do not skip diagrams or replace them with placeholder text. "
            "Write a brief topic description for each problem. "
            "If an answer key was provided, fill in the answer. "
            "Return ALL problems — do not skip any."
        )
    })

    response = client.messages.create(
        model=MODEL,
        max_tokens=8192,
        tools=[EXTRACT_TOOL],
        tool_choice={"type": "tool", "name": "extract_problems"},
        messages=[{"role": "user", "content": content}]
    )

    for block in response.content:
        if block.type == "tool_use" and block.name == "extract_problems":
            return block.input.get("problems", [])

    return []


def next_id(inbox: Path, prefix: str) -> str:
    """Generate the next sequential ID in the inbox: eq_6_0001, eq_6_0002, ..."""
    existing = list(inbox.glob(f"{prefix}_*.json"))
    nums = []
    for f in existing:
        m = re.search(r"_(\d+)\.json$", f.name)
        if m:
            nums.append(int(m.group(1)))
    next_num = (max(nums) + 1) if nums else 1
    return f"{prefix}_{next_num:04d}"


def domain_prefix(domain: str | None) -> str:
    prefixes = {
        "arithmetic": "ar",
        "expressions_equations": "eq",
        "geometry": "ge",
        "stats_probability": "sp",
        "other": "ot",
    }
    return prefixes.get(domain or "", "xx")


# ── Main ──────────────────────────────────────────────────────────────────────

def ingest(
    pdf_path: Path,
    key_pdf_path: Path | None,
    grade: int,
    bank_root: Path,
    dry_run: bool,
    lesson: str | None = None,
    honors: bool = False,
    high_priority: bool = False,
) -> None:
    client = anthropic.Anthropic()

    inbox = bank_root / f"grade_{grade}" / "_inbox"
    if not dry_run:
        inbox.mkdir(parents=True, exist_ok=True)

    print(f"Rasterizing {pdf_path.name}...")
    if lesson:
        print(f"Lesson tag: {lesson}  (all problems will be tagged lesson='{lesson}')")
    if honors:
        print("Honors: True  (all problems will be tagged honors=True)")
    if high_priority:
        print("High Priority: True  (all problems will be tagged high_priority=True)")
    pages = rasterize_pdf(pdf_path)

    key_pages: list[Path | None] = [None] * len(pages)
    if key_pdf_path:
        print(f"Rasterizing key {key_pdf_path.name}...")
        kp = rasterize_pdf(key_pdf_path)
        for i, kpage in enumerate(kp):
            if i < len(key_pages):
                key_pages[i] = kpage

    all_problems = []
    for i, page in enumerate(pages):
        print(f"  Page {i+1}/{len(pages)}...", end=" ", flush=True)
        problems = extract_problems_from_page(client, page, key_pages[i])
        print(f"{len(problems)} problems found")
        all_problems.extend(problems)

    print(f"\nTotal extracted: {len(all_problems)} problems")
    print(f"Destination: {inbox}\n")

    # Use lesson number in ID when available (e.g. les_2p5_g6_0001)
    # Otherwise fall back to source file stem
    if lesson:
        lesson_slug = re.sub(r"\.", "p", lesson)  # "2.5" → "2p5"
        id_prefix = f"les_{lesson_slug}_g{grade}"
    else:
        file_stem = re.sub(r"[^a-z0-9]", "", pdf_path.stem.lower())[:6]
        id_prefix = f"in_{file_stem}_g{grade}"

    for prob in all_problems:
        prob_id = next_id(inbox, id_prefix)

        record = {
            "id": prob_id,
            "domain": None,           # Assigned during review
            "grade": grade,
            "quarter": None,          # Assigned during review
            "lesson": lesson,         # e.g. "2.5" — None for non-lesson PDFs
            "topic": prob.get("topic_description", ""),
            "latex": prob.get("latex", ""),
            "answer_latex": prob.get("answer_latex", ""),
            "suggested_quarter": prob.get("suggested_quarter"),
            "source_file": pdf_path.name,
            "source_problem_number": prob.get("problem_number"),
            "approved": False,
            "flagged": False,
            "honors": honors,
            "high_priority": high_priority,
            "notes": "",
        }

        dest = inbox / f"{prob_id}.json"

        if dry_run:
            print(f"[dry-run] Would write: {dest.name}")
            print(f"          lesson: {record['lesson']}")
            print(f"          topic: {record['topic']}")
            print(f"          latex: {record['latex'][:60]}...")
        else:
            dest.write_text(json.dumps(record, indent=2))
            lesson_tag = f"  lesson={lesson}" if lesson else ""
            print(f"Wrote: {dest.name}  |  Q{record['suggested_quarter']}  |  {record['topic']}{lesson_tag}")

    if dry_run:
        print(f"\n[dry-run] Would write {len(all_problems)} files to {inbox}")
        print("Run without --dry-run to apply.")
    else:
        print(f"\nIngested {len(all_problems)} problems → {inbox}")
        if lesson:
            print(f"All problems tagged lesson='{lesson}'. After bank review/approval,")
            print(f"they will appear as back-page templates when lesson {lesson} is current.")
        else:
            print("Next step: run the review UI to assign domain + quarter and approve.")


def main():
    parser = argparse.ArgumentParser(description="Ingest a PDF into the problem bank inbox")
    parser.add_argument("--pdf", required=True, help="Path to student worksheet PDF")
    parser.add_argument("--key-pdf", help="Path to answer key PDF (optional)")
    parser.add_argument("--lesson", default=None,
                        help="Lesson number to tag problems with, e.g. --lesson 2.5. "
                             "When set, all problems are tagged lesson='2.5' and will "
                             "be used as back-page templates when that lesson is current.")
    parser.add_argument("--grade", type=int, default=GRADE_DEFAULT, help=f"Grade number (default: {GRADE_DEFAULT})")
    parser.add_argument("--bank-root", default=str(BANK_ROOT), help="Path to problem_bank directory")
    parser.add_argument("--dry-run", action="store_true", help="Preview without writing files")
    parser.add_argument("--honors", action="store_true", help="Tag all problems honors=True")
    parser.add_argument("--high-priority", action="store_true", help="Tag all problems high_priority=True")
    args = parser.parse_args()

    ingest(
        pdf_path=Path(args.pdf),
        key_pdf_path=Path(args.key_pdf) if args.key_pdf else None,
        grade=args.grade,
        bank_root=Path(args.bank_root),
        dry_run=args.dry_run,
        lesson=args.lesson,
        honors=args.honors,
        high_priority=args.high_priority,
    )


if __name__ == "__main__":
    main()
