#!/usr/bin/env python3
"""
scripts/ingest_pdf.py

Ingests a DeltaMath PDF into the problem bank.

Rasterizes each page → sends to Claude vision with tool_use →
extracts structured problems → writes one JSON file per problem
into problem_bank/grade_{N}/{domain}/q{quarter}/

Usage (from repo root):
    python scripts/ingest_pdf.py \\
        --pdf uploads/Equations.pdf \\
        --domain expressions_equations

    # With answer key (recommended — fills answer_latex automatically)
    python scripts/ingest_pdf.py \\
        --pdf uploads/Equations.pdf \\
        --key-pdf uploads/Equations__KEY.pdf \\
        --domain expressions_equations

    # Different grade (default is 6)
    python scripts/ingest_pdf.py \\
        --pdf uploads/Geometry.pdf \\
        --domain geometry \\
        --grade 7

    # Dry run — prints what would be written, creates no files
    python scripts/ingest_pdf.py \\
        --pdf uploads/Decimal_Practice.pdf \\
        --domain fractions_decimals \\
        --dry-run

Dependencies:
    pip install anthropic pypdf
    System: pdftoppm (from poppler-utils: apt install poppler-utils)

Environment:
    ANTHROPIC_API_KEY must be set.
"""

import os
import sys
import json
import base64
import argparse
import subprocess
import tempfile
import glob
from pathlib import Path
from typing import Optional

# ── Domain config ─────────────────────────────────────────────────────────────

VALID_DOMAINS = [
    "fractions_decimals",
    "expressions_equations",
    "geometry",
    "stats_probability",
]

# Short prefix used in problem IDs, e.g. "eq_6q1_0001"
DOMAIN_ABBREV = {
    "fractions_decimals":     "fd",
    "expressions_equations":  "eq",
    "geometry":               "geo",
    "stats_probability":      "sp",
}

# Per-domain quarter guidance given to Claude for auto-suggestion.
# Describes what skills belong in each quarter for 6th grade.
QUARTER_GUIDANCE_6 = {
    "fractions_decimals": """
Q1: Whole-number decimals, place value, comparing/ordering decimals, simple fraction addition and subtraction with like denominators.
Q2: Decimal multiplication and division, mixed numbers, fraction addition/subtraction with unlike denominators.
Q3: Multi-step decimal and fraction problems, negatives with fractions/decimals, fraction equations.
Q4: Hardest variants — multi-step problems combining fractions and decimals, complex word problems requiring multiple operations.
""",
    "expressions_equations": """
Q1: Writing expressions from words, identifying parts of expressions (terms, coefficients, constants), one-step equations with whole numbers (addition/subtraction only).
Q2: One-step equations with fractions or decimals, evaluating expressions by substitution, multiplication/division one-step equations.
Q3: Two-step equations, distributive property, writing equations from word problems.
Q4: Multi-step equations, combining like terms, harder applications and word problems.
""",
    "geometry": """
Q1: Classifying shapes, basic area of rectangles and triangles, perimeter.
Q2: Area of parallelograms, trapezoids, composite figures. Surface area of rectangular prisms.
Q3: Volume of rectangular prisms, coordinate geometry (plotting, distance).
Q4: Complex composite area/volume problems, nets of 3D figures, multi-step geometry word problems.
""",
    "stats_probability": """
Q1: Reading and interpreting bar graphs, line plots, dot plots. Mean, median, mode with whole numbers.
Q2: Mean absolute deviation, histograms, frequency tables. Mean/median with decimals and larger data sets.
Q3: Box-and-whisker plots, interquartile range, comparing data distributions.
Q4: Multi-step statistical questions, combining probability concepts, complex data interpretation.
""",
}


# ── Tool schema for Claude ─────────────────────────────────────────────────────

