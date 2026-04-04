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
                "description": "Spiral review problems (count specified in prompt).",
                "items": {
                    "type": "object",
                    "properties": {
                        "latex": {"type": "string", "description": "Problem text in LaTeX."},
                        "answer_latex": {"type": "string", "description": "Answer in LaTeX."},
                    },
                    "required": ["latex", "answer_latex"]
                },
                "minItems": 1,
                "maxItems": 10,
            },
        },
        "required": ["spiral_topics", "problems"],
    },
}

BACK_TOOL = {
    "name": "submit_back_problems",
    "description": (
        "Submit the lesson-aligned practice problems for the back page of the homework sheet. "
        "Do NOT generate error analysis problems."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "lesson_title": {
                "type": "string",
                "description": "Short topic name, 4-6 words. Must match the exact lesson topic — do not broaden (e.g. 'Area of parallelograms' not 'Area of quadrilaterals')."
            },
            "problems": {
                "type": "array",
                "description": "Lesson practice problems, ordered easier to harder. No error analysis problems.",
                "items": {
                    "type": "object",
                    "properties": {
                        "latex": {"type": "string", "description": "Problem text in LaTeX."},
                        "answer_latex": {"type": "string", "description": "Answer in LaTeX."},
                    },
                    "required": ["latex", "answer_latex"]
                },
                "minItems": 5,
                "maxItems": 10,
            },
        },
        "required": ["lesson_title", "problems"],
    },
}


def _school_quarter(month: int) -> int:
    """Map calendar month to school quarter (Q1=Aug–Oct, Q2=Nov–Jan, Q3=Feb–Mar, Q4=Apr–Jun)."""
    if month in (8, 9, 10):
        return 1
    elif month in (11, 12, 1):
        return 2
    elif month in (2, 3):
        return 3
    else:
        return 4


