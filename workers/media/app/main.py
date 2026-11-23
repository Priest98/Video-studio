"""HTTP surface for the media worker. The web app submits jobs and polls status; it never runs media work itself."""
from __future__ import annotations
import hmac
import os
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel

from .callback import post_callback
from .importer import ImportRefused, download, validate_import
from .models import SelectionSettings
from .probe import probe
from .pipeline import JobSettings, run_pipeline
from .providers.selector import GeminiSelector, HeuristicSelector
from .providers.transcribe import FasterWhisperTranscriber
from .providers.tts import ElevenLabsProvider, KokoroProvider
from .storage import R2Uploader, clip_key

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
    source_path: str | None = None  # a file already on the worker
    source_url: str | None = None  # short-lived signed URL (R2); downloaded into the job's work dir
    import_url: str | None = None  # link import (YouTube, Twitch); requires rights_confirmed
    rights_confirmed: bool = False
    project_id: str = ""
    workspace_id: str = ""
    callback_url: str | None = None
    narrations: dict[int, str] = {}
    voice: str = ""
    voice_mode: str = "overlay"
    selection: SelectionSettings = SelectionSettings()
    caption_style: str = "bold_animated"
    caption_mode: str = "word"
    quality: str = "standard"
    max_clip_bytes: int | None = None


def _selector():
    key = os.environ.get("GEMINI_API_KEY")
    model = os.environ.get("GEMINI_MODEL")
    return GeminiSelector(key, model) if key and model else HeuristicSelector()


MAX_SOURCE_BYTES = int(os.environ.get("MAX_SOURCE_BYTES", str(5 * 1024**3)))


def fetch_source(url: str, dest: str, max_bytes: int = MAX_SOURCE_BYTES) -> str:
    """Stream a signed URL to disk, refusing anything larger than the cap."""
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    total = 0
    with httpx.stream("GET", url, timeout=60, follow_redirects=False) as r:
        r.raise_for_status()
        with open(dest, "wb") as f:
            for chunk in r.iter_bytes(1 << 20):
                total += len(chunk)
                if total > max_bytes:
                    raise ValueError("source exceeds size limit")
                f.write(chunk)
    return dest


def _tts():
    if os.environ.get("ELEVENLABS_API_KEY"):
        return ElevenLabsProvider(os.environ["ELEVENLABS_API_KEY"])
    return KokoroProvider() if os.environ.get("KOKORO_ENABLED") == "1" else None


def _acquire(job_id: str, req: JobRequest) -> str:
    if req.source_path:
        return req.source_path
    if req.import_url:
        validate_import(req.import_url, req.rights_confirmed)
        os.makedirs(os.path.join(WORK_ROOT, job_id), exist_ok=True)
        return download(req.import_url, os.path.join(WORK_ROOT, job_id))
    return fetch_source(req.source_url, os.path.join(WORK_ROOT, job_id, "source.bin"))


def _publish(job: dict, req: JobRequest, uploader):
    """Upload each rendered clip to R2 and tell the web app. Keys are tenant-prefixed."""
    for i, c in enumerate(job["clips"], 1):
        key = clip_key(req.workspace_id, req.project_id, i)
        uploader.upload(c["path"], key)
        c["storage_key"] = key
    if req.callback_url and os.environ.get("CALLBACK_SECRET"):
        post_callback(req.callback_url, os.environ["CALLBACK_SECRET"], {
            "project_id": req.project_id, "workspace_id": req.workspace_id, "status": job["status"],
            "error": job.get("error"), "source_seconds": job.get("source_seconds", 0), "clips": [{k: v for k, v in c.items() if k != "path"} for c in job["clips"]],
        })


def _run(job_id: str, req: JobRequest, uploader=None):
    job = JOBS[job_id]
    job["status"] = "processing"
    try:
        src = _acquire(job_id, req)
        job["source_seconds"] = probe(src).duration
        _, outputs = run_pipeline(
            src, os.path.join(WORK_ROOT, job_id), FasterWhisperTranscriber(),
            JobSettings(req.selection, req.caption_style, req.caption_mode, req.quality, req.max_clip_bytes,
                        req.narrations, req.voice, req.voice_mode),
            selector=_selector(), tts=_tts(), progress=lambda s, p: job.update(stage=s, progress=round(p, 2)),
            is_cancelled=CANCEL[job_id].is_set,
        )
        job["clips"] = [
            {**o.candidate.model_dump(), "path": o.render.path, "size_bytes": o.render.size_bytes,
             "crf": o.render.crf, "compression_pct": o.render.compression_pct,
             "width": o.render.width, "height": o.render.height, "needs_manual_crop": not o.crop_confident,
             "narration_fits": o.narration_fits, "voice_characters": o.voice_characters, "voice_cost_usd": o.voice_cost_usd}
            for o in outputs
        ]
        job["status"] = "ready"
        if req.workspace_id and req.project_id:
            _publish(job, req, uploader or R2Uploader())
    except Exception as e:  # report, never crash the pool
        job["status"] = "cancelled" if CANCEL[job_id].is_set() else "failed"
        job["error"] = str(e)
        if req.callback_url and os.environ.get("CALLBACK_SECRET"):
            try:
                post_callback(req.callback_url, os.environ["CALLBACK_SECRET"],
                              {"project_id": req.project_id, "workspace_id": req.workspace_id, "status": job["status"], "error": job["error"], "clips": []})
            except Exception:
                pass


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/jobs", dependencies=[Depends(auth)])
def create_job(req: JobRequest):
    if req.import_url:
        try:
            validate_import(req.import_url, req.rights_confirmed)
        except ImportRefused as e:
            raise HTTPException(400, str(e))
    elif not req.source_url and not (req.source_path and os.path.isfile(req.source_path)):
        raise HTTPException(400, "provide source_url, import_url or an existing source_path")
    if req.source_url and not req.source_url.startswith("https://"):
        raise HTTPException(400, "source_url must be https")
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