EXTRACT_TOOL = {
    "name": "extract_problems",
    "description": (
        "Extract every math problem visible on this page image. "
        "Return ALL problems — do not skip any. "
        "For each problem, provide the complete problem text as LaTeX, "
        "the answer as LaTeX, a suggested difficulty quarter (1–4), "
        "and a brief topic description."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "problems": {
                "type": "array",
                "description": "All problems extracted from this page. Empty array if no problems found.",
                "items": {
                    "type": "object",
                    "properties": {
                        "problem_number": {
                            "type": "integer",
                            "description": "The problem number as printed on the page.",
                        },
                        "latex": {
                            "type": "string",
                            "description": (
                                "The complete problem statement as LaTeX. "
                                "Include all text and math. Use $...$ for inline math "
                                "and $$...$$ or \\[...\\] for display math. "
                                "If the problem includes a diagram or number line that "
                                "cannot be expressed in LaTeX, write [DIAGRAM] as a placeholder."
                            ),
                        },
                        "answer_latex": {
                            "type": "string",
                            "description": (
                                "The answer as LaTeX. Leave empty string if this is a "
                                "problem page (not a key page)."
                            ),
                        },
                        "suggested_quarter": {
                            "type": "integer",
                            "enum": [1, 2, 3, 4],
                            "description": (
                                "Difficulty placement quarter (1=easiest, 4=hardest). "
                                "Use the quarter guidance provided in the system prompt."
                            ),
                        },
                        "topic_description": {
                            "type": "string",
                            "description": (
                                "Brief description of the skill this problem tests, "
                                "e.g. 'one-step addition equation, whole numbers' or "
                                "'area of a trapezoid'."
                            ),
                        },
                    },
                    "required": [
                        "problem_number",
                        "latex",
                        "answer_latex",
                        "suggested_quarter",
                        "topic_description",
                    ],
                },
            }
        },
        "required": ["problems"],
    },
}


# ── Helpers ────────────────────────────────────────────────────────────────────

def get_page_count(pdf_path: str) -> int:
    from pypdf import PdfReader
    return len(PdfReader(pdf_path).pages)


def rasterize_page(pdf_path: str, page_num: int, dpi: int = 150) -> bytes:
    """
    Rasterize a single PDF page (1-indexed) to JPEG bytes using pdftoppm.
    Returns the raw JPEG bytes.
    """
    with tempfile.TemporaryDirectory() as tmpdir:
        prefix = os.path.join(tmpdir, "page")
        subprocess.run(
            [
                "pdftoppm",
                "-jpeg",
                "-r", str(dpi),
                "-f", str(page_num),
                "-l", str(page_num),
                pdf_path,
                prefix,
            ],
            check=True,
            capture_output=True,
        )
        # pdftoppm zero-pads based on total page count — find the file
        files = sorted(glob.glob(f"{prefix}-*.jpg"))
        if not files:
            raise RuntimeError(f"pdftoppm produced no output for page {page_num} of {pdf_path}")
        with open(files[0], "rb") as f:
            return f.read()


def call_claude_extract(client, image_bytes: bytes, domain: str, grade: int) -> list[dict]:
    """
    Send one page image to Claude with tool_use forced.
    Returns a list of extracted problem dicts.
    """
    quarter_guidance = QUARTER_GUIDANCE_6.get(domain, "")

    system_prompt = f"""You are extracting math problems from a DeltaMath worksheet page image.

Domain: {domain.replace("_", " ").title()}
Grade: {grade}

Quarter difficulty guidance for this domain:
{quarter_guidance}

Instructions:
- Extract EVERY numbered problem on the page. Do not skip any.
- Convert all math to LaTeX. Use $...$ for inline math.
- For diagrams, coordinate planes, or number lines that cannot be expressed in LaTeX, write [DIAGRAM] as a placeholder.
- Assign suggested_quarter based on the difficulty guidance above.
- If this is a KEY/answer page, extract the answers into answer_latex. Otherwise leave answer_latex as empty string.
- The problem_number should match the printed number on the page."""

    response = client.messages.create(
        model="claude-opus-4-5",
        max_tokens=4096,
        system=system_prompt,
        tools=[EXTRACT_TOOL],
        tool_choice={"type": "tool", "name": "extract_problems"},
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": "image/jpeg",
                            "data": base64.standard_b64encode(image_bytes).decode("utf-8"),
                        },
                    },
                    {
                        "type": "text",
                        "text": "Extract all problems from this page.",
                    },
                ],
            }
        ],
    )

    # tool_choice forces the first (and only) content block to be tool_use
    for block in response.content:
        if block.type == "tool_use" and block.name == "extract_problems":
            return block.input.get("problems", [])

    return []


