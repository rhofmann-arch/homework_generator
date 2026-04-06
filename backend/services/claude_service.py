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
                "minItems": 1,
                "maxItems": 20,
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

SINGLE_PROBLEM_TOOL = {
    "name": "submit_single_problem",
    "description": "Submit exactly one replacement problem with its answer.",
    "input_schema": {
        "type": "object",
        "properties": {
            "latex":        {"type": "string", "description": "Problem text in LaTeX."},
            "answer_latex": {"type": "string", "description": "Answer in LaTeX (e.g. $42$ or $\\dfrac{3}{4}$)."},
        },
        "required": ["latex", "answer_latex"],
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
    lesson_templates: list[dict] | None = None,
    n_back: int | None = None,
) -> tuple[str, list]:
    """
    Returns (system_prompt, user_content_blocks).

    If lesson_templates is provided (approved bank problems tagged with the
    current lesson number), Claude is locked to those problem structures and
    can only vary numbers/context. This eliminates topic drift entirely.

    If lesson_templates is empty/None, falls back to PDF context + free generation.
    """
    n = str(n_back) if n_back is not None else ("5-7" if class_type == "honors" else "8-10")

    # ── Template-locked path (bank problems exist for this lesson) ──────────────
    if lesson_templates:
        templates_text = "\n\n".join(
            f"Template {i+1}:\n{p['latex']}" for i, p in enumerate(lesson_templates)
        )
        system = STYLE_NOTES + f"""
Rules for lesson practice problems:
- Generate exactly {n} problems on the topic: {current_topic}.
- You MUST use the provided templates as your structural guide.
- For each problem you generate: keep the same problem TYPE and STRUCTURE as a
  template, but change ALL numbers, names, units, and real-world context.
- Do not introduce any concept, operation, or problem type not present in the templates.
- Do not copy templates verbatim — every problem must use different values.
- The lesson_title you return must match the exact topic. Do not broaden it.
- Order easier to harder.
- Do not repeat topics from spiral_topics: {spiral_topics}
"""
        content = [{
            "type": "text",
            "text": (
                f"Grade: {grade}, Class: {class_type}\n"
                f"Lesson: {', '.join(current_lessons)} — {current_topic}\n\n"
                f"Approved bank problems for this lesson (use as structural templates):\n\n"
                f"{templates_text}\n\n"
                f"Generate {n} new problems by varying the templates above. "
                "Change numbers, names, and context — preserve structure exactly."
            )
        }]
        return system, content

    # ── Free-generation path (no bank templates yet for this lesson) ────────────
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
- Vary problem types (computation, word problem, true/false, fill-in-the-blank)
  but only as those types appear in the provided worksheet.
- NEVER generate error analysis problems ("a student says X, identify the error").
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
            "source": {"type": "base64", "media_type": "application/pdf",
                       "data": pdf_to_base64(lesson_pdf)},
            "title": f"Lesson {lesson} worksheet",
        })
        if key_pdf:
            content.append({
                "type": "document",
                "source": {"type": "base64", "media_type": "application/pdf",
                           "data": pdf_to_base64(key_pdf)},
                "title": f"Lesson {lesson} answer key",
            })

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


def _challenge_prompt(
    current_topic: str,
    current_lessons: list[str],
    bank_problems: list[dict],
) -> tuple[str, str]:
    """
    Build the challenge prompt. If approved honors problems exist in the bank
    for this topic area, pass them as structural models for Claude to vary.
    Otherwise fall back to free generation.
    """
    system = STYLE_NOTES + f"""
Rules for challenge problems:
- Exactly 2 multi-step challenge problems.
- Problems must be on the current lesson topic: {current_topic}.
- Extend the lesson into non-routine territory — multi-step, real-world application,
  or reasoning-heavy. Do NOT introduce concepts beyond the current lesson.
- Solvable by a strong 6th grader in 3-5 minutes each.
- Match the rigor and style of any example problems provided below.
"""

    if bank_problems:
        examples = "\n\n".join(
            f"Example {i+1}:\n{p['latex']}" for i, p in enumerate(bank_problems)
        )
        user = (
            f"Current lesson: {', '.join(current_lessons)}\n"
            f"Exact topic: {current_topic}\n\n"
            "Here are approved challenge problems from the bank that represent "
            "the right difficulty and style. Use these as structural models — "
            "change the numbers, context, and scenario, but preserve the multi-step "
            "reasoning structure:\n\n"
            f"{examples}\n\n"
            "Generate 2 new challenge problems at this level, on the current topic."
        )
    else:
        user = (
            f"Current lesson: {', '.join(current_lessons)}\n"
            f"Exact topic: {current_topic}\n"
            "Generate 2 challenge problems on this exact topic."
        )

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



