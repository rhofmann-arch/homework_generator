from __future__ import annotations
import os, asyncio, logging
from pathlib import Path
import anthropic
from services.pacing import WeekContext
from services.lesson_pdf import find_lesson_pdf, pdf_to_base64

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


def _back_prompt(
    grade: str,
    class_type: str,
    current_lessons: list[str],
    current_topic: str,
    spiral_topics: str,
) -> tuple[str, list]:
    """
    Returns (system_prompt, user_content_blocks).
    user_content_blocks is a list suitable for the Claude messages API —
    either [{"type": "text", ...}] alone, or with PDF document blocks prepended
    when a lesson PDF is available.
    """
    n = "5-7" if class_type == "honors" else "8-10"

    system = STYLE_NOTES + f"""
Rules for lesson practice problems:
- Exactly {n} problems aligned with current_lessons/topic.
- Order easier to harder.
- Do not repeat topics from spiral_topics: {spiral_topics}
- Match the style, format, and difficulty of the provided worksheet examples when available.
- Vary problem types (computation, word problem, true/false, error analysis).
"""

    # Build content blocks — start with any lesson PDFs we can find
    content: list[dict] = []
    pdf_found = False

    for lesson in current_lessons:
        result = find_lesson_pdf(grade, lesson, class_type)
        if result is None:
            continue
        lesson_pdf, key_pdf = result

        if not pdf_found:
            content.append({
                "type": "text",
                "text": (
                    "Below are the lesson worksheet(s) from the textbook for this topic. "
                    "Use these as style and format references — generate NEW problems that "
                    "match this format and difficulty but use different numbers and contexts. "
                    "Do not copy problems verbatim."
                )
            })
            pdf_found = True

        content.append({
            "type": "document",
            "source": {
                "type": "base64",
                "media_type": "application/pdf",
                "data": pdf_to_base64(lesson_pdf),
            },
            "title": f"Lesson {lesson} worksheet",
        })

        if key_pdf:
            content.append({
                "type": "document",
                "source": {
                    "type": "base64",
                    "media_type": "application/pdf",
                    "data": pdf_to_base64(key_pdf),
                },
                "title": f"Lesson {lesson} answer key",
            })

    # Text instruction always goes last
    instruction = (
        f"Grade: {grade}, Class: {class_type}\n"
        f"Current topic: {current_topic}\n"
        f"Current lessons: {', '.join(current_lessons)}\n"
        "Generate lesson practice problems."
    )
    if not pdf_found:
        instruction = (
            "No worksheet PDF is available for this lesson — "
            "generate problems based on the topic description.\n\n"
        ) + instruction

    content.append({"type": "text", "text": instruction})
    return system, content


def _challenge_prompt(current):
    system = STYLE_NOTES + """
Rules for challenge problems:
- Exactly 2 multi-step challenge problems.
- Extend current lesson into non-routine territory.
- Solvable by a strong 6th grader in 3-5 minutes.
"""
    user = f"Current lessons: {current}\nGenerate 2 challenge problems."
    return system, user


async def _call(
    system: str,
    user: str | list,
    tool: dict,
) -> dict:
    """
    Calls Claude with tool_choice forced.
    user may be a plain string or a list of content blocks (for multimodal).
    """
    if isinstance(user, str):
        user_content = user
    else:
        user_content = user  # already a list of blocks

    response = await client.messages.create(
        model=MODEL,
        max_tokens=2000,
        system=system,
        tools=[tool],
        tool_choice={"type": "tool", "name": tool["name"]},
        messages=[{"role": "user", "content": user_content}],
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
    current_lessons = context.current_lessons
    current_str = ", ".join(current_lessons)

    front_sys, front_usr = _front_prompt(context.grade, covered, current_str)
    chal_sys,  chal_usr  = _challenge_prompt(current_str)

    if class_type == "honors":
        front_data, challenge_data = await asyncio.gather(
            _call(front_sys, front_usr, FRONT_TOOL),
            _call(chal_sys,  chal_usr,  CHALLENGE_TOOL),
        )
    else:
        front_data     = await _call(front_sys, front_usr, FRONT_TOOL)
        challenge_data = {"problems": []}

    spiral_topics = front_data.get("spiral_topics", "")

    back_sys, back_content = _back_prompt(
        grade=context.grade,
        class_type=class_type,
        current_lessons=current_lessons,
        current_topic=context.current_topic,
        spiral_topics=spiral_topics,
    )
    back_data = await _call(back_sys, back_content, BACK_TOOL)

    return {
        "spiral_topics":      spiral_topics,
        "front_problems":     front_data.get("problems", []),
        "lesson_title":       back_data.get("lesson_title", context.lesson_title),
        "back_problems":      back_data.get("problems", []),
        "challenge_problems": challenge_data.get("problems", []),
    }
