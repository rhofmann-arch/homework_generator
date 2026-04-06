from __future__ import annotations
"""
Parse problems from main.tex (problem_bank/main.tex), generate one variation
per problem, and save both originals + variations directly as approved
honors=True, high_priority=False, Q1 problems.

Usage:
    python3 scripts/ingest_tex_honors.py [--dry-run]
"""
import argparse
import json
import re
import time
from pathlib import Path

import anthropic

BANK_ROOT = Path("problem_bank/grade_6")
TEX_FILE  = Path("problem_bank/main.tex")
MODEL     = "claude-sonnet-4-6"
BATCH_SIZE = 8

DOMAIN_CLASSIFY_SYSTEM = """\
You classify 6th grade math problems into one of these domains:
arithmetic, expressions_equations, geometry, stats_probability, other

Return a JSON array of domain strings, one per problem, in the same order.
Return ONLY the JSON array."""

VARIATION_SYSTEM = """\
You are generating math problem variations for a 6th grade honors problem bank.
For each template problem, generate exactly 1 new problem that:
- Has the IDENTICAL structure and problem type as the template
- Uses completely different numbers, names, units, and real-world context
- Has the same difficulty level and number of steps
- Is formatted in clean LaTeX (no \\vspace, \\paragraph, \\Large, or document commands)
- Provides a fully worked answer_latex showing the final numerical answer

Rules:
- Do NOT copy any numbers or context from the template
- Do NOT change the problem type or difficulty
- Keep LaTeX math in $...$ or \\[...\\] delimiters
- answer_latex should be just the answer, e.g. "$42$" or "$\\frac{1}{7}$"
"""


def extract_problems(tex: str) -> list[str]:
    """Extract problem bodies from \\paragraph{N. } ... \\vspace or next \\paragraph."""
    # Split on \paragraph{...} markers
    parts = re.split(r'\\paragraph\{[^}]+\}\s*', tex)
    problems = []
    for part in parts[1:]:  # skip preamble
        # Remove trailing \vspace, \end{document}, blank lines
        body = re.sub(r'\\vspace\{[^}]+\}.*', '', part, flags=re.DOTALL).strip()
        body = re.sub(r'\\end\{document\}.*', '', body, flags=re.DOTALL).strip()
        # Remove stray trailing $ not part of math
        body = re.sub(r'\$\s*$', '', body).strip()
        if body:
            problems.append(body)
    return problems


def classify_domains(client: anthropic.Anthropic, problems: list[str]) -> list[str]:
    """Classify each problem into a domain."""
    text = "\n\n".join(f"Problem {i+1}: {p}" for i, p in enumerate(problems))
    resp = client.messages.create(
        model=MODEL, max_tokens=1024,
        system=DOMAIN_CLASSIFY_SYSTEM,
        messages=[{"role": "user", "content": text}],
    )
    raw = resp.content[0].text.strip()
    m = re.search(r'\[.*\]', raw, re.DOTALL)
    if m:
        domains = json.loads(m.group())
        valid = {"arithmetic", "expressions_equations", "geometry", "stats_probability", "other"}
        return [d if d in valid else "arithmetic" for d in domains]
    return ["arithmetic"] * len(problems)


def generate_answers(client: anthropic.Anthropic, problems: list[str]) -> list[str]:
    """Get answer_latex for each original problem."""
    text = "\n\n".join(f"Problem {i+1}: {p}" for i, p in enumerate(problems))
    resp = client.messages.create(
        model=MODEL, max_tokens=2048,
        system="Solve each math problem. Return a JSON array of answer strings (LaTeX), one per problem. Return ONLY the JSON array.",
        messages=[{"role": "user", "content": text}],
    )
    raw = resp.content[0].text.strip()
    m = re.search(r'\[.*\]', raw, re.DOTALL)
    if m:
        return json.loads(m.group())
    return [""] * len(problems)