def next_seq_number(bank_dir: str) -> int:
    """
    Find the next available sequence number across ALL quarters for this domain+grade.
    Scans existing JSON filenames to avoid collisions.
    """
    max_seq = 0
    for json_file in Path(bank_dir).rglob("*.json"):
        stem = json_file.stem  # e.g. "eq_6q1_0042"
        parts = stem.split("_")
        if len(parts) >= 3:
            try:
                seq = int(parts[-1])
                max_seq = max(max_seq, seq)
            except ValueError:
                pass
    return max_seq + 1


def build_problem_id(domain: str, grade: int, quarter: int, seq: int) -> str:
    abbrev = DOMAIN_ABBREV.get(domain, domain[:3])
    return f"{abbrev}_{grade}q{quarter}_{seq:04d}"


# ── Main ───────────────────────────────────────────────────────────────────────

def ingest(
    pdf_path: str,
    domain: str,
    grade: int,
    bank_root: str,
    key_pdf_path: Optional[str] = None,
    dry_run: bool = False,
    dpi: int = 150,
) -> None:
    import anthropic

    client = anthropic.Anthropic()

    pdf_path = os.path.abspath(pdf_path)
    source_filename = os.path.basename(pdf_path)
    grade_dir = os.path.join(bank_root, f"grade_{grade}", domain)

    print(f"\n{'='*60}")
    print(f"  PDF:    {source_filename}")
    print(f"  Domain: {domain}")
    print(f"  Grade:  {grade}")
    print(f"  Output: {grade_dir}")
    if dry_run:
        print("  Mode:   DRY RUN (no files will be written)")
    print(f"{'='*60}\n")

    # ── 1. Extract problems from main PDF ──────────────────────
    page_count = get_page_count(pdf_path)
    print(f"Pages in problem PDF: {page_count}")

    all_problems: dict[int, dict] = {}  # keyed by problem_number

    for page_num in range(1, page_count + 1):
        print(f"\n  [Page {page_num}/{page_count}] Rasterizing...", end=" ", flush=True)
        image_bytes = rasterize_page(pdf_path, page_num, dpi=dpi)
        print(f"done ({len(image_bytes)//1024}KB). Calling Claude...", end=" ", flush=True)

        problems = call_claude_extract(client, image_bytes, domain, grade)
        print(f"extracted {len(problems)} problem(s).")

        for p in problems:
            num = p["problem_number"]
            if num in all_problems:
                print(f"    ⚠  Duplicate problem_number {num} — skipping second occurrence")
            else:
                all_problems[num] = p

    print(f"\nTotal problems extracted from problem PDF: {len(all_problems)}")

    # ── 2. Extract answers from key PDF (if provided) ─────────
    if key_pdf_path:
        key_pdf_path = os.path.abspath(key_pdf_path)
        key_page_count = get_page_count(key_pdf_path)
        print(f"\nProcessing key PDF: {os.path.basename(key_pdf_path)} ({key_page_count} pages)")

        for page_num in range(1, key_page_count + 1):
            print(f"  [Key page {page_num}/{key_page_count}] Rasterizing...", end=" ", flush=True)
            image_bytes = rasterize_page(key_pdf_path, page_num, dpi=dpi)
            print(f"done. Calling Claude...", end=" ", flush=True)

            key_problems = call_claude_extract(client, image_bytes, domain, grade)
            print(f"extracted {len(key_problems)} answer(s).")

            for kp in key_problems:
                num = kp["problem_number"]
                answer = kp.get("answer_latex", "").strip()
                if num in all_problems and answer:
                    all_problems[num]["answer_latex"] = answer

    # ── 3. Assign IDs and write JSON files ─────────────────────
    start_seq = next_seq_number(grade_dir)
    written = 0
    skipped = 0

    print(f"\nWriting JSON files (starting at seq {start_seq:04d})...\n")

    for seq_offset, (prob_num, problem) in enumerate(sorted(all_problems.items())):
        quarter = problem["suggested_quarter"]
        seq = start_seq + seq_offset
        problem_id = build_problem_id(domain, grade, quarter, seq)

        record = {
            "id": problem_id,
            "domain": domain,
            "grade": grade,
            "quarter": quarter,
            "topic": problem["topic_description"],
            "latex": problem["latex"],
            "answer_latex": problem.get("answer_latex", ""),
            "source_file": source_filename,
            "source_problem_number": prob_num,
            "approved": False,
            "notes": "",
        }

        output_dir = os.path.join(grade_dir, f"q{quarter}")
        output_path = os.path.join(output_dir, f"{problem_id}.json")

        if dry_run:
            print(f"  [DRY RUN] Would write: {output_path}")
            print(f"    topic:   {record['topic']}")
            print(f"    latex:   {record['latex'][:80]}{'...' if len(record['latex']) > 80 else ''}")
            print(f"    answer:  {record['answer_latex'] or '(empty)'}")
            print()
            skipped += 1
        else:
            os.makedirs(output_dir, exist_ok=True)
            with open(output_path, "w") as f:
                json.dump(record, f, indent=2, ensure_ascii=False)
            print(f"  ✅  {problem_id}.json  (q{quarter}) — {record['topic']}")
            written += 1

    print(f"\n{'─'*60}")
    if dry_run:
        print(f"DRY RUN complete. Would have written {skipped} files.")
    else:
        print(f"Ingest complete. Wrote {written} JSON files to {grade_dir}/")
    print()


