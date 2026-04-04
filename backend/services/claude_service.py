from __future__ import annotations
import os, asyncio, logging, random
from pathlib import Path
import anthropic
from services.pacing import WeekContext
from services.lesson_pdf import find_lesson_pdf, pdf_to_base64
from routes.bank import sample_problems

logger = logging.getLogger(__name__)
client = anthropic.AsyncAnthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
MODEL  = "claude-sonnet-4-6"

# ── Style notes shared by all prompts ─────────────────────────────────────────

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
- Diagrams: always add \\vspace{10pt} immediately before \\begin{tikzpicture}.
- Multiple choice: always add \\vspace{6pt} immediately before the first answer option.
"""

# ── Tool schemas ──────────────────────────────────────────────────────────────

def _fill_tool(n: int) -> dict:
    """Dynamic tool: Claude fills exactly n spiral review problems."""
    return {
        "name": "submit_fill_problems",
        "description": f"Submit exactly {n} spiral review fill problems.",
        "input_schema": {
            "type": "object",
            "properties": {
                "problems": {
                    "type": "array",
                    "description": f"Exactly {n} spiral review problems.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "latex": {"type": "string", "description": "Problem text in LaTeX."}
                        },
                        "required": ["latex"]
                    },
                    "minItems": n,
                    "maxItems": n,
                },
            },
            "required": ["problems"],
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
                "description": "Short topic name, 4-6 words. Must match the exact lesson topic — do not broaden."
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


# ── Prompt builders ───────────────────────────────────────────────────────────

def _fill_prompt(grade: int | str, n: int) -> tuple[str, str]:
    """
    Claude generates n spiral review fill problems.
    Intentionally does NOT pass covered_topics — these must be generic
    grade-appropriate problems, not guided by the pacing guide.
    """
    system = STYLE_NOTES + f"""
Rules for spiral review fill problems:
- Exactly {n} problems.
- Cover a variety of grade {grade} math topics: arithmetic, fractions, decimals,
  basic geometry, ratios, expressions. Do not focus on any single topic.
- Do NOT reference current-week lessons (those belong on the back page only).
- Vary types: computation, short word problem, true/false.
- Each solvable in 60-90 seconds. No multi-step word problems.
- NEVER include error-analysis problems ("a student says X, find the mistake").
"""
    user = (
        f"Grade: {grade}\n"
        f"Generate {n} spiral review problems covering varied grade-level math topics."
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
    Build the back-page lesson practice prompt.
    Returns (system_prompt, user_content_blocks).
    Attaches lesson PDFs as context when available.
    """
    n = "5-7" if class_type == "honors" else "8-10"

    system = STYLE_NOTES + f"""
Rules for lesson practice problems:
- Exactly {n} problems on the EXACT topic: {current_topic}.
- Stay strictly within this lesson's scope. Do NOT introduce concepts from
  neighboring lessons, later chapters, or the broader topic area.
  Example: if the lesson is "area of parallelograms", generate ONLY parallelogram
  problems — not trapezoids, rhombuses, or generic quadrilaterals.
- The lesson_title you return must match the exact lesson topic. Do not broaden it.
- Order easier to harder.
- Do not repeat topics from spiral: {spiral_topics}
- Match the style and difficulty of the provided worksheet.
- NEVER generate error analysis problems ("a student says X, identify the error").
  Skip this type even if it appears in the provided worksheet.
"""

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
                    f"Below is the lesson worksheet for: {current_topic}. "
                    "Generate NEW problems covering ONLY what is shown — "
                    "different numbers and contexts, same structure and difficulty. "
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

    instruction = (
        f"Grade: {grade}, Class: {class_type}\n"
        f"Current lesson: {', '.join(current_lessons)}\n"
        f"Exact topic (stay strictly within this): {current_topic}\n"
        "Generate lesson practice problems."
    )
    if not pdf_found:
        instruction = (
            f"No worksheet PDF available. Generate strictly on: {current_topic}.\n\n"
        ) + instruction

    content.append({"type": "text", "text": instruction})
    return system, content


# ── Core API call ─────────────────────────────────────────────────────────────

