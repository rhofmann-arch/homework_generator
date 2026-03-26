from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from typing import Literal
from pathlib import Path
import traceback, logging

from services.pacing import get_week_context
from services.claude_service import generate_problems
from services.latex_builder import build_pdf

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

router = APIRouter()

class GenerateRequest(BaseModel):
    week_start: str
    grade: Literal["5", "6", "7", "8"]
    class_type: Literal["grade_level", "honors"]

@router.post("/api/generate")
async def generate_homework(req: GenerateRequest):
    try:
        logger.info(f"Request: {req.week_start} grade={req.grade} type={req.class_type}")
        context = get_week_context(week_start=req.week_start, grade=req.grade)
        logger.info(f"Pacing guide loaded. Lessons: {context.current_lessons}")
        problems = await generate_problems(context=context, class_type=req.class_type)
        logger.info(f"Problems generated. Front: {len(problems['front_problems'])}, Back: {len(problems['back_problems'])}")
        pdf_path = await build_pdf(context=context, problems=problems, class_type=req.class_type)
        logger.info(f"PDF compiled: {pdf_path}")
        pdf_bytes = Path(pdf_path).read_bytes()
        filename = f"hw_grade{req.grade}_{req.class_type}_{req.week_start}.pdf"
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except Exception as e:
        logger.error(f"Generation failed: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))
