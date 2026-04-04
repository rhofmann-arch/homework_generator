from __future__ import annotations
import math
"""
Fills homework.tex with generated content, compiles with pdflatex.
"""

import asyncio, os, subprocess, tempfile
from datetime import datetime
from pathlib import Path
from services.pacing import WeekContext

TEMPLATE_PATH     = Path(__file__).parent.parent / "templates" / "homework.tex"
KEY_TEMPLATE_PATH = Path(__file__).parent.parent / "templates" / "homework_key.tex"

COURSE_NAMES = {
    ("6", "grade_level"): "6th Grade Math",
    ("6", "honors"):      "Honors Math 6",
    ("5", "grade_level"): "5th Grade Math",
    ("5", "honors"):      "Honors Math 5",
}

PROBLEMS_PER_COL = 5   # front: always 5 per column = 10 total

# Space reserved below back minipage for the challenge block.
CHALLENGE_BLOCK_HT = "3.10in"

# Cache for sharing render data between build_pdf and build_key_pdf
_key_render_cache: dict = {}


def _escape_tex(s: str) -> str:
    return (s
        .replace("&",  r"\&")
        .replace("%",  r"\%")
        .replace("#",  r"\#")
        .replace("_",  r"\_")
        .replace("^",  r"\^{}")
    )


def _normalize_problems(problems: list) -> list:
    """
    Ensure every problem is a dict with a 'latex' key.
    Claude occasionally returns plain strings instead of {"latex": "..."} objects.
    """
    out = []
    for p in problems:
        if isinstance(p, str):
            out.append({"latex": p})
        elif isinstance(p, dict):
            out.append(p)
        # skip anything else (None, etc.)
    return out


def _last_problem(latex: str) -> str:
    """Last problem in any column/page: no trailing vfill or rule."""
    return (
        rf"\stepcounter{{prob}}"
        rf"\noindent\textbf{{\normalsize\theprob.}}\enspace{{\normalsize {latex}}}"
    )


def _render_front(problems: list[dict]) -> tuple[str, str, str, str]:
    """Split front problems evenly: ceil(n/2) left, floor(n/2) right.
    Works for grade-level (10 -> 5+5) and honors (8 -> 4+4).
    Returns (hw_left, hw_right, key_left, key_right).
    """
    split = math.ceil(len(problems) / 2)
    left  = problems[:split]
    right = problems[split:]

    def _hw_col(probs: list[dict]) -> str:
        lines = []
        for i, p in enumerate(probs):
            latex = p["latex"].strip()
            if i == len(probs) - 1:
                lines.append(_last_problem(latex))
            else:
                lines.append(rf"\frontproblem{{{latex}}}")
        return "\n".join(lines)

    def _key_col(probs: list[dict]) -> str:
        lines = []
        for p in probs:
            latex  = p["latex"].strip()
            answer = p.get("answer_latex", "---").strip() or "---"
            lines.append(rf"\keyproblemfront{{{latex}}}{{{answer}}}")
        return "\n".join(lines)

    return _hw_col(left), _hw_col(right), _key_col(left), _key_col(right)


def _render_back(problems: list[dict], class_type: str) -> tuple[str, str]:
    """
    Back problems for both homework and key.
    Returns (hw_block, key_block).
    """
    hw_lines  = []
    key_lines = []
    for i, p in enumerate(problems):
        latex  = p["latex"].strip()
        answer = p.get("answer_latex", "---").strip() or "---"
        is_last = (i == len(problems) - 1)
        if is_last and class_type == "grade_level":
            hw_lines.append(_last_problem(latex))
        else:
            hw_lines.append(rf"\backproblem{{{latex}}}")
        key_lines.append(rf"\keyproblemback{{{latex}}}{{{answer}}}")
    return "\n".join(hw_lines), "\n".join(key_lines)


def _challenge_block(problems: list[dict]) -> str:
    if not problems:
        return ""
    parts = []
    for p in problems:
        latex = p["latex"].strip()
        parts.append(
            rf"\stepcounter{{prob}}"
            rf"\noindent\textbf{{\normalsize\theprob.}}\enspace\normalsize {latex}"
            r"\par\vspace{1.0in}"
        )
    return rf"\challengeblock{{{chr(10).join(parts)}}}"


def _back_col_ht(class_type: str) -> str:
    """LaTeX dimension string for the back minipage height."""
    if class_type == "honors":
        return rf"\dimexpr\bodycolht-{CHALLENGE_BLOCK_HT}\relax"
    return r"\bodycolht"


