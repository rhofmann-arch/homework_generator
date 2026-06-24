from __future__ import annotations
import os
from fastapi import APIRouter

router = APIRouter()

@router.get("/health")
def health():
    return {
        "status": "ok",
        # Render sets RENDER_GIT_COMMIT to the deployed commit SHA — lets us
        # confirm which code is actually live vs what's in git.
        "commit": os.environ.get("RENDER_GIT_COMMIT", "unknown"),
    }