async def _call(system: str, user: str | list, tool: dict) -> dict:
    response = await client.messages.create(
        model=MODEL,
        max_tokens=2000,
        system=system,
        tools=[tool],
        tool_choice={"type": "tool", "name": tool["name"]},
        messages=[{"role": "user", "content": user}],
    )
    tool_block = next(
        (block for block in response.content if block.type == "tool_use"), None
    )
    if tool_block is None:
        raise ValueError(
            f"Claude did not return a tool_use block. "
            f"Stop reason: {response.stop_reason}. Content: {response.content}"
        )
    logger.info(f"Tool '{tool['name']}' — stop_reason={response.stop_reason}")
    return tool_block.input


# ── School quarter helper ─────────────────────────────────────────────────────

def _school_quarter(date_str: str) -> int:
    """
    Derive school quarter (1–4) from a YYYY-MM-DD string.
    Q1: Aug–Oct  Q2: Nov–Jan  Q3: Feb–Mar  Q4: Apr–Jun
    Defaults to 1 on any parse error (safe for early-year).
    """
    try:
        from datetime import date
        d = date.fromisoformat(str(date_str)[:10])
        m = d.month
        if m in (8, 9, 10):   return 1
        elif m in (11, 12, 1): return 2
        elif m in (2, 3):      return 3
        else:                  return 4
    except Exception:
        return 1


# ── Front-page assembly ───────────────────────────────────────────────────────

async def _assemble_front(grade_int: int, class_type: str, school_q: int) -> list[dict]:
    """
    Builds the front-page spiral review problem list from the bank.
    max_quarter = school_q so only problems appropriate for this point
    in the year are drawn. Claude fills any shortfall.

    Grade level — 10 problems:
      1 high_priority approved + 9 regular approved (not high_priority)

    Honors — 8 problems:
      5 honors=true approved + 3 regular approved (not honors)
    """
    if class_type == "honors":
        target = 8
        honors_probs = sample_problems(
            domain=None, grade=grade_int, max_quarter=school_q, n=5, honors_only=True
        )
        regular_probs = sample_problems(
            domain=None, grade=grade_int, max_quarter=school_q, n=3, exclude_honors=True
        )
        bank_pool = honors_probs + regular_probs
        logger.info(
            f"Honors front Q{school_q}: {len(honors_probs)} honors + {len(regular_probs)} regular"
        )
    else:
        target = 10
        hp_probs = sample_problems(
            domain=None, grade=grade_int, max_quarter=school_q, n=1, high_priority_only=True
        )
        regular_probs = sample_problems(
            domain=None, grade=grade_int, max_quarter=school_q, n=9, exclude_high_priority=True
        )
        bank_pool = hp_probs + regular_probs
        logger.info(
            f"Grade-level front Q{school_q}: {len(hp_probs)} HP + {len(regular_probs)} regular"
        )

    shortfall = target - len(bank_pool)
    if shortfall > 0:
        logger.warning(f"Bank short by {shortfall} for {class_type} front — Claude filling.")
        fill_sys, fill_usr = _fill_prompt(grade_int, shortfall)
        fill_data = await _call(fill_sys, fill_usr, _fill_tool(shortfall))
        bank_pool += fill_data.get("problems", [])
    else:
        logger.info(f"Front fully covered by bank (Q1–Q{school_q}).")

    random.shuffle(bank_pool)
    return bank_pool[:target]


# ── Main entry point ──────────────────────────────────────────────────────────

async def generate_problems(context: WeekContext, class_type: str) -> dict:
    grade_int = int(str(context.grade).split("_")[0])
    current_lessons = context.current_lessons

    # Derive school quarter from the specific date or week start
    date_str = (
        getattr(context, "specific_date", None)
        or getattr(context, "week_start", None)
        or ""
    )
    school_q = _school_quarter(str(date_str))
    logger.info(f"School quarter derived: Q{school_q} from date '{date_str}'")

    back_sys, back_content = _back_prompt(
        grade=context.grade,
        class_type=class_type,
        current_lessons=current_lessons,
        current_topic=context.current_topic,
        spiral_topics="",
    )

    front_problems, back_data = await asyncio.gather(
        _assemble_front(grade_int, class_type, school_q),
        _call(back_sys, back_content, BACK_TOOL),
    )

    return {
        "spiral_topics":      "",
        "front_problems":     front_problems,
        "lesson_title":       back_data.get("lesson_title", context.lesson_title),
        "back_problems":      back_data.get("problems", []),
        "challenge_problems": [],
    }
