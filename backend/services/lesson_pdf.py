from __future__ import annotations
"""
Finds the lesson PDF (and answer key) for a given grade/lesson number.

File naming convention:
  lesson_pdfs/grade_6/6_1_1.pdf   → Grade 6, Chapter 1, Lesson 1
  lesson_pdfs/grade_6/6_1_key.pdf → Grade 6, Chapter 1, answer key (all lessons)

lesson_map.json handles cases where two class types use different lesson numbers
for the same PDF (e.g. grade_level ch3 = honors ch8):

  {
    "grade_level": {"3.1": "6_3_1.pdf"},
    "honors":      {"8.1": "6_3_1.pdf"}
  }
"""

import json
import base64
from pathlib import Path

_REPO_ROOT = Path(__file__).parent.parent.parent

LESSON_PDF_ROOT = (
    Path("/lesson_pdfs")
    if Path("/lesson_pdfs").exists()
    else _REPO_ROOT / "lesson_pdfs"
)


def _grade_dir(grade: str) -> Path:
    return LESSON_PDF_ROOT / f"grade_{grade}"


def _lesson_to_filename(grade: str, lesson: str) -> str:
    """Convert '1.1' → '6_1_1.pdf' for grade 6."""
    parts = lesson.strip().split(".")
    if len(parts) == 2:
        ch, les = parts
        return f"{grade}_{ch}_{les}.pdf"
    # Single part like 'Extra' or malformed — no file
    return ""


def _key_filename(grade: str, chapter: str) -> str:
    return f"{grade}_{chapter}_key.pdf"


def find_lesson_pdf(
    grade: str,
    lesson: str,
    class_type: str,
) -> tuple[Path, Path | None] | None:
    """
    Returns (lesson_pdf_path, key_pdf_path_or_None) if a PDF exists for this lesson,
    or None if not found.
    """
    grade_dir = _grade_dir(grade)
    if not grade_dir.exists():
        return None

    # Check lesson_map.json for explicit overrides first
    map_file = LESSON_PDF_ROOT / "lesson_map.json"
    if map_file.exists():
        mapping = json.loads(map_file.read_text())
        override = mapping.get(class_type, {}).get(lesson)
        if override:
            pdf = grade_dir / override
            if pdf.exists():
                chapter = lesson.split(".")[0]
                key = grade_dir / _key_filename(grade, chapter)
                return pdf, key if key.exists() else None

    # Default: derive filename from lesson number
    filename = _lesson_to_filename(grade, lesson)
    if not filename:
        return None

    pdf = grade_dir / filename
    if not pdf.exists():
        return None

    chapter = lesson.split(".")[0]
    key = grade_dir / _key_filename(grade, chapter)
    return pdf, key if key.exists() else None


def pdf_to_base64(path: Path) -> str:
    return base64.standard_b64encode(path.read_bytes()).decode()
