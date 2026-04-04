#!/usr/bin/env python3
"""
Ingests end-of-course review screenshots into the high-priority problem bank.

Screenshots are pre-sorted into Q1/Q2/Q3/Q4 subfolders by the teacher.
Quarter is taken from the folder name — not inferred by Claude.

For each problem Claude will:
  - Extract question text as LaTeX
  - Detect domain (arithmetic, expressions_equations, geometry, stats_probability, other)
  - Auto-detect keep_mc: True if question structure requires answer choices
                         False if it can be rephrased as open-ended
  - Strip answer choices from open-ended problems (keep stem + correct answer only)
  - Keep answer choices for keep_mc=True problems

Problems land in _inbox/ with:
  - high_priority: true
  - quarter: N  (from folder)
  - approved: false  (teacher reviews domain assignment + LaTeX accuracy)
  - source: "eoc_review"

Requirements:
    pip install anthropic pillow

Usage:
    python3 scripts/ingest_screenshots.py --dir uploads/eoc_screenshots/ --grade 6
    python3 scripts/ingest_screenshots.py --dir uploads/eoc_screenshots/ --dry-run
    python3 scripts/ingest_screenshots.py --dir uploads/eoc_screenshots/ --quarter 2  # single quarter
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
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

IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}

# Phrases in the question stem that force keep_mc=True.
# These are structural — removing the choices would break the question.
FORCE_MC_PATTERNS = [
    r"\bwhich of the following\b",
    r"\bwhich expression\b",
    r"\bwhich equation\b",
    r"\bwhich statement\b",
    r"\bwhich value\b",
    r"\bwhich graph\b",
    r"\bwhich table\b",
    r"\bwhich inequality\b",
    r"\bselect all that apply\b",
    r"\ball of the above\b",
    r"\bnone of the above\b",
]

# ── Claude tool schema ────────────────────────────────────────────────────────

EOC_EXTRACT_TOOL = {
    "name": "extract_eoc_problem",
    "description": (
        "Extract a single end-of-course review problem from a screenshot. "
        "Detect whether it must stay multiple choice or can be open-ended."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "question_latex": {
                "type": "string",
                "description": (
                    "The question stem in LaTeX — NO answer choices. "
                    "Use $...$ for inline math, $$...$$ for display math. "
                    "Preserve all numbers, fractions, and wording exactly."
                ),
            },
            "answer_choices": {
                "type": "array",
                "description": (
                    "The answer choices A/B/C/D as LaTeX strings, in order. "
                    "Always include all choices exactly as shown, even for open-ended problems — "
                    "we need the correct answer."
                ),
                "items": {
                    "type": "object",
                    "properties": {
                        "label": {
                            "type": "string",
                            "description": "Choice label: A, B, C, or D",
                        },
                        "latex": {
                            "type": "string",
                            "description": "Choice text in LaTeX",
                        },
                        "is_correct": {
                            "type": "boolean",
                            "description": "True if this is the correct answer",
                        },
                    },
                    "required": ["label", "latex", "is_correct"],
                },
                "minItems": 2,
                "maxItems": 4,
            },
            "keep_mc": {
                "type": "boolean",
                "description": (
                    "True if the question MUST stay multiple choice because removing "
                    "the choices would break or fundamentally change the question "
                    "(e.g., 'Which of the following...', choices reference each other, "
                    "or the correct answer depends on comparing the options). "
                    "False if the question works as a standalone open-ended problem "
                    "(the answer choices are just scaffolding)."
                ),
            },
            "keep_mc_reason": {
                "type": "string",
                "description": (
                    "Brief reason why keep_mc was set as it was, e.g. "
                    "'question stem says which of the following' or "
                    "'removing choices leaves a clean compute problem'."
                ),
            },
            "domain": {
                "type": "string",
                "enum": DOMAINS,
                "description": (
                    "Best-fit domain for this problem. "
                    "arithmetic = number sense, fractions, decimals, ratios, percents, integers. "
                    "expressions_equations = variables, expressions, one/two-step equations, inequalities. "
                    "geometry = area, perimeter, volume, surface area, coordinate plane, angle relationships. "
                    "stats_probability = data displays, mean/median/mode/range, probability. "
                    "other = anything that doesn't clearly fit above."
                ),
            },
            "topic_description": {
                "type": "string",
                "description": "Brief topic label, e.g. 'dividing fractions by whole numbers'",
            },
            "needs_diagram": {
                "type": "boolean",
                "description": (
                    "True if the problem references a figure, graph, number line, "
                    "table, or other visual that must be reproduced in LaTeX/TikZ."
                ),
            },
            "diagram_notes": {
                "type": "string",
                "description": (
                    "If needs_diagram=True: describe what the diagram shows "
                    "so a TikZ version can be created during bank review. "
                    "Empty string if needs_diagram=False."
                ),
            },
        },
        "required": [
            "question_latex",
            "answer_choices",
            "keep_mc",
            "keep_mc_reason",
            "domain",
            "topic_description",
            "needs_diagram",
            "diagram_notes",
        ],
    },
}

# ── Helpers ───────────────────────────────────────────────────────────────────


def image_to_base64(path: Path) -> tuple[str, str]:
    """Returns (base64_data, media_type)."""
    suffix = path.suffix.lower()
    media_types = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
    }
    return (
        base64.standard_b64encode(path.read_bytes()).decode(),
        media_types.get(suffix, "image/png"),
    )


def force_mc_by_pattern(question_latex: str) -> bool:
    """Heuristic check on extracted LaTeX stem for structural MC markers."""
    text = question_latex.lower()
    return any(re.search(p, text) for p in FORCE_MC_PATTERNS)


def extract_problem_from_screenshot(
    client: anthropic.Anthropic,
    image_path: Path,
) -> dict | None:
    """Send a single screenshot to Claude and extract the structured problem."""

    b64_data, media_type = image_to_base64(image_path)

    response = client.messages.create(
        model=MODEL,
        max_tokens=2048,
        tools=[EOC_EXTRACT_TOOL],
        tool_choice={"type": "tool", "name": "extract_eoc_problem"},
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": media_type,
                            "data": b64_data,
                        },
                    },
                    {
                        "type": "text",
                        "text": (
                            "This is a screenshot of a 6th-grade end-of-course review problem. "
                            "Extract the question stem, all answer choices (A–D), identify the "
                            "correct answer, and determine whether this problem MUST stay "
                            "multiple choice or can be used as an open-ended question. "
                            "Also identify the math domain and whether a diagram needs to be reproduced."
                        ),
                    },
                ],
            }
        ],
    )

    for block in response.content:
        if block.type == "tool_use" and block.name == "extract_eoc_problem":
            return block.input

    return None


def build_record(
    raw: dict,
    image_path: Path,
    quarter: int,
    grade: int,
    problem_id: str,
) -> dict:
    """Convert Claude's extraction into the canonical bank record format."""

    question_latex = raw["question_latex"]
    choices = raw.get("answer_choices", [])
    keep_mc = raw["keep_mc"]

    # Override keep_mc if stem contains a structural MC pattern
    if force_mc_by_pattern(question_latex):
        keep_mc = True

    # Find the correct answer
    correct_choice = next((c for c in choices if c.get("is_correct")), None)
    answer_latex = correct_choice["latex"] if correct_choice else ""

    # Build choices_latex for MC rendering (ordered A/B/C/D)
    choices_latex = {c["label"]: c["latex"] for c in choices} if keep_mc else {}

    return {
        "id": problem_id,
        "domain": raw.get("domain"),          # pre-detected, confirmed during review
        "grade": grade,
        "quarter": quarter,                    # authoritative — from folder name
        "topic": raw.get("topic_description", ""),
        "latex": question_latex,
        "answer_latex": answer_latex,
        "keep_mc": keep_mc,
        "keep_mc_reason": raw.get("keep_mc_reason", ""),
        "choices_latex": choices_latex,        # empty dict if not MC
        "needs_diagram": raw.get("needs_diagram", False),
        "diagram_notes": raw.get("diagram_notes", ""),
        "high_priority": True,
        "source": "eoc_review",
        "source_file": image_path.name,
        "approved": False,
        "flagged": False,
        "notes": "",
    }


