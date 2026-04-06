from __future__ import annotations
"""
Double the high-priority bank by generating one matched variation per approved
HP problem (no lesson tag). Variations are saved directly as approved in the
same domain/quarter as the original.

Usage:
    python3 scripts/double_hp_bank.py [--dry-run]
"""
import argparse
import json
import re
import sys
import time
from pathlib import Path

import anthropic

BANK_ROOT = Path("problem_bank/grade_6")
MODEL = "claude-sonnet-4-6"
BATCH_SIZE = 8   # problems per API call

SYSTEM = """\
You are generating math problem variations for a 6th grade problem bank.
For each template problem, generate exactly 1 new problem that:
- Has the IDENTICAL structure and problem type as the template
- Uses completely different numbers, names, units, and real-world context
- Has the same difficulty level and number of steps
- Is formatted in LaTeX exactly matching the template style
- Provides a fully worked answer_latex

Rules:
- Do NOT copy any numbers or context from the template
- Do NOT change the problem type or add new concepts
- MC problems: keep the same 4-choice format, generate plausible distractors
- If the template has a diagram note, keep needs_diagram=true and write similar diagram_notes
"""


def load_hp_problems() -> list[dict]:
    problems = []
    for f in sorted(BANK_ROOT.rglob("*.json")):
        if "_inbox" in str(f):
            continue
        try:
            d = json.loads(f.read_text())
            if (d.get("approved") and d.get("high_priority")
                    and not d.get("flagged") and not d.get("lesson")):
                d["_file"] = str(f)
                problems.append(d)
        except Exception:
            pass
    return problems


def next_var_id(domain: str, quarter: int) -> str:
    """Find the next available var_hp_g6_NNNN id in this domain/quarter folder."""
    folder = BANK_ROOT / domain / f"q{quarter}"
    existing = set()
    if folder.exists():
        for f in folder.glob("var_hp_g6_*.json"):
            m = re.search(r"var_hp_g6_(\d+)", f.name)
            if m:
                existing.add(int(m.group(1)))
    n = 1
    while n in existing:
        n += 1
    return f"var_hp_g6_{n:04d}"


def generate_batch(client: anthropic.Anthropic, templates: list[dict]) -> list[dict]:
    """Send a batch to Claude; returns list of {latex, answer_latex, needs_diagram?, diagram_notes?}."""
    blocks = []
    for i, p in enumerate(templates):
        block = f"Problem {i+1}:\nlatex: {p['latex']}\nanswer_latex: {p.get('answer_latex', '')}"
        if p.get("needs_diagram"):
            block += f"\nneeds_diagram: true\ndiagram_notes: {p.get('diagram_notes','')}"
        if p.get("choices_latex"):
            block += f"\nchoices_latex: {json.dumps(p['choices_latex'])}"
        blocks.append(block)

    user = (
        f"Here are {len(templates)} math problems. For each, generate exactly 1 variation.\n"
        f"Return a JSON array of exactly {len(templates)} objects.\n"
        "Each object must have: latex (string), answer_latex (string).\n"
        "Optionally include: choices_latex (array, for MC), needs_diagram (bool), diagram_notes (string).\n\n"
        + "\n\n".join(blocks)
        + "\n\nReturn ONLY the JSON array."
    )

    resp = client.messages.create(
        model=MODEL,
        max_tokens=8192,
        system=SYSTEM,
        messages=[{"role": "user", "content": user}],
    )
    text = resp.content[0].text.strip()
    m = re.search(r"\[.*\]", text, re.DOTALL)
    if not m:
        print(f"  [warn] could not parse JSON from response, skipping batch")
        return []
    try:
        return json.loads(m.group())
    except json.JSONDecodeError as e:
        print(f"  [warn] JSON parse error: {e}, skipping batch")
        return []


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    client = anthropic.Anthropic()
    problems = load_hp_problems()
    print(f"Found {len(problems)} eligible high-priority problems")

    # Skip any that already have a variation (idempotency)
    existing_sources: set[str] = set()
    for f in BANK_ROOT.rglob("var_hp_g6_*.json"):
        try:
            d = json.loads(f.read_text())
            if d.get("source_variation_of"):
                existing_sources.add(d["source_variation_of"])
        except Exception:
            pass
    to_process = [p for p in problems if p.get("id") not in existing_sources]
    print(f"Already varied: {len(problems) - len(to_process)} — to generate: {len(to_process)}")

    if args.dry_run:
        print("[dry-run] would generate", len(to_process), "variations")
        return

    saved = 0
    for batch_start in range(0, len(to_process), BATCH_SIZE):
        batch = to_process[batch_start: batch_start + BATCH_SIZE]
        print(f"  Batch {batch_start // BATCH_SIZE + 1}: problems {batch_start+1}–{batch_start+len(batch)}")
        try:
            variations = generate_batch(client, batch)
        except Exception as e:
            print(f"  [error] API call failed: {e} — skipping batch")
            time.sleep(5)
            continue

        if len(variations) != len(batch):
            print(f"  [warn] expected {len(batch)} variations, got {len(variations)} — skipping batch")
            continue

        for orig, var in zip(batch, variations):
            domain  = orig.get("domain", "arithmetic")
            quarter = orig.get("quarter", 1)
            new_id  = next_var_id(domain, quarter)

            new_prob = {
                "id":                   new_id,
                "domain":               domain,
                "grade":                orig.get("grade", 6),
                "quarter":              quarter,
                "topic":                orig.get("topic", ""),
                "latex":                var.get("latex", ""),
                "answer_latex":         var.get("answer_latex", ""),
                "high_priority":        True,
                "honors":               orig.get("honors", False),
                "approved":             True,
                "flagged":              False,
                "notes":                f"Generated variation of {orig.get('id')}",
                "source":               "generated",
                "source_variation_of":  orig.get("id"),
            }
            if var.get("choices_latex"):
                new_prob["choices_latex"] = var["choices_latex"]
                new_prob["keep_mc"] = True
            if var.get("needs_diagram"):
                new_prob["needs_diagram"] = True
                new_prob["diagram_notes"] = var.get("diagram_notes", orig.get("diagram_notes", ""))

            dest = BANK_ROOT / domain / f"q{quarter}" / f"{new_id}.json"
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_text(json.dumps(new_prob, indent=2))
            saved += 1

        # Brief pause between batches to avoid rate limits
        time.sleep(1)

    print(f"\nDone. Saved {saved} new variations.")


if __name__ == "__main__":
    main()
