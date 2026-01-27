"""
FastAPI service for School Scheduler OR-Tools backend.

Designed for deployment on Google Cloud Run.
"""

import os
import time
import json
import logging
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional

from solver import generate_schedules

# Configure logging
DEBUG_SOLVER = os.environ.get("DEBUG_SOLVER", "").lower() in ("1", "true", "yes")
logging.basicConfig(
    level=logging.DEBUG if DEBUG_SOLVER else logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

if DEBUG_SOLVER:
    logger.info("DEBUG_SOLVER is enabled - verbose logging active")

app = FastAPI(
    title="School Scheduler API",
    description="OR-Tools CP-SAT based school schedule generator",
    version="1.0.0"
)

# CORS configuration - allow Vercel frontend
# In production, replace with your actual Vercel domain
ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://localhost:3001",
    "https://*.vercel.app",
    "https://school-scheduler.vercel.app",  # Update with your actual domain
]

# Also allow origin from environment variable
if os.environ.get("FRONTEND_URL"):
    ALLOWED_ORIGINS.append(os.environ["FRONTEND_URL"])

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class Teacher(BaseModel):
    name: str
    status: str = "full-time"
    canSuperviseStudyHall: Optional[bool] = None  # None = eligible, False = excluded


class ClassEntry(BaseModel):
    teacher: str
    grade: str = ""  # Legacy single grade (kept for backward compat)
    grades: Optional[list[str]] = None  # New: array of grade names
    gradeDisplay: Optional[str] = None  # Display name for UI
    subject: str
    daysPerWeek: int = 1
    isElective: bool = False  # Electives skip grade conflicts
    availableDays: Optional[list[str]] = None
    availableBlocks: Optional[list[int]] = None
    fixedSlots: Optional[list[list]] = None  # [[day, block], ...]


class SolveRequest(BaseModel):
    teachers: list[Teacher]
    classes: list[ClassEntry]
    numOptions: int = 3
    numAttempts: int = 150
    maxTimeSeconds: float = 280.0  # Stay under Vercel's 300s function limit


class SolveResponse(BaseModel):
    status: str
    options: list
    allSolutions: list = []
    message: str
    seedsCompleted: int
    infeasibleCount: int
    elapsedSeconds: float
    diagnostics: Optional[dict] = None


@app.get("/")
async def root():
    return {"message": "School Scheduler API", "version": "1.0.0"}


@app.get("/health")
async def health_check():
    """Health check endpoint for Cloud Run."""
    return {"status": "healthy", "timestamp": time.time()}


@app.post("/solve", response_model=SolveResponse)
async def solve_schedule(request: SolveRequest):
    """
    Generate schedule options using OR-Tools CP-SAT.

    Accepts teacher and class data, returns top schedule options ranked by quality.
    """
    start_time = time.time()

    # Convert Pydantic models to dicts for solver
    teachers = [t.model_dump() for t in request.teachers]
    classes = [c.model_dump() for c in request.classes]

    # Log request summary
    logger.info(f"=== SOLVE REQUEST === Teachers: {len(teachers)}, Classes: {len(classes)}, Attempts: {request.numAttempts}")

    # Log detailed info only when DEBUG_SOLVER is enabled
    if DEBUG_SOLVER:
        logger.debug(f"Options: {request.numOptions}, MaxTime: {request.maxTimeSeconds}s")

        # Log teacher details
        for t in teachers:
            logger.debug(f"  Teacher: {t['name']} ({t.get('status', 'unknown')})")

        # Log class details with constraints
        for i, c in enumerate(classes):
            constraints = []
            if c.get('fixedSlots'):
                constraints.append(f"fixed:{c['fixedSlots']}")
            if c.get('availableDays') and len(c['availableDays']) < 5:
                constraints.append(f"days:{c['availableDays']}")
            if c.get('availableBlocks') and len(c['availableBlocks']) < 5:
                constraints.append(f"blocks:{c['availableBlocks']}")
            constraint_str = f" [{', '.join(constraints)}]" if constraints else ""
            grades = c.get('grades') or [c.get('grade', '?')]
            logger.debug(f"  Class {i+1}: {c['teacher']} - {grades} - {c['subject']} x{c.get('daysPerWeek', 1)}/wk{constraint_str}")

    try:
        # Run the solver
        result = generate_schedules(
            teachers=teachers,
            classes=classes,
            num_options=request.numOptions,
            num_attempts=request.numAttempts,
            max_time_seconds=request.maxTimeSeconds,
        )

        elapsed = time.time() - start_time

        # Log result summary
        logger.info(f"=== SOLVE RESULT === Status: {result['status']}, Options: {len(result['options'])}, Time: {elapsed:.1f}s")
        if result['status'] == 'infeasible':
            logger.warning(f"INFEASIBLE: {result['message']}")
            if DEBUG_SOLVER and result.get('diagnostics'):
                logger.debug(f"Diagnostics: {json.dumps(result['diagnostics'], indent=2)}")

        return SolveResponse(
            status=result['status'],
            options=result['options'],
            allSolutions=result.get('allSolutions', []),
            message=result['message'],
            seedsCompleted=result['seeds_completed'],
            infeasibleCount=result['infeasible_count'],
            elapsedSeconds=elapsed,
            diagnostics=result.get('diagnostics'),
        )

    except Exception as e:
        elapsed = time.time() - start_time
        logger.error(f"SOLVE ERROR: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail={
                "status": "error",
                "message": str(e),
                "elapsedSeconds": elapsed,
            }
        )


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8080))
    uvicorn.run(app, host="0.0.0.0", port=port)
