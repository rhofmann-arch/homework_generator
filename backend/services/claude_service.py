import os, asyncio, logging
import anthropic
from services.pacing import WeekContext

logger = logging.getLogger(__name__)
client = anthropic.AsyncAnthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
MODEL  = "claude-sonnet-4-6"

STYLE_NOTES = """
You are generating LaTeX math problems for a 6th-grade homework sheet.

FORMATTING:
- All math must be valid LaTeX (amsmath). Use \\dfrac for displayed fractions.
- Do NOT include problem numbers.
- Do NOT include answer blanks or solution steps.
- Multi-part: use \\textbf{a.}\\ \\textbf{b.}\\ inline.
- Diagrams: use tikz, compact (under 4cm tall).
- Problems must be solvable without a calculator.
- One unambiguous correct answer per problem.
"""

FRONT_TOOL = {
    "name": "submit_front_problems",
    "description": "Submit the spiral review problems for the front page of the homework sheet.",
    "input_schema": {
        "type": "object",
        "properties": {
            "spiral_topics": {
                "type": "string",
                "description": "3-6 word comma-separated summary of topics covered by these problems."
            },
            "problems": {
                "type": "array",
                "description": "Exactly 10 spiral review problems.",
                "items": {
                    "type": "object",
                    "properties": {
                        "latex": {"type": "string", "description": "Problem text in LaTeX."}
                    },
                    "required": ["latex"]
                },
                "minItems": 10,
                "maxItems": 10,
            },
        },
        "required": ["spiral_topics", "problems"],
    },
}

BACK_TOOL = {
    "name": "submit_back_problems",
    "description": "Submit the lesson-aligned practice problems for the back page of the homework sheet.",
    "input_schema": {
        "type": "object",
        "properties": {
            "lesson_title": {
                "type": "string",
                "description": "Short topic name, 4-6 words."
            },
            "problems": {
                "type": "array",
                "description": "Lesson practice problems, ordered easier to harder.",
                "items": {
                    "type": "object",
                    "properties": {
                        "latex": {"type": "string", "description": "Problem text in LaTeX."}
                    },
                    "required": ["latex"]
                },
                "minItems": 5,
                "maxItems": 10,
            },
        },
        "required": ["lesson_title", "problems"],
    },
}

CHALLENGE_TOOL = {
    "name": "submit_challenge_problems",
    "description": "Submit the honors challenge problems for the bottom of the back page.",
    "input_schema": {
        "type": "object",
        "properties": {
            "problems": {
                "type": "array",
                "description": "Exactly 2 multi-step challenge problems.",
                "items": {
                    "type": "object",
                    "properties": {
                        "latex": {"type": "string", "description": "Problem text in LaTeX."}
                    },
                    "required": ["latex"]
                },
                "minItems": 2,
                "maxItems": 2,
            },
        },
        "required": ["problems"],
    },
}

def _front_prompt(grade, covered, current):
    system = STYLE_NOTES + """
Rules for spiral review problems:
- Exactly 10 problems total.
- Only use topics from covered_topics list.
- Weight toward 8 most recently covered topics.
- Vary types: computation, explanation, fill-in, true/false.
- No multi-step word problems. Each solvable in 60-90 seconds.
"""
    user = (
        f"Grade: {grade}\n"
        f"Covered topics (oldest first): {covered}\n"
        f"Current week (do NOT include): {current}\n"
        "Generate 10 spiral review problems."
    )
    return system, user

def _back_prompt(grade, class_type, current, spiral_topics):
    n = "5-7" if class_type == "honors" else "8-10"
    system = STYLE_NOTES + f"""
Rules for lesson practice problems:
- Exactly {n} problems aligned with current_lessons.
- Order easier to harder.
- Do not repeat topics from spiral_topics: {spiral_topics}
"""
    user = (
        f"Grade: {grade}, Class: {class_type}\n"
        f"Current lessons: {current}\n"
        "Generate lesson practice problems."
    )
    return system, user

def _challenge_prompt(current):
    system = STYLE_NOTES + """
Rules for challenge problems:
- Exactly 2 multi-step challenge problems.
- Extend current lesson into non-routine territory.
- Solvable by a strong 6th grader in 3-5 minutes.
"""
    user = f"Current lessons: {current}\nGenerate 2 challenge problems."
    return system, user

async def _call(system: str, user: str, tool: dict) -> dict:
    response = await client.messages.create(
        model=MODEL,
        max_tokens=2000,
        system=system,
        tools=[tool],
        tool_choice={"type": "tool", "name": tool["name"]},
        messages=[{"role": "user", "content": user}],
    )
    tool_block = next(
        (block for block in response.content if block.type == "tool_use"),
        None,
    )
    if tool_block is None:
        raise ValueError(
            f"Claude did not return a tool_use block. "
            f"Stop reason: {response.stop_reason}. "
            f"Content: {response.content}"
        )
    logger.info(f"Tool '{tool['name']}' called successfully — stop_reason={response.stop_reason}")
    return tool_block.input

async def generate_problems(context: WeekContext, class_type: str) -> dict:
    covered = ", ".join(context.covered_topics[-20:])
    current = ", ".join(context.current_lessons)

    front_sys, front_usr = _front_prompt(context.grade, covered, current)
    chal_sys,  chal_usr  = _challenge_prompt(current)

    if class_type == "honors":
        front_data, challenge_data = await asyncio.gather(
            _call(front_sys, front_usr, FRONT_TOOL),
            _call(chal_sys,  chal_usr,  CHALLENGE_TOOL),
        )
    else:
        front_data     = await _call(front_sys, front_usr, FRONT_TOOL)
        challenge_data = {"problems": []}

    spiral_topics      = front_data.get("spiral_topics", "")
    back_sys, back_usr = _back_prompt(context.grade, class_type, current, spiral_topics)
    back_data          = await _call(back_sys, back_usr, BACK_TOOL)

    return {
        "spiral_topics":      spiral_topics,
        "front_problems":     front_data.get("problems", []),
        "lesson_title":       back_data.get("lesson_title", context.lesson_title),
        "back_problems":      back_data.get("problems", []),
        "challenge_problems": challenge_data.get("problems", []),
    }