def generate_variations_batch(client: anthropic.Anthropic, problems: list[str]) -> list[dict]:
    """Generate one variation per problem in the batch."""
    blocks = "\n\n".join(f"Problem {i+1}:\n{p}" for i, p in enumerate(problems))
    user = (
        f"Here are {len(problems)} math problems. For each, generate exactly 1 variation.\n"
        f"Return a JSON array of exactly {len(problems)} objects.\n"
        "Each object must have: latex (string), answer_latex (string).\n\n"
        + blocks
        + "\n\nReturn ONLY the JSON array."
    )
    resp = client.messages.create(
        model=MODEL, max_tokens=8192,
        system=VARIATION_SYSTEM,
        messages=[{"role": "user", "content": user}],
    )
    raw = resp.content[0].text.strip()
    m = re.search(r'\[.*\]', raw, re.DOTALL)
    if not m:
        print("  [warn] could not parse variation JSON")
        return [{"latex": "", "answer_latex": ""}] * len(problems)
    try:
        return json.loads(m.group())
    except json.JSONDecodeError as e:
        print(f"  [warn] JSON error: {e}")
        return [{"latex": "", "answer_latex": ""}] * len(problems)


def next_id(prefix: str, domain: str, quarter: int) -> str:
    folder = BANK_ROOT / domain / f"q{quarter}"
    existing = set()
    if folder.exists():
        for f in folder.glob(f"{prefix}_*.json"):
            m = re.search(rf"{prefix}_(\d+)", f.name)
            if m:
                existing.add(int(m.group(1)))
    n = 1
    while n in existing:
        n += 1
    return f"{prefix}_{n:04d}"


def save_problem(prob_id: str, latex: str, answer_latex: str, domain: str,
                 quarter: int, source_note: str) -> Path:
    data = {
        "id":           prob_id,
        "domain":       domain,
        "grade":        6,
        "quarter":      quarter,
        "latex":        latex.strip(),
        "answer_latex": answer_latex.strip(),
        "honors":       True,
        "high_priority": False,
        "approved":     True,
        "flagged":      False,
        "notes":        source_note,
        "source":       "tex_import",
    }
    dest = BANK_ROOT / domain / f"q{quarter}" / f"{prob_id}.json"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(data, indent=2))
    return dest


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    tex = TEX_FILE.read_text()
    problems = extract_problems(tex)
    print(f"Extracted {len(problems)} problems from {TEX_FILE}")

    if args.dry_run:
        for i, p in enumerate(problems, 1):
            print(f"  {i}. {p[:80]}...")
        return

    client = anthropic.Anthropic()

    # Step 1: classify domains for all problems
    print("Classifying domains...")
    domains = classify_domains(client, problems)
    print(f"  Domains: {domains}")

    # Step 2: get answers for originals
    print("Solving originals...")
    answers = generate_answers(client, problems)

    # Step 3: save originals
    print("Saving originals...")
    saved_orig = 0
    for i, (prob, domain, answer) in enumerate(zip(problems, domains, answers), 1):
        pid = next_id("tex_honors_q1", domain, 1)
        save_problem(pid, prob, str(answer), domain, 1, f"Imported from main.tex problem {i}")
        print(f"  [{i:2d}] {pid} ({domain})")
        saved_orig += 1

    # Step 4: generate and save variations in batches
    print(f"\nGenerating {len(problems)} variations in batches of {BATCH_SIZE}...")
    saved_var = 0
    for batch_start in range(0, len(problems), BATCH_SIZE):
        batch_probs   = problems[batch_start: batch_start + BATCH_SIZE]
        batch_domains = domains[batch_start: batch_start + BATCH_SIZE]
        print(f"  Batch {batch_start // BATCH_SIZE + 1}: problems {batch_start+1}–{batch_start+len(batch_probs)}")
        try:
            variations = generate_variations_batch(client, batch_probs)
        except Exception as e:
            print(f"  [error] {e} — skipping batch")
            time.sleep(5)
            continue

        for orig_idx, (var, domain) in enumerate(zip(variations, batch_domains)):
            latex = var.get("latex", "")
            answer = var.get("answer_latex", "")
            if not latex:
                print(f"    [warn] empty variation for problem {batch_start + orig_idx + 1}")
                continue
            pid = next_id("varh_honors_q1", domain, 1)
            save_problem(pid, latex, answer, domain, 1,
                         f"Variation of main.tex problem {batch_start + orig_idx + 1}")
            saved_var += 1

        time.sleep(1)

    print(f"\nDone. Originals saved: {saved_orig}, Variations saved: {saved_var}")
    print(f"Total new honors Q1 problems: {saved_orig + saved_var}")


if __name__ == "__main__":
    main()
