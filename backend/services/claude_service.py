from __future__ import annotations
import os, asyncio, logging
from pathlib import Path
import anthropic
from services.pacing import WeekContext
from services.lesson_pdf import find_lesson_pdf, pdf_to_base64
from routes.bank import sample_problems

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
- Diagrams: use tikz, compact (under 4cm tall). Always add \\vspace{10pt} on its own line immediately before \\begin{tikzpicture}.
- Multiple choice: always add \\vspace{10pt} on its own line immediately before the first answer option (\\textbf{A.} or similar).
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
                "description": "Spiral review problems — exactly 8 for honors, exactly 10 for grade-level.",
                "items": {
                    "type": "object",
                    "properties": {
                        "latex": {"type": "string", "description": "Problem text in LaTeX."}
                    },
                    "required": ["latex"]
                },
                "minItems": 8,
                "maxItems": 10,
            },
        },
        "required": ["spiral_topics", "problems"],
    },
}

BACK_TOOL = {
    "name": "submit_back_problems",
    "description": "Submit the lesson-aligned practice problems for the back page of the homework sheet. NEVER include error analysis problems ('a student says X, identify the error') — skip this type even if it appears in the provided worksheet.",
    "input_schema": {
        "type": "object",
        "properties": {
            "lesson_title": {
                "type": "string",
                "description": "Short topic name, 4-6 words. Must match the exact lesson topic — do not broaden (e.g. 'Area of parallelograms' not 'Area of quadrilaterals')."
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



def _front_prompt(grade, current, bank_problems: list[dict], n_problems: int = 10):
    """
    Build the spiral review prompt using approved bank problems as templates.
    Claude varies numbers/context but preserves structure — no free generation.
    Falls back to topic-based generation if bank is empty.
    n_problems: 8 for honors (5 honors + 3 regular), 10 for grade-level.
    """
    if bank_problems:
        system = STYLE_NOTES + f"""
Rules for spiral review problems:
- Exactly {n_problems} problems total.
- Use the bank problems below as your ONLY source of problem structures.
  Change the numbers, names, and contexts — preserve the problem type exactly.
- Do NOT invent new problem types not represented in the bank problems.
- Do NOT include the current week's lesson topic.
- No multi-step word problems. Each solvable in 60-90 seconds.
- STRICT LENGTH: each problem must be under 30 words of prose. No sub-parts (a/b/c).
  Do NOT use \\textbf{{a.}} or \\textbf{{b.}} in spiral problems.
- It is fine — even expected — for multiple problems to share the same structure
  with different numbers. Repetition of structure is correct here.
"""
        bank_text = "\n\n".join(
            f"[{p.get('domain','?')} Q{p.get('quarter','?')}] {p['latex']}"
            for p in bank_problems
        )
        user = (
            f"Grade: {grade}\n"
            f"Current week topic (do NOT include): {current}\n\n"
            f"Bank problems to use as templates (vary numbers/context only):\n\n"
            f"{bank_text}\n\n"
            f"Generate exactly {n_problems} spiral review problems by varying the bank problems above. "
            "Use each bank problem as a structural template at least once. "
            f"If you have more than {n_problems} templates, pick the most varied set."
        )
    else:
        # Fallback: free generation when bank is empty (early in the year)
        system = STYLE_NOTES + f"""
Rules for spiral review problems:
- Exactly {n_problems} problems total.
- Only use topics from covered_topics list.
- Weight toward 8 most recently covered topics.
- Vary types: computation, explanation, fill-in, true/false.
- No multi-step word problems. Each solvable in 60-90 seconds.
- STRICT LENGTH: each problem must be under 30 words of prose. No sub-parts (a/b/c).
  Do NOT use \\textbf{{a.}} or \\textbf{{b.}} in spiral problems.
"""
        user = (
            f"Grade: {grade}\n"
            f"Current week (do NOT include): {current}\n"
            f"Generate {n_problems} spiral review problems on covered arithmetic topics."
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
    n = "8-10"  # same count for both honors and grade-level

    system = STYLE_NOTES + f"""
Rules for lesson practice problems:
- Exactly {n} problems on the EXACT topic: {current_topic}.
- Stay strictly within this lesson's scope. Do NOT introduce concepts from
  neighboring lessons, later lessons in the chapter, or the broader topic area.
  Example: if the lesson is "area of parallelograms", generate ONLY parallelogram
  problems — not trapezoids, rhombuses, or generic quadrilaterals.
- The lesson_title you return must match the exact lesson topic. Do not broaden it.
- Order easier to harder.
- Do not repeat topics from spiral_topics: {spiral_topics}
- Match the style, format, and difficulty of the provided worksheet exactly —
  same problem structure, same vocabulary, same level of scaffolding.
- Vary problem types (computation, word problem, true/false) but only as those types
  appear in the provided worksheet.
- NEVER generate error analysis problems ("a student says X, identify the error").
  Skip this type even if it appears in the provided worksheet.
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
                    f"Below is the lesson worksheet from the textbook for this exact lesson: "
                    f"{current_topic}. "
                    "This worksheet defines the topic boundary — generate NEW problems that "
                    "cover ONLY what is shown in this worksheet, using different numbers and "
                    "contexts. Do not introduce any concept not present in this worksheet. "
                    "Match the problem structure, wording style, and scaffolding level exactly. "
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

    # Text instruction always goes last — repetition of topic constraint is intentional
    instruction = (
        f"Grade: {grade}, Class: {class_type}\n"
        f"Current lesson: {', '.join(current_lessons)}\n"
        f"Exact topic (stay strictly within this): {current_topic}\n"
        "Generate lesson practice problems. Do NOT expand beyond the exact topic above."
    )
    if not pdf_found:
        instruction = (
            f"No worksheet PDF is available. Generate problems based strictly on "
            f"the topic: {current_topic}. Do not expand to related topics or the "
            f"broader chapter — only this exact lesson.\n\n"
        ) + instruction

    content.append({"type": "text", "text": instruction})
    return system, content


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


def _school_quarter(date_str: str) -> int:
    """
    Derive school quarter (1-4) from a date string (YYYY-MM-DD).
    Approximate boundaries for a Sept-June school year:
      Q1: Sept-Oct, Q2: Nov-Jan, Q3: Feb-Mar, Q4: Apr-Jun
    """
    try:
        from datetime import date
        d = date.fromisoformat(str(date_str)[:10])
        m = d.month
        if m in (9, 10):
            return 1
        elif m in (11, 12, 1):
            return 2
        elif m in (2, 3):
            return 3
        else:
            return 4
    except Exception:
        return 1  # safe default


# Pool config — edit here to rebalance spiral review counts.
# Q1 school quarter uses arithmetic-only; later quarters use this config.
SPIRAL_POOL_CONFIG = [
    {"domain": "arithmetic",             "n": 4},
    {"domain": "geometry",               "n": 2},
    {"domain": "expressions_equations",  "n": 2},
    {"domain": "stats_probability",      "n": 1},
    {"domain": None,                     "n": 1},  # wildcard: any domain
]


async def generate_problems(context: WeekContext, class_type: str) -> dict:
    current_lessons = context.current_lessons
    current_str = ", ".join(current_lessons)
    grade_int = int(str(context.grade).split("_")[0])

    # Derive school quarter from request date to cap bank difficulty
    date_str = getattr(context, "specific_date", None) or getattr(context, "week_start", None) or ""
    school_q = _school_quarter(str(date_str))

    # ── Spiral bank sampling ──────────────────────────────────────────────────
    if class_type == "honors":
        # Honors front: 8 problems — 5 honors-flagged + 3 from the general bank.
        # Honors problems are drawn first; regular problems fill the remaining slots.
        honors_problems = sample_problems(
            domain=None,
            grade=grade_int,
            max_quarter=school_q,
            n=5,
            honors_only=True,
        )
        seen_ids: set[str] = {p["id"] for p in honors_problems}

        if school_q == 1:
            regular_problems = sample_problems(
                domain="arithmetic",
                grade=grade_int,
                max_quarter=1,
                n=3,
                exclude_honors=True,
            )
        else:
            regular_problems = []
            for pool in SPIRAL_POOL_CONFIG:
                batch = sample_problems(
                    domain=pool["domain"],
                    grade=grade_int,
                    max_quarter=school_q,
                    n=pool["n"],
                    exclude_honors=True,
                )
                for p in batch:
                    if p["id"] not in seen_ids and len(regular_problems) < 3:
                        regular_problems.append(p)
                        seen_ids.add(p["id"])

        spiral_bank = honors_problems + regular_problems
        n_spiral = 8
    else:
        # Grade-level front: 10 problems from the general bank.
        if school_q == 1:
            spiral_bank = sample_problems(
                domain="arithmetic",
                grade=grade_int,
                max_quarter=1,
                n=10,
                exclude_honors=True,
            )
        else:
            spiral_bank = []
            seen_ids = set()
            for pool in SPIRAL_POOL_CONFIG:
                problems = sample_problems(
                    domain=pool["domain"],
                    grade=grade_int,
                    max_quarter=school_q,
                    n=pool["n"],
                    exclude_honors=True,
                )
                for p in problems:
                    if p["id"] not in seen_ids:
                        spiral_bank.append(p)
                        seen_ids.add(p["id"])
        n_spiral = 10

    front_sys, front_usr = _front_prompt(context.grade, current_str, spiral_bank, n_spiral)

    # Front and back can always run concurrently — no challenge dependency.
    back_sys, back_content = _back_prompt(
        grade=context.grade,
        class_type=class_type,
        current_lessons=current_lessons,
        current_topic=context.current_topic,
        spiral_topics="",  # will be filled after front resolves; back doesn't need it at call time
    )
    front_data, back_data = await asyncio.gather(
        _call(front_sys, front_usr, FRONT_TOOL),
        _call(back_sys, back_content, BACK_TOOL),
    )

    return {
        "spiral_topics":      front_data.get("spiral_topics", ""),
        "front_problems":     front_data.get("problems", []),
        "lesson_title":       back_data.get("lesson_title", context.lesson_title),
        "back_problems":      back_data.get("problems", []),
        "challenge_problems": [],  # challenge section removed
    }