def next_id(inbox: Path, prefix: str) -> str:
    """Generate the next sequential ID: eoc_g6_0001, eoc_g6_0002, ..."""
    existing = list(inbox.glob(f"{prefix}_*.json"))
    nums = []
    for f in existing:
        m = re.search(r"_(\d+)\.json$", f.name)
        if m:
            nums.append(int(m.group(1)))
    next_num = (max(nums) + 1) if nums else 1
    return f"{prefix}_{next_num:04d}"


def collect_images(root_dir: Path, only_quarter: int | None) -> list[tuple[Path, int]]:
    """
    Collect (image_path, quarter) pairs from Q1/Q2/Q3/Q4 subfolders.
    Returns sorted list, ordered Q1→Q4 then by filename within each quarter.
    """
    results = []
    quarters = [only_quarter] if only_quarter else [1, 2, 3, 4]

    for q in quarters:
        qdir = root_dir / f"Q{q}"
        if not qdir.exists():
            print(f"  [skip] Q{q}/ not found in {root_dir}")
            continue
        images = sorted(
            p for p in qdir.iterdir() if p.suffix.lower() in IMAGE_SUFFIXES
        )
        if not images:
            print(f"  [skip] Q{q}/ is empty")
            continue
        print(f"  Q{q}: {len(images)} image(s)")
        for img in images:
            results.append((img, q))

    return results


