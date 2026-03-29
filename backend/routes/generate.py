from __future__ import annotations
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from typing import Literal, Optional
from pathlib import Path
import traceback, logging

from services.pacing import get_week_context, get_all_weeks
from services.claude_service import generate_problems
from services.latex_builder import build_pdf

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

router = APIRouter()


# Maps (grade, class_type) → pacing guide key in GUIDE_FILES
def _pacing_grade(grade: str, class_type: str) -> str:
    if class_type == "honors" and grade == "6":
        return "6_advanced"
    return grade


class GenerateRequest(BaseModel):
    week_start: str
    grade: Literal["5", "6", "7", "8"]
    class_type: Literal["grade_level", "honors"]
    specific_date: Optional[str] = None   # YYYY-MM-DD; if set, generate one day only


@router.get("/weeks/{grade}")
async def list_weeks(grade: str):
    """Returns all weeks that have homework days, for the week picker."""
    try:
        return get_all_weeks(grade)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"list_weeks failed: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/generate")
async def generate_homework(req: GenerateRequest):
    try:
        logger.info(
            f"Request: {req.week_start} date={req.specific_date} "
            f"grade={req.grade} type={req.class_type}"
        )
        pacing_grade = _pacing_grade(req.grade, req.class_type)
        context = get_week_context(
            week_start=req.week_start,
            grade=pacing_grade,
            specific_date=req.specific_date,
        )
        logger.info(f"Pacing loaded. Lessons: {context.current_lessons}")

        if not context.current_lessons:
            raise ValueError(
                f"No lessons found for "
                f"{'the date ' + req.specific_date if req.specific_date else 'the week of ' + req.week_start}"
                ". This may be a holiday or non-school day."
            )

        problems = await generate_problems(context=context, class_type=req.class_type)
        pdf_path  = await build_pdf(context=context, problems=problems, class_type=req.class_type)
        pdf_bytes = Path(pdf_path).read_bytes()

        date_part = req.specific_date or req.week_start
        filename  = f"hw_grade{req.grade}_{req.class_type}_{date_part}.pdf"
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Generation failed: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))
