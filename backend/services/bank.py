"""
Problem bank review API routes.

GET  /api/bank/review        — list problems from inbox (or by domain/quarter)
GET  /api/bank/stats         — counts by domain (total / approved / flagged / inbox)
POST /api/bank/approve       — assign domain + quarter, approve, move file
POST /api/bank/flag          — flag a problem (keep but mark for review)
DELETE /api/bank/delete      — permanently delete a problem
"""

from __future__ import annotations

import json
import os
import random
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

router = APIRouter()

BANK_ROOT = Path(os.environ.get("PROBLEM_BANK_ROOT", "problem_bank"))

VALID_DOMAINS = [
    "arithmetic",
    "expressions_equations",
    "geometry",
    "stats_probability",
    "other",
]
VALID_QUARTERS = [1, 2, 3, 4]


# ── Helpers ───────────────────────────────────────────────────────────────────

def grade_dir(grade: int = 6) -> Path:
    return BANK_ROOT / f"grade_{grade}"


def inbox_dir(grade: int = 6) -> Path:
    return grade_dir(grade) / "_inbox"


def problem_path(problem_id: str, grade: int = 6) -> Path | None:
    """Find a problem JSON by id — searches inbox first, then all domain folders."""
    gd = grade_dir(grade)
    # Check inbox first
    p = inbox_dir(grade) / f"{problem_id}.json"
    if p.exists():
        return p
    # Search domain/quarter folders
    for match in gd.rglob(f"{problem_id}.json"):
        if "_inbox" not in str(match):
            return match
    return None


def read_problem(path: Path) -> dict:
    data = json.loads(path.read_text())
    data["_path"] = str(path)  # internal — stripped before returning to client
    return data


def write_problem(path: Path, data: dict) -> None:
    clean = {k: v for k, v in data.items() if not k.startswith("_")}
    path.write_text(json.dumps(clean, indent=2))


def dest_path(domain: str, quarter: int, problem_id: str, grade: int = 6) -> Path:
    return grade_dir(grade) / domain / f"q{quarter}" / f"{problem_id}.json"


# ── Models ────────────────────────────────────────────────────────────────────

class ApproveRequest(BaseModel):
    problem_id: str
    domain: str
    quarter: int
    notes: Optional[str] = ""
    grade: Optional[int] = 6


class FlagRequest(BaseModel):
    problem_id: str
    notes: Optional[str] = ""
    grade: Optional[int] = 6


class DeleteRequest(BaseModel):
    problem_id: str
    grade: Optional[int] = 6


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/api/bank/review")
def review(
    grade: int = Query(6),
    domain: Optional[str] = Query(None),
    quarter: Optional[int] = Query(None),
    approved: Optional[bool] = Query(None),
    flagged: Optional[bool] = Query(None),
    high_priority: Optional[bool] = Query(None),
    inbox_only: bool = Query(True),   # default: show inbox problems
    limit: int = Query(50),
    offset: int = Query(0),
):
    gd = grade_dir(grade)
    if not gd.exists():
        return {"problems": [], "total": 0}

    # Determine which folders to search
    if inbox_only:
        search_dirs = [inbox_dir(grade)]
    elif domain:
        if quarter:
            search_dirs = [gd / domain / f"q{quarter}"]
        else:
            search_dirs = [gd / domain / f"q{q}" for q in VALID_QUARTERS]
    else:
        # All folders including inbox
        search_dirs = [inbox_dir(grade)]
        for d in VALID_DOMAINS:
            for q in VALID_QUARTERS:
                search_dirs.append(gd / d / f"q{q}")

    problems = []
    for folder in search_dirs:
        if not folder.exists():
            continue
        for json_file in sorted(folder.glob("*.json")):
            try:
                data = json.loads(json_file.read_text())
                # Apply filters
                if approved is not None and data.get("approved") != approved:
                    continue
                if flagged is not None and data.get("flagged") != flagged:
                    continue
                if high_priority is not None and bool(data.get("high_priority")) != high_priority:
                    continue
                problems.append(data)
            except Exception:
                continue

    total = len(problems)
    page = problems[offset: offset + limit]

    return {"problems": page, "total": total, "offset": offset, "limit": limit}