# ── Quarter helper ─────────────────────────────────────────────────────────────

def _school_quarter(date_str: str) -> int:
    """Map a YYYY-MM-DD date to the school quarter (1–4)."""
    from datetime import date
    d = date.fromisoformat(date_str)
    m = d.month
    if m in (8, 9, 10):  return 1
    if m in (11, 12, 1): return 2
    if m in (2, 3):       return 3
    return 4  # Apr–Jun


# ── Fill-front tool (variable count, also returns spiral_topics) ───────────────

FILL_FRONT_TOOL = {
    "name": "submit_fill_problems",
    "description": "Submit spiral review problems to fill the shortfall not covered by the problem bank.",
    "input_schema": {
        "type": "object",
        "properties": {
            "spiral_topics": {
                "type": "string",
                "description": "3-6 word comma-separated summary of ALL spiral topics (bank + generated)."
            },
            "problems": {
                "type": "array",
                "description": "Spiral review problems, ordered by variety of topic.",
                "items": {
                    "type": "object",
                    "properties": {
                        "latex": {"type": "string", "description": "Problem text in LaTeX."}
                    },
                    "required": ["latex"]
                },
                "minItems": 1,
                "maxItems": 10,
            },
        },
        "required": ["spiral_topics", "problems"],
    },
}


def _fill_front_prompt(
    n_needed: int,
    grade: str,
    bank_latex: list[str],
    style_examples: list[dict] | None = None,
) -> tuple[str, str]:
    """
    Prompt Claude to generate n_needed additional spiral review problems
    when the bank doesn't have enough approved problems to fill the front.
    style_examples: approved bank problems shown to Claude as style/difficulty guides.
    """
    system = STYLE_NOTES + f"""
You are generating spiral review problems to supplement an approved problem bank.
You will be shown examples of approved problems from the bank — match their style,
format, difficulty, and LaTeX conventions exactly.

Rules:
- Generate exactly {n_needed} problems.
- Cover a broad variety of 6th-grade topics already studied this year
  (arithmetic, fractions, decimals, ratios, basic geometry, expressions).
- Do NOT reference the current lesson topic.
- Match the difficulty and format of the provided examples.
- Each solvable in 60–90 seconds without a calculator.
- No multi-step word problems.
"""

    examples_text = ""
    if style_examples:
        examples_text = "\n\nHere are examples from the approved bank — match this style and difficulty:\n"
        for i, ex in enumerate(style_examples[:6], 1):
            topic = ex.get("topic", "")
            latex = ex.get("latex", "")[:200]
            answer = ex.get("answer_latex", "")
            examples_text += f"\nExample {i} ({topic}):\n  Problem: {latex}\n"
            if answer:
                examples_text += f"  Answer: {answer}\n"

    already = ""
    if bank_latex:
        already = (
            "\n\nThese problems are already on this assignment — "
            "do NOT repeat topics or problem structures:\n"
            + "\n".join(f"  • {lat[:120]}" for lat in bank_latex[:8])
        )

    user = (
        f"Grade: {grade}\n"
        + examples_text
        + already
        + f"\n\nGenerate {n_needed} new spiral review problems in the same style as the examples above."
    )
    return system, user


# ── Bank-first front assembly ──────────────────────────────────────────────────