def _front_prompt(grade, covered, current, n_to_generate: int):
    system = STYLE_NOTES + f"""
Rules for spiral review problems:
- Exactly {n_to_generate} problems total.
- Only use topics from covered_topics list.
- Weight toward 8 most recently covered topics.
- Vary types: computation, explanation, fill-in, true/false.
- No multi-step word problems. Each solvable in 60-90 seconds.
- Every problem must include an answer_latex field with the correct answer.
"""
    user = (
        f"Grade: {grade}\n"
        f"Covered topics (oldest first): {covered}\n"
        f"Current week (do NOT include): {current}\n"
        f"Generate {n_to_generate} spiral review problems."
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
- Exactly {n} problems on the EXACT topic: {current_topic}.
- Stay strictly within this lesson's scope. Do NOT introduce concepts from
  neighboring lessons, later lessons in the chapter, or the broader topic area.
  Example: if the lesson is "area of parallelograms", generate ONLY parallelogram
  problems — not trapezoids, rhombuses, or generic quadrilaterals.
- The lesson_title you return must match the exact lesson topic. Do not broaden it.
- Order easier to harder.
- Do NOT generate error analysis problems under any circumstances.
- Do not repeat topics from spiral_topics: {spiral_topics}
- Match the style, format, and difficulty of the provided worksheet exactly —
  same problem structure, same vocabulary, same level of scaffolding.
- Vary problem types (computation, word problem, true/false)
  but only as those types appear in the provided worksheet.
- Every problem must include an answer_latex field with the correct answer.
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
        max_tokens=3000,
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


def _sample_high_priority_front(grade: int, max_quarter: int) -> dict | None:
    """
    Draw 1 approved high-priority problem for the front spiral slot.
    Returns the problem dict, or None if the HP bank is empty / not yet populated.
    Logs a warning if None so the teacher knows to populate the bank.
    """
    results = sample_problems(
        domain=None,
        grade=grade,
        max_quarter=max_quarter,
        n=1,
        high_priority_only=True,
        exclude_honors=False,   # HP bank is shared across tracks
    )
    if not results:
        logger.warning(
            "High-priority bank is empty or has no approved problems for "
            f"grade={grade} max_quarter={max_quarter}. "
            "Front spiral will be fully generated by Claude this week."
        )
        return None
    return results[0]


def _normalize_hp_for_front(hp_problem: dict) -> dict:
    """
    Convert a bank record to the {latex, answer_latex} shape expected by the
    front-page renderer.

    For open-ended problems (keep_mc=False): use latex as-is.
    For MC problems (keep_mc=True): use latex as-is — the front-page renderer
      will include choices_latex if present. If your renderer doesn't support
      MC on the front page yet, set keep_mc=False during bank review for these.
    """
    return {
        "latex": hp_problem.get("latex", ""),
        "answer_latex": hp_problem.get("answer_latex", ""),
        # Pass through MC fields so the renderer can decide what to do
        "keep_mc": hp_problem.get("keep_mc", False),
        "choices_latex": hp_problem.get("choices_latex", {}),
        "high_priority": True,
        "id": hp_problem.get("id", ""),
    }


async def generate_problems(context: WeekContext, class_type: str) -> dict:
    covered = ", ".join(context.covered_topics[-20:])
    current_lessons = context.current_lessons
    current_str = ", ".join(current_lessons)

    import datetime
    current_month = datetime.date.today().month
    school_q = _school_quarter(current_month)

    # ── Sample 1 high-priority problem for the front spiral ──────────────────
    hp_problem = _sample_high_priority_front(int(str(context.grade).split("_")[0]), school_q)
    n_claude_front = 9 if hp_problem else 10  # Claude fills the remaining slots

    # Honors: 8-problem spiral (5 honors + 3 regular) → 7 if HP slot is filled
    # Grade-level: 10-problem spiral → 9 if HP slot is filled
    if class_type == "honors":
        n_claude_front = 7 if hp_problem else 8

    front_sys, front_usr = _front_prompt(context.grade, covered, current_str, n_claude_front)

    # ── Back page (fully generated, no HP slot) ──────────────────────────────
    back_sys, back_content = _back_prompt(
        grade=context.grade,
        class_type=class_type,
        current_lessons=current_lessons,
        current_topic=context.current_topic,
        spiral_topics="",  # front and back run concurrently
    )

    if class_type == "honors":
        # Sample honors bank problems as structural models for challenge generation.
        # (These feed the back page — separate from the HP front slot.)
        bank_honors = sample_problems(
            domain=None,
            grade=int(str(context.grade).split("_")[0]),
            max_quarter=school_q,
            n=4,
            honors_only=True,
            exclude_high_priority=False,  # honors HP problems are fine models too
        )
        if bank_honors:
            # Append honor model examples to back content as a hint
            examples = "\n\n".join(
                f"Example {i+1}:\n{p['latex']}" for i, p in enumerate(bank_honors)
            )
            honors_note = (
                "\n\nHere are approved honors-level problems from the bank that represent "
                "appropriate difficulty and style. Use these as structural models only — "
                "change numbers, context, and scenario:\n\n" + examples
            )
            back_content.append({"type": "text", "text": honors_note})

        front_data, back_data = await asyncio.gather(
            _call(front_sys, front_usr, FRONT_TOOL),
            _call(back_sys, back_content, BACK_TOOL),
        )
    else:
        front_data, back_data = await asyncio.gather(
            _call(front_sys, front_usr, FRONT_TOOL),
            _call(back_sys, back_content, BACK_TOOL),
        )

    spiral_topics = front_data.get("spiral_topics", "")
    claude_front_problems = front_data.get("problems", [])

    # ── Combine HP slot + Claude-generated front problems ────────────────────
    if hp_problem:
        hp_normalized = _normalize_hp_for_front(hp_problem)
        # Insert HP problem at a random position so it doesn't always appear first
        import random
        insert_pos = random.randint(0, len(claude_front_problems))
        front_problems = (
            claude_front_problems[:insert_pos]
            + [hp_normalized]
            + claude_front_problems[insert_pos:]
        )
        logger.info(
            f"High-priority problem {hp_problem.get('id')} inserted at front position {insert_pos + 1}"
        )
    else:
        front_problems = claude_front_problems

    # Shortfall cap: if HP bank was smaller than requested, log it
    if hp_problem and len(front_problems) < (10 if class_type != "honors" else 8):
        logger.warning(
            f"Front spiral has only {len(front_problems)} problems "
            f"(expected {'8' if class_type == 'honors' else '10'}). "
            "Check that Claude returned the correct count."
        )

    return {
        "spiral_topics":  spiral_topics,
        "front_problems": front_problems,
        "lesson_title":   back_data.get("lesson_title", context.lesson_title),
        "back_problems":  back_data.get("problems", []),
        # challenge_problems removed — honors redesign uses same back format
        "challenge_problems": [],
    }
