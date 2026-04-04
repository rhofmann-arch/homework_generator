from __future__ import annotations
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from typing import Literal, Optional
from pathlib import Path
import io, json, traceback, logging, zipfile

from services.pacing import get_week_context, get_all_weeks
from services.claude_service import generate_problems
from services.latex_builder import build_pdf, build_key_pdf

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

router = APIRouter()

# Sessions dir — ephemeral, survives process lifetime on Render
SESSIONS_DIR = Path("/tmp/hw_sessions")
SESSIONS_DIR.mkdir(parents=True, exist_ok=True)


def _pacing_grade(grade: str, class_type: str) -> str:
    if class_type == "honors" and grade == "6":
        return "6_advanced"
    return grade


def _session_key(grade: str, class_type: str, date_part: str) -> str:
    return f"grade{grade}_{class_type}_{date_part}"


class GenerateRequest(BaseModel):
    week_start: str
    grade: Literal["5", "6", "7", "8"]
    class_type: Literal["grade_level", "honors"]
    specific_date: Optional[str] = None


class RecompileRequest(BaseModel):
    problems: dict
    week_start: str
    grade: Literal["5", "6", "7", "8"]
    class_type: Literal["grade_level", "honors"]
    specific_date: Optional[str] = None


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


def _build_zip(pdf_path: str, key_path: str, grade: str, class_type: str, date_part: str) -> bytes:
    hw_name  = f"hw_grade{grade}_{class_type}_{date_part}.pdf"
    key_name = f"hw_grade{grade}_{class_type}_{date_part}_KEY.pdf"
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(hw_name,  Path(pdf_path).read_bytes())
        zf.writestr(key_name, Path(key_path).read_bytes())
    buf.seek(0)
    return buf.read()


@router.post("/generate")
async def generate_homework(req: GenerateRequest):
    """
    Generate homework + answer key, return as ZIP.
    Saves problems JSON to /tmp/hw_sessions for later editing.
    Response header X-Session-Key identifies the session.
    """
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

        problems  = await generate_problems(context=context, class_type=req.class_type)
        pdf_path  = await build_pdf(context=context, problems=problems, class_type=req.class_type)
        key_path  = await build_key_pdf(pdf_path)

        date_part   = req.specific_date or req.week_start
        session_key = _session_key(req.grade, req.class_type, date_part)

        # Persist problems for the editor
        SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
        (SESSIONS_DIR / f"{session_key}.json").write_text(json.dumps(problems, indent=2))
        logger.info(f"Saved session: {session_key}")

        zip_bytes = _build_zip(pdf_path, key_path, req.grade, req.class_type, date_part)
        zip_name  = f"hw_grade{req.grade}_{req.class_type}_{date_part}.zip"

        return Response(
            content=zip_bytes,
            media_type="application/zip",
            headers={
                "Content-Disposition": f'attachment; filename="{zip_name}"',
                "X-Session-Key":       session_key,
                "Access-Control-Expose-Headers": "X-Session-Key",
            },
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Generation failed: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/homework/{key}/problems")
async def get_homework_problems(key: str):
    """Return the saved problems dict for a generated homework session."""
    path = SESSIONS_DIR / f"{key}.json"
    if not path.exists():
        raise HTTPException(
            status_code=404,
            detail="Session not found — please regenerate the homework to use the editor."
        )
    return json.loads(path.read_text())


@router.post("/homework/{key}/recompile")
async def recompile_homework(key: str, req: RecompileRequest):
    """
    Rebuild PDFs from a modified problems dict.
    Saves updated problems back to session storage.
    """
    try:
        pacing_grade = _pacing_grade(req.grade, req.class_type)
        context = get_week_context(
            week_start=req.week_start,
            grade=pacing_grade,
            specific_date=req.specific_date,
        )

        pdf_path = await build_pdf(context=context, problems=req.problems, class_type=req.class_type)
        key_path = await build_key_pdf(pdf_path)

        # Update saved problems
        SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
        (SESSIONS_DIR / f"{key}.json").write_text(json.dumps(req.problems, indent=2))

        date_part = req.specific_date or req.week_start
        zip_bytes = _build_zip(pdf_path, key_path, req.grade, req.class_type, date_part)
        zip_name  = f"hw_grade{req.grade}_{req.class_type}_{date_part}.zip"

        return Response(
            content=zip_bytes,
            media_type="application/zip",
            headers={
                "Content-Disposition": f'attachment; filename="{zip_name}"',
                "X-Session-Key": key,
                "Access-Control-Expose-Headers": "X-Session-Key",
            },
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Recompile failed: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))