async def _assemble_front(
    context: WeekContext,
    class_type: str,
    specific_date: str,
) -> tuple[list[dict], str, list[str]]:
    """
    Assemble the front-page spiral review using the problem bank as the
    primary source, with Claude filling any shortfall.

    Returns (problems_list, spiral_topics_str, slots_list).
    slots_list entries: "hp", "honors", "regular", or "fill".

    Grade Level (10 problems):
      • 1  high_priority=True, approved=True, honors excluded
      • 9  approved=True, not high_priority, honors excluded

    Honors (8 problems):
      • 5  honors=True, approved=True
      • 3  approved=True, not honors

    If bank total < target: Claude fills shortfall — NO pacing guide reference.
    """
    school_q  = _school_quarter(specific_date)
    grade_int = int(str(context.grade).split("_")[0])

    if class_type == "honors":
        target = 8
        hp_slot     = sample_problems(domain=None, grade=grade_int, max_quarter=school_q,
                                      n=1, high_priority_only=True, exclude_lesson=True)
        honors_rest = sample_problems(domain=None, grade=grade_int, max_quarter=school_q,
                                      n=4, honors_only=True, exclude_high_priority=True,
                                      exclude_lesson=True)
        regular     = sample_problems(domain=None, grade=grade_int, max_quarter=school_q,
                                      n=3, exclude_honors=True, exclude_lesson=True)
        bank_problems = hp_slot + honors_rest + regular
        slots = (["hp"] * len(hp_slot)
                 + ["honors"] * len(honors_rest)
                 + ["regular"] * len(regular))
    else:
        target = 10
        hp_slot = sample_problems(domain=None, grade=grade_int, max_quarter=school_q,
                                  n=1, high_priority_only=True, exclude_honors=True,
                                  exclude_lesson=True)
        rest    = sample_problems(domain=None, grade=grade_int, max_quarter=school_q,
                                  n=9, exclude_high_priority=True, exclude_honors=True,
                                  exclude_lesson=True)
        bank_problems = hp_slot + rest
        slots = ["hp"] * len(hp_slot) + ["regular"] * len(rest)

    bank_latex = [p["latex"] for p in bank_problems]
    shortfall  = target - len(bank_problems)

    generated_problems: list[dict] = []
    spiral_topics = "arithmetic, fractions, ratios, geometry, expressions"

    if shortfall > 0:
        # Sample extra approved bank problems as style examples for Claude.
        # Use a larger n than needed, exclude already-selected problems.
        used_latex = set(bank_latex)
        style_pool = sample_problems(
            domain=None, grade=grade_int, max_quarter=school_q,
            n=12, exclude_lesson=True,
        )
        style_examples = [p for p in style_pool if p["latex"] not in used_latex][:6]

        fill_sys, fill_usr = _fill_front_prompt(shortfall, context.grade, bank_latex,
                                                style_examples=style_examples)
        fill_data      = await _call(fill_sys, fill_usr, FILL_FRONT_TOOL)
        generated_problems = fill_data.get("problems", [])
        spiral_topics      = fill_data.get("spiral_topics", spiral_topics)
        slots += ["fill"] * len(generated_problems)

    all_problems = [{"latex": lat} for lat in bank_latex] + generated_problems
    return all_problems, spiral_topics, slots


async def generate_problems(
    context: WeekContext,
    class_type: str,
    specific_date: str | None = None,
    n_back: int | None = None,
) -> dict:
    date_str = specific_date or context.week_start

    front_problems, spiral_topics, front_slots = await _assemble_front(context, class_type, date_str)

    # Sample approved bank problems for this lesson to use as templates.
    # Eliminates back-page topic drift — Claude varies numbers only, can't invent new types.
    grade_int = int(str(context.grade).split("_")[0])
    lesson_templates: list[dict] = []

    if context.review_chapter:
        # Review/test week: pull ch{N}_test tagged problems as back-page templates
        review_tag = f"ch{context.review_chapter}_test"
        lesson_templates = sample_problems(
            domain=None, grade=grade_int, max_quarter=4, n=6, lesson=review_tag,
            class_type=class_type,
        )
        logger.info(
            f"Review week (ch {context.review_chapter}): "
            f"found {len(lesson_templates)} bank templates tagged '{review_tag}'"
        )
    else:
        for lesson in context.current_lessons:
            templates = sample_problems(
                domain=None, grade=grade_int, max_quarter=4, n=6, lesson=lesson,
                class_type=class_type,
            )
            lesson_templates.extend(templates)
        if len(lesson_templates) > 6:
            import random as _random
            lesson_templates = _random.sample(lesson_templates, 6)
        if lesson_templates:
            logger.info(f"Found {len(lesson_templates)} bank templates for lesson(s) {context.current_lessons}")
        else:
            logger.info(f"No bank templates for lesson(s) {context.current_lessons} — using PDF/free generation")

    # For review weeks, use the review tag as the "lesson" label so the back
    # prompt describes the correct context to Claude.
    if context.review_chapter:
        back_lessons = [f"ch{context.review_chapter}_test"]
        back_topic = context.current_topic  # e.g. "Review Day Ch 3"
    else:
        back_lessons = context.current_lessons
        back_topic = context.current_topic

    back_sys, back_content = _back_prompt(
        grade=context.grade,
        class_type=class_type,
        current_lessons=back_lessons,
        current_topic=back_topic,
        spiral_topics=spiral_topics,
        lesson_templates=lesson_templates or None,
        n_back=n_back,
    )
    back_data = await _call(back_sys, back_content, BACK_TOOL)

    return {
        "spiral_topics":      spiral_topics,
        "front_problems":     front_problems,
        "front_slots":        front_slots,
        "lesson_title":       back_data.get("lesson_title", context.lesson_title),
        "back_problems":      back_data.get("problems", []),
        "challenge_problems": [],   # challenge block removed — honors distinction
                                    # comes from honors-flagged bank problems on front
        "_context": {
            "week_start":       context.week_start,
            "specific_date":    date_str,
            "grade":            str(context.grade).split("_")[0],
            "class_type":       class_type,
            "current_lessons":  context.current_lessons,
            "current_topic":    context.current_topic,
        },
    }


