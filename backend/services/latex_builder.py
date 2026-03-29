from __future__ import annotations
"""
Fills homework.tex with generated content, compiles with pdflatex.
"""

import asyncio, os, subprocess, tempfile
from datetime import datetime
from pathlib import Path
from services.pacing import WeekContext

TEMPLATE_PATH = Path(__file__).parent.parent / "templates" / "homework.tex"

COURSE_NAMES = {
    ("6", "grade_level"): "6th Grade Math",
    ("6", "honors"):      "Honors Math 6",
    ("5", "grade_level"): "5th Grade Math",
    ("5", "honors"):      "Honors Math 5",
}

PROBLEMS_PER_COL = 5   # front: always 5 per column = 10 total


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


def _render_front(problems: list[dict]) -> tuple[str, str]:
    """Split 10 front problems into left (1-5) and right (6-10) columns."""
    left  = problems[:PROBLEMS_PER_COL]
    right = problems[PROBLEMS_PER_COL:PROBLEMS_PER_COL * 2]

    def _col(probs: list[dict]) -> str:
        lines = []
        for i, p in enumerate(probs):
            latex = p["latex"].strip()
            if i == len(probs) - 1:
                lines.append(_last_problem(latex))
            else:
                lines.append(rf"\frontproblem{{{latex}}}")
        return "\n".join(lines)

    return _col(left), _col(right)


def _render_back(problems: list[dict], class_type: str) -> str:
    """
    Two-column back problems via multicols — fixed work space per problem.
    All problems use \backproblem (fixed \vspace, no vfill needed).
    """
    lines = []
    for p in problems:
        latex = p["latex"].strip()
        lines.append(rf"\backproblem{{{latex}}}")
    return "\n".join(lines)


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
    return r"\clearpage" + "\n" + rf"\challengeblock{{{chr(10).join(parts)}}}"


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

    grade_key    = str(context.grade).split("_")[0]   # "6_advanced" → "6"
    course_name  = COURSE_NAMES.get((grade_key, class_type), f"Grade {grade_key} Math")
    display_date = context.hw_days[0]["date"] if context.hw_days else context.week_start
    d            = datetime.strptime(display_date, "%Y-%m-%d")
    date_str     = f"Week of {d.strftime('%b %-d, %Y')}"

    hw_number      = str(context.hw_numbers[0]) if context.hw_numbers else "—"
    lesson_numbers = _escape_tex(", ".join(context.current_lessons[:4]))
    lesson_title   = _escape_tex(problems.get("lesson_title", context.lesson_title))

    front_left, front_right = _render_front(_normalize_problems(problems["front_problems"]))
    back_block              = _render_back(_normalize_problems(problems["back_problems"]), class_type)
    challenge               = _challenge_block(_normalize_problems(problems.get("challenge_problems", [])))

    filled = (template
        .replace("<<COURSE_NAME>>",    course_name)
        .replace("<<HW_NUMBER>>",      hw_number)
        .replace("<<DATE>>",           date_str)
        .replace("<<FRONT_COL_LEFT>>", front_left)
        .replace("<<FRONT_COL_RIGHT>>",front_right)
        .replace("<<LESSON_NUMBERS>>", lesson_numbers)
        .replace("<<LESSON_TITLE>>",   lesson_title)
        .replace("<<BACK_PROBLEMS>>",  back_block)
        .replace("<<CHALLENGE_BLOCK>>",challenge)
    )

    tmpdir_  = tempfile.mkdtemp(prefix="hw_")
    tex_path = os.path.join(tmpdir_, "homework.tex")
    with open(tex_path, "w") as f:
        f.write(filled)

    return await asyncio.to_thread(_compile, tmpdir_, tex_path)
