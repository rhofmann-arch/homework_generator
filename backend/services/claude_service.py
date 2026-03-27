import os, json, re, asyncio, logging
import anthropic
from services.pacing import WeekContext

logger = logging.getLogger(__name__)
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

def _front_prompt(grade, covered, current):
    system = STYLE_NOTES + """
Return this JSON structure exactly:
{
  "spiral_topics": "3-6 word comma-separated topic summary",
  "problems": [ {"latex": "..."}, ... ]
}

SPIRAL REVIEW RULES:
- Generate exactly 10 problems.
- Problems must ONLY cover topics already in covered_topics.
- Weight toward the 8 most recently covered topics.
- Vary types: computation, short explanation, fill-in, true/false with reason.
- No multi-step word problems. Each problem should take 60-90 seconds.
- If using tikz for a diagram, keep it compact (under 4cm tall).
"""
    user = (
        f"Grade: {grade}\n"
        f"Covered topics (oldest first, most recent last): {covered}\n"
        f"Current week lessons (do NOT include — too new): {current}\n"
        "Generate 10 spiral review problems."
    )
    return system, user

def _back_prompt(grade, class_type, current, spiral_topics):
    if class_type == "honors":
        n_rule   = "Generate 5-7 problems (leave room for the challenge block below)."
        d_rule   = "Challenge students — less scaffolding, multi-step reasoning welcome."
        col_note = "Layout is SINGLE-COLUMN. Problems may be longer."
    else:
        n_rule   = "Generate 8-10 problems to fill a full page."
        d_rule   = "Provide clear scaffolding. Avoid ambiguity."
        col_note = "Layout is SINGLE-COLUMN. Keep each problem to 2-3 lines max."

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
        "Generate lesson practice problems. Respond with a JSON object only, starting with { Your entire response must be a single JSON object starting with {"
    )
    return system, user

def _challenge_prompt(current):
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

def _parse_json(text):
    text = text.strip()
    text = re.sub(r'^```(?:json)?\s*', '', text)
    text = re.sub(r'\s*```$', '', text)
    text = text.strip()
    if not text:
        raise ValueError("Claude returned an empty response")
    return json.loads(text)

async def _call(system, user):
    response = await client.messages.create(
        model=MODEL,
        max_tokens=2000,
        system=system,
        messages=[{"role": "user", "content": user}],
    )
    raw = response.content[0].text
    logger.info(f"Claude raw response (first 200 chars): {raw[:200]}")
    return _parse_json(raw)

async def generate_problems(context: WeekContext, class_type: str) -> dict:
    covered = ", ".join(context.covered_topics[-20:])
    current = ", ".join(context.current_lessons)

    front_sys, front_usr = _front_prompt(context.grade, covered, current)
    chal_sys,  chal_usr  = _challenge_prompt(current)

    if class_type == "honors":
        front_data, challenge_data = await asyncio.gather(
            _call(front_sys, front_usr),
            _call(chal_sys,  chal_usr),
        )
    else:
        front_data     = await _call(front_sys, front_usr)
        challenge_data = {"problems": []}

    spiral_topics      = front_data.get("spiral_topics", "")
    back_sys, back_usr = _back_prompt(context.grade, class_type, current, spiral_topics)
    back_data          = await _call(back_sys, back_usr)

    return {
        "spiral_topics":      spiral_topics,
        "front_problems":     front_data.get("problems", []),
        "lesson_title":       back_data.get("lesson_title", context.lesson_title),
        "back_problems":      back_data.get("problems", []),
        "challenge_problems": challenge_data.get("problems", []),
    }