# ── Single-problem refresh helpers ────────────────────────────────────────────

async def refresh_front_problem(
    slot: str,
    grade: int,
    class_type: str,
    school_q: int,
) -> dict:
    """
    Return one replacement front problem {latex, answer_latex}.
    Samples from the bank using the same slot filters as the original assembly.
    Falls back to Claude if the bank returns nothing.
    """
    import random as _random

    bank_result: list[dict] = []
    if slot == "hp":
        bank_result = sample_problems(domain=None, grade=grade, max_quarter=school_q,
                                      n=3, high_priority_only=True, exclude_lesson=True)
    elif slot == "honors":
        bank_result = sample_problems(domain=None, grade=grade, max_quarter=school_q,
                                      n=3, honors_only=True, exclude_high_priority=True,
                                      exclude_lesson=True)
    elif slot == "regular":
        exclude_honors = (class_type != "honors")
        bank_result = sample_problems(domain=None, grade=grade, max_quarter=school_q,
                                      n=3, exclude_honors=exclude_honors,
                                      exclude_high_priority=True, exclude_lesson=True)

    if bank_result:
        p = _random.choice(bank_result)
        return {"latex": p["latex"], "answer_latex": p.get("answer_latex", "")}

    # Fallback: Claude generates 1 problem
    system = STYLE_NOTES + """
Generate exactly 1 spiral review problem for 6th grade.
Cover a topic already studied this year (arithmetic, fractions, ratios, expressions, basic geometry).
The problem must be solvable in 60-90 seconds. Provide the answer.
"""
    user = f"Grade: {grade}\nGenerate 1 spiral review problem."
    data = await _call(system, user, SINGLE_PROBLEM_TOOL)
    return {"latex": data.get("latex", ""), "answer_latex": data.get("answer_latex", "")}


async def refresh_back_problem(
    grade: int,
    class_type: str,
    current_lessons: list[str],
    current_topic: str,
    spiral_topics: str,
) -> dict:
    """
    Return one replacement back problem {latex, answer_latex}.
    Uses lesson bank templates if available, otherwise free generation.
    """
    import random as _random

    templates: list[dict] = []
    for lesson in current_lessons:
        templates.extend(
            sample_problems(domain=None, grade=grade, max_quarter=4, n=3, lesson=lesson,
                            class_type=class_type)
        )

    if templates:
        tmpl = _random.choice(templates)
        system = STYLE_NOTES + f"""
Generate exactly 1 lesson practice problem on the topic: {current_topic}.
Use the provided template as your structural guide — keep the same problem TYPE and STRUCTURE,
but change ALL numbers, names, units, and real-world context.
Do not copy the template verbatim. Do not repeat topics from spiral_topics: {spiral_topics}.
Provide the answer.
"""
        user = f"Template:\n{tmpl['latex']}\n\nGenerate 1 new problem by varying this template."
        data = await _call(system, user, SINGLE_PROBLEM_TOOL)
        return {"latex": data.get("latex", ""), "answer_latex": data.get("answer_latex", "")}

    # Fallback: free generation
    system = STYLE_NOTES + f"""
Generate exactly 1 lesson practice problem on the exact topic: {current_topic}.
Stay strictly within this lesson's scope. Provide the answer.
Do not repeat topics from spiral_topics: {spiral_topics}.
"""
    user = (
        f"Grade: {grade}, Class: {class_type}\n"
        f"Topic: {current_topic}\n"
        "Generate 1 lesson practice problem."
    )
    data = await _call(system, user, SINGLE_PROBLEM_TOOL)
    return {"latex": data.get("latex", ""), "answer_latex": data.get("answer_latex", "")}
