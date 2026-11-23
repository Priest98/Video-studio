"""Orchestrates the stages: probe, extract audio, transcribe, select, reframe, caption, render."""
from __future__ import annotations
import os
import subprocess
from dataclasses import dataclass, field
from typing import Callable

from .captions import build_ass, clip_words
from .models import ClipCandidate, SelectionSettings, Transcript
from .probe import probe
from .providers.selector import HeuristicSelector, Selector
from .providers.transcribe import Transcriber
from .reframe import CropPlan, crop_filter, plan_crop, sample_faces
from .render import AudioMix, RenderResult, render_clip


@dataclass
class JobSettings:
    selection: SelectionSettings = field(default_factory=SelectionSettings)
    caption_style: str = "bold_animated"
    caption_mode: str = "word"
    quality: str = "standard"
    max_clip_bytes: int | None = None


@dataclass
class ClipOutput:
    candidate: ClipCandidate
    render: RenderResult
    crop_confident: bool


def extract_audio(src: str, out_wav: str) -> None:
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", src, "-vn", "-ac", "1", "-ar", "16000", out_wav], check=True)


def run_pipeline(
    src: str, workdir: str, transcriber: Transcriber, settings: JobSettings | None = None,
    selector: Selector | None = None, progress: Callable[[str, float], None] = lambda stage, pct: None,
    mix: AudioMix | None = None, is_cancelled: Callable[[], bool] = lambda: False,
) -> tuple[Transcript, list[ClipOutput]]:
    settings = settings or JobSettings()
    selector = selector or HeuristicSelector()
    os.makedirs(workdir, exist_ok=True)

    info = probe(src)
    progress("analyse", 0.05)
    wav = os.path.join(workdir, "audio.wav")
    extract_audio(src, wav)
    transcript = transcriber.transcribe(wav)
    progress("transcribe", 0.35)

    candidates = selector.select(transcript, settings.selection)
    progress("select", 0.45)

    outputs: list[ClipOutput] = []
    for i, cand in enumerate(candidates, 1):
        if is_cancelled():
            raise RuntimeError("cancelled")
        samples = sample_faces(src, cand.start, cand.end)
        plan: CropPlan = plan_crop(samples, info.width, info.height)
        ass_path = os.path.join(workdir, f"clip{i:02d}.ass")
        with open(ass_path, "w", encoding="utf-8") as f:
            f.write(build_ass(clip_words(transcript.words, cand.start, cand.end), settings.caption_style, settings.caption_mode))
        out = os.path.join(workdir, f"clip{i:02d}.mp4")
        result = render_clip(
            src, out, cand.start, cand.end, crop_filter(plan), ass_path,
            quality=settings.quality, mix=mix, max_bytes=settings.max_clip_bytes,
        )
        outputs.append(ClipOutput(cand, result, plan.confident))
        progress("render", 0.45 + 0.55 * i / len(candidates))
    return transcript, outputs