# ── Main ──────────────────────────────────────────────────────────────────────


def ingest(
    screenshots_dir: Path,
    grade: int,
    bank_root: Path,
    dry_run: bool,
    only_quarter: int | None,
) -> None:
    client = anthropic.Anthropic()

    inbox = bank_root / f"grade_{grade}" / "_inbox"
    if not dry_run:
        inbox.mkdir(parents=True, exist_ok=True)

    id_prefix = f"eoc_g{grade}"

    print(f"\nScanning {screenshots_dir} for screenshots...")
    image_list = collect_images(screenshots_dir, only_quarter)

    if not image_list:
        print("No images found. Check that Q1/Q2/Q3/Q4 subfolders exist and contain images.")
        return

    print(f"\nTotal: {len(image_list)} screenshots to process\n")
    print(f"Destination: {inbox}\n")
    print("-" * 60)

    results = {"ok": 0, "failed": 0, "kept_mc": 0, "open_ended": 0, "needs_diagram": 0}

    for image_path, quarter in image_list:
        print(f"  [{quarter}] {image_path.name} ... ", end="", flush=True)

        try:
            raw = extract_problem_from_screenshot(client, image_path)
        except Exception as exc:
            print(f"ERROR: {exc}")
            results["failed"] += 1
            continue

        if raw is None:
            print("no tool response — skipped")
            results["failed"] += 1
            continue

        prob_id = next_id(inbox, id_prefix)
        record = build_record(raw, image_path, quarter, grade, prob_id)

        mc_label = "MC" if record["keep_mc"] else "open"
        diag_label = " +diagram" if record["needs_diagram"] else ""
        print(f"{mc_label}{diag_label}  |  {record['domain']}  |  {record['topic']}")

        if record["keep_mc"]:
            results["kept_mc"] += 1
        else:
            results["open_ended"] += 1
        if record["needs_diagram"]:
            results["needs_diagram"] += 1

        dest = inbox / f"{prob_id}.json"

        if dry_run:
            print(f"          [dry-run] Would write: {dest.name}")
            print(f"          keep_mc_reason: {record['keep_mc_reason']}")
            print(f"          answer: {record['answer_latex'][:60]}")
        else:
            dest.write_text(json.dumps(record, indent=2))

        results["ok"] += 1

    print("-" * 60)
    print(f"\nDone. Processed {results['ok']} problems ({results['failed']} failed).")
    print(f"  Open-ended : {results['open_ended']}")
    print(f"  Keep MC    : {results['kept_mc']}")
    print(f"  Need diagram: {results['needs_diagram']}")

    if not dry_run:
        print(f"\nNext steps:")
        print(f"  1. Open bank review UI — filter by source=eoc_review")
        print(f"  2. Verify LaTeX accuracy and domain assignment")
        print(f"  3. For needs_diagram=True problems, add TikZ diagram to latex field")
        print(f"  4. Approve each problem (quarter is pre-set, just confirm domain)")
    else:
        print(f"\n[dry-run] No files written. Run without --dry-run to apply.")


def main():
    parser = argparse.ArgumentParser(
        description="Ingest EOC review screenshots into the high-priority problem bank"
    )
    parser.add_argument(
        "--dir",
        required=True,
        help="Directory containing Q1/ Q2/ Q3/ Q4/ subfolders of screenshots",
    )
    parser.add_argument(
        "--grade",
        type=int,
        default=GRADE_DEFAULT,
        help=f"Grade number (default: {GRADE_DEFAULT})",
    )
    parser.add_argument(
        "--bank-root",
        default=str(BANK_ROOT),
        help="Path to problem_bank directory",
    )
    parser.add_argument(
        "--quarter",
        type=int,
        choices=[1, 2, 3, 4],
        help="Process only this quarter (default: all four)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview extraction without writing files",
    )
    args = parser.parse_args()

    ingest(
        screenshots_dir=Path(args.dir),
        grade=args.grade,
        bank_root=Path(args.bank_root),
        dry_run=args.dry_run,
        only_quarter=args.quarter,
    )


if __name__ == "__main__":
    main()