def _compile(tmpdir: str, tex_path: str) -> str:
    pdf_path = os.path.join(tmpdir, "homework.pdf")
    for _ in range(2):
        result = subprocess.run(
            ["pdflatex", "-interaction=nonstopmode",
             "-output-directory", tmpdir, tex_path],
            capture_output=True, text=True, timeout=60,
        )
    if not os.path.exists(pdf_path):
        error_lines = [
            l for l in result.stdout.splitlines()
            if l.startswith("!") or l.startswith("l.")
        ]
        summary = "\n".join(error_lines[:8]) if error_lines else result.stdout[-2000:]
        raise RuntimeError(
            f"LaTeX compilation failed — likely invalid LaTeX in a generated problem.\n\n{summary}"
        )
    return pdf_path


async def build_pdf(context: WeekContext, problems: dict, class_type: str) -> str:
    template = TEMPLATE_PATH.read_text()

    grade_key = str(context.grade).split("_")[0]
    course_name  = COURSE_NAMES.get((grade_key, class_type), f"Grade {grade_key} Math")
    display_date = context.hw_days[0]["date"] if context.hw_days else context.week_start
    d            = datetime.strptime(display_date, "%Y-%m-%d")
    date_str     = d.strftime("%b %-d, %Y")

    hw_number      = str(context.hw_numbers[0]) if context.hw_numbers else "—"
    lesson_numbers = _escape_tex(", ".join(context.current_lessons[:4]))
    lesson_title   = _escape_tex(problems.get("lesson_title", context.lesson_title))

    front_left, front_right, key_front_left, key_front_right = \
        _render_front(_normalize_problems(problems["front_problems"]))
    back_block, key_back_block = \
        _render_back(_normalize_problems(problems["back_problems"]), class_type)
    challenge = _challenge_block(_normalize_problems(problems.get("challenge_problems", [])))
    back_ht   = _back_col_ht(class_type)

    filled = (template
        .replace("<<COURSE_NAME>>",    course_name)
        .replace("<<HW_NUMBER>>",      hw_number)
        .replace("<<DATE>>",           date_str)
        .replace("<<FRONT_COL_LEFT>>", front_left)
        .replace("<<FRONT_COL_RIGHT>>",front_right)
        .replace("<<LESSON_NUMBERS>>", lesson_numbers)
        .replace("<<LESSON_TITLE>>",   lesson_title)
        .replace("<<BACK_COL_HT>>",    back_ht)
        .replace("<<BACK_PROBLEMS>>",  back_block)
        .replace("<<CHALLENGE_BLOCK>>",challenge)
    )

        f.write(filled)

    return await asyncio.to_thread(_compile, tmpdir_, tex_path)


async def build_key_pdf(hw_pdf_path: str) -> str:
    """
    Build the answer key PDF for the homework at hw_pdf_path.
    Must be called after build_pdf() — relies on cached render data
    stored in _key_render_cache keyed by the same tmpdir.
    """
    tmpdir_ = str(Path(hw_pdf_path).parent)
    cache = _key_render_cache.get(tmpdir_)
    if cache is None:
        raise RuntimeError(
            "build_key_pdf called before build_pdf, or tmpdir mismatch."
        )

    template = KEY_TEMPLATE_PATH.read_text()

    filled = (template
        .replace("<<COURSE_NAME>>",        cache["course_name"])
        .replace("<<HW_NUMBER>>",           cache["hw_number"])
        .replace("<<DATE>>",                cache["date_str"])
        .replace("<<KEY_FRONT_COL_LEFT>>",  cache["key_front_left"])
        .replace("<<KEY_FRONT_COL_RIGHT>>", cache["key_front_right"])
        .replace("<<LESSON_NUMBERS>>",      cache["lesson_numbers"])
        .replace("<<LESSON_TITLE>>",        cache["lesson_title"])
        .replace("<<KEY_BACK_PROBLEMS>>",   cache["key_back_block"])
    )

    tex_path = os.path.join(tmpdir_, "homework_key.tex")
    with open(tex_path, "w") as f:
        f.write(filled)

    return await asyncio.to_thread(_compile_key, tmpdir_, tex_path)


def _compile_key(tmpdir: str, tex_path: str) -> str:
    """Compile the key tex file; returns path to key PDF."""
    pdf_path = os.path.join(tmpdir, "homework_key.pdf")
    for _ in range(2):
        result = subprocess.run(
            ["pdflatex", "-interaction=nonstopmode",
             "-output-directory", tmpdir, tex_path],
            capture_output=True, text=True, timeout=60,
        )
    if not os.path.exists(pdf_path):
        error_lines = [
            l for l in result.stdout.splitlines()
            if l.startswith("!") or l.startswith("l.")
        ]
        summary = "\n".join(error_lines[:8]) if error_lines else result.stdout[-2000:]
        raise RuntimeError(
            f"Key LaTeX compilation failed.\n\n{summary}"
        )
    return pdf_path
