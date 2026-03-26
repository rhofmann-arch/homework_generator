"""
Calls the Anthropic API to generate math problems as LaTeX.
Front + challenge run concurrently; back runs after front (reuses spiral_topics).
"""

import os, json, re, asyncio
import anthropic
from services.pacing import WeekContext

client = anthropic.AsyncAnthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
MODEL  = "claude-sonnet-4-6"

STYLE_NOTES = """
You are generating problems for a 6th-grade math homework sheet.

FORMATTING RULES — follow exactly:
- All math expressions must be valid LaTeX (amsmath). Use \\dfrac for displayed fractions.
- Do NOT include problem numbers — the template numbers them automatically.
- Do NOT include answer blanks, answer lines, or solution steps.
- Multi-part problems: use \\textbf{a.}\\ \\textbf{b.}\\ format inline.
- Tables: use the tabular environment.
- Simple diagrams (number lines, coordinate planes, geometric shapes): use tikz.
  Keep tikz code minimal and self-contained — no external libraries beyond
  the defaults (arrows.meta, calc, shapes.geometric are available).
- Problems must be solvable without a calculator.
- Every problem must have exactly one unambiguous correct answer.

OUTPUT: Return ONLY the raw JSON object. No preamble, no explanation,
no markdown fences (no ```json). Pure JSON, nothing else.
"""

def _front_prompt(grade: str, covered: str, current: str) -> tuple[str, str]:
    system = STYLE_NOTES + """
Return this JSON structure exactly:
{
  "spiral_topics": "3-6 word comma-separated topic summary",
  "problem_count": <integer, 10 or 12>,
  "problems": [ {"latex": "..."}, ... ]
}

SPIRAL REVIEW RULES:
- Choose problem_count: use 10 if any problem needs a diagram or multi-line
  expression; use 12 if all problems are short single-line computations.
- Problems must ONLY cover topics already in covered_topics.
- Weight toward the 8 most recently covered topics (~8 recent, ~2-4 earlier).
- Vary types: computation, short explanation, fill-in, true/false with reason.
- No multi-step word problems. Each problem should take 60-90 seconds.
- If using tikz for a diagram, keep it compact (under 4cm tall).
"""
    user = (
        f"Grade: {grade}\n"
        f"Covered topics (oldest first, most recent last): {covered}\n"
        f"Current week lessons (do NOT include — too new): {current}\n"
        "Generate spiral review problems."
    )
    return system, user


def _back_prompt(grade: str, class_type: str, current: str,
                 spiral_topics: str) -> tuple[str, str]:
    if class_type == "honors":
        n_rule  = "Generate 5–7 problems (leave room for the challenge block below)."
        d_rule  = "Challenge students — less scaffolding, multi-step reasoning welcome."
        col_note = "Layout is SINGLE-COLUMN. Problems may be longer."
    else:
        n_rule  = "Generate 8–10 problems to fill a full page."
        d_rule  = "Provide clear scaffolding. Avoid ambiguity."
        col_note = "Layout is TWO-COLUMN. Keep each problem to 2-3 lines max."

    system = STYLE_NOTES + f"""
Return this JSON structure exactly:
{{
  "lesson_title": "topic name for the header (4-6 words max)",
  "problems": [ {{"latex": "..."}}, ... ]
}}

LESSON PRACTICE RULES:
- {n_rule}
- All problems must be aligned with current_lessons.
- Order from easier to harder.
- {d_rule}
- {col_note}
- Do NOT repeat problem types already covered in spiral_topics: {spiral_topics}
"""
    user = (
        f"Grade: {grade}\n"
        f"Current lessons: {current}\n"
        f"Class type: {class_type}\n"
        "Generate lesson practice problems."
    )
    return system, user


def _challenge_prompt(current: str) -> tuple[str, str]:
    system = STYLE_NOTES + """
Return this JSON structure exactly:
{
  "problems": [
    {"latex": "..."},
    {"latex": "..."}
  ]
}

CHALLENGE RULES:
- Generate exactly 2 problems.
- Each extends the current lesson into non-routine territory.
- Require multi-step reasoning, pattern recognition, or creative application.
- Solvable by a strong 6th grader with 3-5 minutes of effort.
- One clean question each — no hints, no sub-parts.
"""
    user = f"Current lessons: {current}\nGenerate 2 challenge problems."
    return system, user


def _parse_json(text: str) -> dict:
    text = text.strip()
    text = re.sub(r'^```(?:json)?\s*', '', text)
    text = re.sub(r'\s*```$', '', text)
    return json.loads(text.strip())


async def _call(system: str, user: str) -> dict:
    response = await client.messages.create(
        model=MODEL,
        max_tokens=2000,
        system=system,
        messages=[{"role": "user", "content": user}],
    )
    return _parse_json(response.content[0].text)


async def generate_problems(context: WeekContext, class_type: str) -> dict:
    covered = ", ".join(context.covered_topics[-20:])
    current = ", ".join(context.current_lessons)

    front_sys, front_usr = _front_prompt(context.grade, covered, current)
    chal_sys,  chal_usr  = _challenge_prompt(current)

    # Front and challenge are independent — run concurrently for honors
    if class_type == "honors":
        front_data, challenge_data = await asyncio.gather(
            _call(front_sys, front_usr),
            _call(chal_sys,  chal_usr),
        )
    else:
        front_data     = await _call(front_sys, front_usr)
        challenge_data = {"problems": []}

    spiral_topics        = front_data.get("spiral_topics", "")
    back_sys, back_usr   = _back_prompt(context.grade, class_type, current, spiral_topics)
    back_data            = await _call(back_sys, back_usr)

    return {
        "spiral_topics":      spiral_topics,
        "front_problems":     front_data.get("problems", []),
        "lesson_title":       back_data.get("lesson_title", context.lesson_title),
        "back_problems":      back_data.get("problems", []),
        "challenge_problems": challenge_data.get("problems", []),
    }