@router.get("/api/bank/stats")
def stats(grade: int = Query(6)):
    gd = grade_dir(grade)
    result = {
        "inbox": {"total": 0, "high_priority": 0},
        "domains": {},
        "totals": {"total": 0, "approved": 0, "flagged": 0, "pending": 0, "high_priority": 0},
    }

    if not gd.exists():
        return result

    # Inbox stats
    ib = inbox_dir(grade)
    if ib.exists():
        inbox_files = list(ib.glob("*.json"))
        result["inbox"]["total"] = len(inbox_files)
        hp_count = 0
        for f in inbox_files:
            try:
                data = json.loads(f.read_text())
                if data.get("high_priority"):
                    hp_count += 1
            except Exception:
                continue
        result["inbox"]["high_priority"] = hp_count

    # Per-domain stats
    for domain in VALID_DOMAINS:
        domain_total = 0
        domain_approved = 0
        domain_flagged = 0
        domain_hp = 0
        for q in VALID_QUARTERS:
            folder = gd / domain / f"q{q}"
            if not folder.exists():
                continue
            for f in folder.glob("*.json"):
                try:
                    data = json.loads(f.read_text())
                    domain_total += 1
                    if data.get("approved"):
                        domain_approved += 1
                    if data.get("flagged"):
                        domain_flagged += 1
                    if data.get("high_priority"):
                        domain_hp += 1
                except Exception:
                    continue
        result["domains"][domain] = {
            "total": domain_total,
            "approved": domain_approved,
            "flagged": domain_flagged,
            "pending": domain_total - domain_approved - domain_flagged,
            "high_priority": domain_hp,
        }
        result["totals"]["total"] += domain_total
        result["totals"]["approved"] += domain_approved
        result["totals"]["flagged"] += domain_flagged
        result["totals"]["high_priority"] += domain_hp

    result["totals"]["pending"] = (
        result["totals"]["total"] - result["totals"]["approved"] - result["totals"]["flagged"]
    )
    return result


@router.post("/api/bank/approve")
def approve(req: ApproveRequest):
    if req.domain not in VALID_DOMAINS:
        raise HTTPException(400, f"Invalid domain. Must be one of: {VALID_DOMAINS}")
    if req.quarter not in VALID_QUARTERS:
        raise HTTPException(400, f"Invalid quarter. Must be 1–4.")

    src = problem_path(req.problem_id, req.grade)
    if not src:
        raise HTTPException(404, f"Problem not found: {req.problem_id}")

    data = read_problem(src)
    data["domain"] = req.domain
    data["quarter"] = req.quarter
    data["approved"] = True
    data["flagged"] = False
    data["notes"] = req.notes or data.get("notes", "")

    target = dest_path(req.domain, req.quarter, req.problem_id, req.grade)
    target.parent.mkdir(parents=True, exist_ok=True)

    # Move file: write to new location, remove old
    write_problem(target, data)
    if src != target:
        src.unlink()

    return {"ok": True, "moved_to": str(target.relative_to(BANK_ROOT))}


@router.post("/api/bank/flag")
def flag(req: FlagRequest):
    src = problem_path(req.problem_id, req.grade)
    if not src:
        raise HTTPException(404, f"Problem not found: {req.problem_id}")

    data = read_problem(src)
    data["flagged"] = True
    data["notes"] = req.notes or data.get("notes", "")
    write_problem(src, data)

    return {"ok": True}


@router.delete("/api/bank/delete")
def delete(req: DeleteRequest):
    src = problem_path(req.problem_id, req.grade)
    if not src:
        raise HTTPException(404, f"Problem not found: {req.problem_id}")
    src.unlink()
    return {"ok": True}


# ── Sampler (used by generation pipeline) ────────────────────────────────────

def sample_problems(
    domain: str | None,
    grade: int,
    max_quarter: int,
    n: int,
    honors_only: bool = False,
    exclude_honors: bool = False,
    high_priority_only: bool = False,
    exclude_high_priority: bool = False,
) -> list[dict]:
    """
    Return up to n randomly sampled approved problems.

    Filters:
      domain            — None draws from all domains
      max_quarter       — only include problems from Q1 through max_quarter
      honors_only       — only problems with honors=True
      exclude_honors    — skip problems with honors=True
      high_priority_only   — only problems with high_priority=True
      exclude_high_priority — skip problems with high_priority=True

    If the pool is smaller than n, returns the whole pool (no error).
    Callers should check len(result) < n and handle shortfalls.
    """
    gd = grade_dir(grade)
    domains_to_search = [domain] if domain else VALID_DOMAINS
    pool = []

    for d in domains_to_search:
        for q in range(1, max_quarter + 1):
            folder = gd / d / f"q{q}"
            if not folder.exists():
                continue
            for f in folder.glob("*.json"):
                try:
                    data = json.loads(f.read_text())
                    if not data.get("approved") or data.get("flagged"):
                        continue
                    if honors_only and not data.get("honors"):
                        continue
                    if exclude_honors and data.get("honors"):
                        continue
                    if high_priority_only and not data.get("high_priority"):
                        continue
                    if exclude_high_priority and data.get("high_priority"):
                        continue
                    pool.append(data)
                except Exception:
                    continue

    if len(pool) <= n:
        return pool
    return random.sample(pool, n)