# ── Entry point ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    repo_root = os.path.join(os.path.dirname(__file__), "..")
    default_bank_root = os.path.abspath(os.path.join(repo_root, "problem_bank"))

    parser = argparse.ArgumentParser(
        description="Ingest a DeltaMath PDF into the problem bank.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Ingest equations worksheet for grade 6
  python scripts/ingest_pdf.py \\
      --pdf uploads/Equations.pdf \\
      --key-pdf uploads/Equations__KEY.pdf \\
      --domain expressions_equations

  # Ingest geometry (no key available yet)
  python scripts/ingest_pdf.py \\
      --pdf uploads/Geometry.pdf \\
      --domain geometry

  # Preview without writing files
  python scripts/ingest_pdf.py \\
      --pdf uploads/Decimal_Practice.pdf \\
      --domain fractions_decimals \\
      --dry-run
""",
    )
    parser.add_argument("--pdf",        required=True,  help="Path to the problem PDF")
    parser.add_argument("--key-pdf",    default=None,   help="Path to the answer key PDF (optional)")
    parser.add_argument("--domain",     required=True,  choices=VALID_DOMAINS,
                        help="Problem domain")
    parser.add_argument("--grade",      type=int,       default=6,
                        help="Grade level (default: 6)")
    parser.add_argument("--bank-root",  default=default_bank_root,
                        help="Path to problem_bank root directory")
    parser.add_argument("--dpi",        type=int,       default=150,
                        help="DPI for page rasterization (default: 150)")
    parser.add_argument("--dry-run",    action="store_true",
                        help="Print what would be written without creating any files")
    args = parser.parse_args()

    # Validate paths
    if not os.path.exists(args.pdf):
        print(f"ERROR: PDF not found: {args.pdf}")
        sys.exit(1)
    if args.key_pdf and not os.path.exists(args.key_pdf):
        print(f"ERROR: Key PDF not found: {args.key_pdf}")
        sys.exit(1)
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("ERROR: ANTHROPIC_API_KEY environment variable not set.")
        sys.exit(1)

    ingest(
        pdf_path=args.pdf,
        domain=args.domain,
        grade=args.grade,
        bank_root=args.bank_root,
        key_pdf_path=args.key_pdf,
        dry_run=args.dry_run,
        dpi=args.dpi,
    )
