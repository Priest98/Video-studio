"""HTTP surface for the media worker. The web app submits jobs and polls status; it never runs media work itself."""
from __future__ import annotations
import hmac
import os
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel

from .models import SelectionSettings
from .pipeline import JobSettings, run_pipeline
from .providers.selector import GeminiSelector, HeuristicSelector
from .providers.transcribe import FasterWhisperTranscriber

app = FastAPI(title="Video Studio media worker")
MAX_CONCURRENCY = int(os.environ.get("WORKER_CONCURRENCY", "1"))
pool = ThreadPoolExecutor(max_workers=MAX_CONCURRENCY)
JOBS: dict[str, dict] = {}
CANCEL: dict[str, threading.Event] = {}
WORK_ROOT = os.environ.get("WORK_ROOT", "/tmp/video-studio")


def auth(authorization: str = Header(default="")):
    token = os.environ.get("WORKER_TOKEN", "")
    supplied = authorization.removeprefix("Bearer ")
    if not token or not hmac.compare_digest(supplied, token):
        raise HTTPException(401, "unauthorized")


class JobRequest(BaseModel):
    source_path: str  # local path inside the worker; the web app stages downloads from R2 first
    selection: SelectionSettings = SelectionSettings()
    caption_style: str = "bold_animated"
    caption_mode: str = "word"
    quality: str = "standard"
    max_clip_bytes: int | None = None


def _selector():
    key = os.environ.get("GEMINI_API_KEY")
    model = os.environ.get("GEMINI_MODEL")
    return GeminiSelector(key, model) if key and model else HeuristicSelector()


def _run(job_id: str, req: JobRequest):
    job = JOBS[job_id]
    job["status"] = "processing"
    try:
        _, outputs = run_pipeline(
            req.source_path, os.path.join(WORK_ROOT, job_id), FasterWhisperTranscriber(),
            JobSettings(req.selection, req.caption_style, req.caption_mode, req.quality, req.max_clip_bytes),
            selector=_selector(), progress=lambda s, p: job.update(stage=s, progress=round(p, 2)),
            is_cancelled=CANCEL[job_id].is_set,
        )
        job["clips"] = [
            {**o.candidate.model_dump(), "path": o.render.path, "size_bytes": o.render.size_bytes,
             "crf": o.render.crf, "compression_pct": o.render.compression_pct,
             "width": o.render.width, "height": o.render.height, "needs_manual_crop": not o.crop_confident}
            for o in outputs
        ]
        job["status"] = "ready"
    except Exception as e:  # report, never crash the pool
        job["status"] = "cancelled" if CANCEL[job_id].is_set() else "failed"
        job["error"] = str(e)


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/jobs", dependencies=[Depends(auth)])
def create_job(req: JobRequest):
    if not os.path.isfile(req.source_path):
        raise HTTPException(400, "source_path not found")
    job_id = uuid.uuid4().hex
    JOBS[job_id] = {"id": job_id, "status": "queued", "stage": "queued", "progress": 0.0}
    CANCEL[job_id] = threading.Event()
    pool.submit(_run, job_id, req)
    return JOBS[job_id]


@app.get("/jobs/{job_id}", dependencies=[Depends(auth)])
def get_job(job_id: str):
    if job_id not in JOBS:
        raise HTTPException(404, "not found")
    return JOBS[job_id]


@app.post("/jobs/{job_id}/cancel", dependencies=[Depends(auth)])
def cancel_job(job_id: str):
    if job_id not in CANCEL:
        raise HTTPException(404, "not found")
    CANCEL[job_id].set()
    return {"cancelling": True}
