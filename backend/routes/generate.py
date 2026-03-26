from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from typing import Literal
from pathlib import Path

from services.pacing import get_week_context
from services.claude_service import generate_problems
from services.latex_builder import build_pdf

router = APIRouter()


class GenerateRequest(BaseModel):
    week_start: str                  # "YYYY-MM-DD" — Monday of the target week
    grade: Literal["5", "6", "7", "8"]
    class_type: Literal["grade_level", "honors"]


@router.post("/generate")
async def generate_homework(req: GenerateRequest):
    try:
        context = get_week_context(week_start=req.week_start, grade=req.grade)
        problems = await generate_problems(context=context, class_type=req.class_type)
        pdf_path = await build_pdf(context=context, problems=problems, class_type=req.class_type)

        # Read the PDF bytes immediately so the temp file can be cleaned up safely
        pdf_bytes = Path(pdf_path).read_bytes()

        filename = f"hw_grade{req.grade}_{req.class_type}_{req.week_start}.pdf"
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
