"""
backend/routes/bank.py

API routes for the problem bank teacher review UI.

GET    /api/bank/review   — list unapproved (or all) problems, with filters
POST   /api/bank/approve  — approve a problem, set final quarter + optional notes + flagged
DELETE /api/bank/delete   — permanently delete a problem from the bank
GET    /api/bank/stats    — summary counts by domain
"""

import os
import json
import glob
from typing import Optional
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

router = APIRouter()

BANK_ROOT = os.environ.get(
    "PROBLEM_BANK_ROOT",
    os.path.join(os.path.dirname(__file__), "..", "..", "problem_bank"),
)

VALID_DOMAINS = [
    "fractions_decimals",
    "expressions_equations",
    "geometry",
    "stats_probability",
]


def load_problem(path: str) -> Optional[dict]:
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return None


def save_problem(path: str, data: dict) -> None:
    with open(path, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def find_problem_file(grade: int, domain: str, problem_id: str) -> Optional[str]:
    pattern = os.path.join(BANK_ROOT, f"grade_{grade}", domain, "q*", f"{problem_id}.json")
    matches = glob.glob(pattern)
    return matches[0] if matches else None


@router.get("/bank/review")
def get_review_queue(
    grade:    int  = Query(6),
    domain:   str  = Query(...),
    quarter:  Optional[int] = Query(None),
    approved: bool = Query(False),
    offset:   int  = Query(0),
    limit:    int  = Query(20),
):
    if domain not in VALID_DOMAINS:
        raise HTTPException(400, f"Invalid domain. Choose from: {VALID_DOMAINS}")

    if quarter:
        pattern = os.path.join(BANK_ROOT, f"grade_{grade}", domain, f"q{quarter}", "*.json")
        paths = sorted(glob.glob(pattern))
    else:
        paths = []
        for q in range(1, 5):
            pattern = os.path.join(BANK_ROOT, f"grade_{grade}", domain, f"q{q}", "*.json")
            paths.extend(sorted(glob.glob(pattern)))

    problems = []
    for path in paths:
        p = load_problem(path)
        if p is None:
            continue
        if not approved and p.get("approved", False):
            continue
        p["_file_path"] = path
        problems.append(p)

    total = len(problems)
    page  = problems[offset : offset + limit]
    return {"total": total, "offset": offset, "limit": limit, "problems": page}


class ApproveRequest(BaseModel):
    problem_id: str
    grade:      int  = 6
    domain:     str
    quarter:    int
    notes:      str  = ""
    flagged:    bool = False


@router.post("/bank/approve")
def approve_problem(req: ApproveRequest):
    if req.domain not in VALID_DOMAINS:
        raise HTTPException(400, "Invalid domain.")
    if req.quarter not in (1, 2, 3, 4):
        raise HTTPException(400, "Quarter must be 1, 2, 3, or 4.")

    current_path = find_problem_file(req.grade, req.domain, req.problem_id)
    if not current_path:
        raise HTTPException(404, f"Problem not found: {req.problem_id}")

    problem = load_problem(current_path)
    if not problem:
        raise HTTPException(500, "Could not read problem file.")

    old_quarter = problem.get("quarter", 0)
    problem["approved"] = True
    problem["flagged"]  = req.flagged
    problem["quarter"]  = req.quarter
    problem["notes"]    = req.notes

    if old_quarter != req.quarter:
        new_dir  = os.path.join(BANK_ROOT, f"grade_{req.grade}", req.domain, f"q{req.quarter}")
        os.makedirs(new_dir, exist_ok=True)
        new_path = os.path.join(new_dir, f"{req.problem_id}.json")
        save_problem(new_path, problem)
        os.remove(current_path)
        final_path = new_path
    else:
        save_problem(current_path, problem)
        final_path = current_path

    return {"ok": True, "problem_id": req.problem_id, "quarter": req.quarter,
            "flagged": req.flagged, "quarter_moved": old_quarter != req.quarter}


class DeleteRequest(BaseModel):
    problem_id: str
    grade:      int = 6
    domain:     str


@router.delete("/bank/delete")
def delete_problem(req: DeleteRequest):
    if req.domain not in VALID_DOMAINS:
        raise HTTPException(400, "Invalid domain.")
    path = find_problem_file(req.grade, req.domain, req.problem_id)
    if not path:
        raise HTTPException(404, f"Problem not found: {req.problem_id}")
    os.remove(path)
    return {"ok": True, "problem_id": req.problem_id, "deleted": True}


@router.get("/bank/stats")
def get_bank_stats(grade: int = Query(6)):
    stats = {}
    for domain in VALID_DOMAINS:
        stats[domain] = {"total": 0, "approved": 0, "flagged": 0, "by_quarter": {}}
        for q in range(1, 5):
            pattern = os.path.join(BANK_ROOT, f"grade_{grade}", domain, f"q{q}", "*.json")
            files   = glob.glob(pattern)
            approved = flagged = 0
            for f in files:
                p = load_problem(f)
                if p:
                    if p.get("approved", False): approved += 1
                    if p.get("flagged",  False): flagged  += 1
            stats[domain]["by_quarter"][f"q{q}"] = {
                "total": len(files), "approved": approved, "flagged": flagged
            }
            stats[domain]["total"]    += len(files)
            stats[domain]["approved"] += approved
            stats[domain]["flagged"]  += flagged
    return {"grade": grade, "domains": stats}
