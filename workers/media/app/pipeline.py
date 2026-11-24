"""Orchestrates the stages: probe, extract audio, transcribe, select, reframe, caption, render."""
from __future__ import annotations
import math
import os
import subprocess
import time
from dataclasses import dataclass, field
from typing import Callable

from .captions import build_ass, clip_words
from .models import ClipCandidate, SelectionSettings, Transcript, Word
from .probe import probe
from .providers.selector import HeuristicSelector, Selector
from .providers.transcribe import Transcriber
from .reframe import CropPlan, crop_filter, plan_crop, sample_faces
from .providers.tts import TTSProvider, fit_to_duration
from .render import AudioMix, RenderResult, render_clip
from .scenes import detect_cuts, trim_edge_flashes


@dataclass
class JobSettings:
    selection: SelectionSettings = field(default_factory=SelectionSettings)
    caption_style: str = "bold_animated"
    caption_mode: str = "word"
    quality: str = "standard"
    max_clip_bytes: int | None = None
    narrations: dict[int, str] = field(default_factory=dict)  # 1-based clip index -> script
    voice: str = ""
    voice_mode: str = "overlay"


@dataclass
class ClipOutput:
    candidate: ClipCandidate
    render: RenderResult
    crop_confident: bool
    narration_fits: bool | None = None
    voice_characters: int = 0
    voice_cost_usd: float = 0.0


LONG_SOURCE_SECONDS = float(os.environ.get("LONG_SOURCE_SECONDS", str(40 * 60)))  # longer than this is processed in windows
WINDOW_SECONDS = float(os.environ.get("WINDOW_SECONDS", str(25 * 60)))
MAX_LONG_CLIPS = 12


def extract_audio(src: str, out_wav: str, start: float | None = None, length: float | None = None) -> None:
    cmd = ["ffmpeg", "-y", "-loglevel", "error"]
    if start is not None:
        cmd += ["-ss", f"{start:.3f}", "-t", f"{length:.3f}"]
    subprocess.run(cmd + ["-i", src, "-vn", "-ac", "1", "-ar", "16000", out_wav], check=True)


def windows_for(duration: float, size: float | None = None) -> list[tuple[float, float]]:
    """Equal windows no longer than `size`. A tiny last window is merged into the one before it."""
    size = size or WINDOW_SECONDS
    n = max(1, math.ceil(duration / size))
    if n > 1 and duration - (n - 1) * size < size * 0.2:
        n -= 1
    step = duration / n
    return [(k * step, step) for k in range(n)]


def _render_candidate(
    i: int, cand: ClipCandidate, transcript: Transcript, src: str, info, workdir: str, settings: JobSettings, tts: TTSProvider | None,
) -> ClipOutput:
    cuts = detect_cuts(src, cand.start, cand.end)
    cand = trim_edge_flashes(cand, cuts, transcript.words)
    samples = sample_faces(src, cand.start, cand.end)
    plan: CropPlan = plan_crop(samples, info.width, info.height)
    ass_path = os.path.join(workdir, f"clip{i:02d}.ass")
    with open(ass_path, "w", encoding="utf-8") as f:
        f.write(build_ass(clip_words(transcript.words, cand.start, cand.end), settings.caption_style, settings.caption_mode))
    out = os.path.join(workdir, f"clip{i:02d}.mp4")
    mix, fits, chars, cost = None, None, 0, 0.0
    script = settings.narrations.get(i)
    if script and tts:
        speech = tts.synthesize(script, settings.voice, os.path.join(workdir, f"voice{i:02d}.raw"))
        fitted, fits = fit_to_duration(speech.path, cand.end - cand.start, os.path.join(workdir, f"voice{i:02d}.m4a"))
        mix, chars, cost = AudioMix(voiceover=fitted, mode=settings.voice_mode), speech.characters, speech.cost_usd
    result = render_clip(
        src, out, cand.start, cand.end, crop_filter(plan), ass_path,
        quality=settings.quality, mix=mix, max_bytes=settings.max_clip_bytes,
    )
    return ClipOutput(cand, result, plan.confident, fits, chars, cost)


def run_pipeline(
    src: str, workdir: str, transcriber: Transcriber, settings: JobSettings | None = None,
    selector: Selector | None = None, progress: Callable[[str, float], None] = lambda stage, pct: None,
    tts: TTSProvider | None = None, is_cancelled: Callable[[], bool] = lambda: False,
    on_clip: Callable[[int, "ClipOutput"], None] | None = None,
    info_cb: Callable[..., None] = lambda **kw: None,
) -> tuple[Transcript, list[ClipOutput]]:
    settings = settings or JobSettings()
    selector = selector or HeuristicSelector()
    os.makedirs(workdir, exist_ok=True)

    info = probe(src)
    if info.duration > LONG_SOURCE_SECONDS:
        return _run_long(src, workdir, transcriber, settings, selector, progress, tts, is_cancelled, on_clip, info_cb, info)

    progress("analyse", 0.05)
    wav = os.path.join(workdir, "audio.wav")
    extract_audio(src, wav)
    transcript = transcriber.transcribe(wav)
    progress("transcribe", 0.35)

    candidates = selector.select(transcript, settings.selection)
    progress("select", 0.45)
    info_cb(expected=len(candidates), clips_done=0)

    outputs: list[ClipOutput] = []
    for i, cand in enumerate(candidates, 1):
        if is_cancelled():
            raise RuntimeError("cancelled")
        outputs.append(_render_candidate(i, cand, transcript, src, info, workdir, settings, tts))
        if on_clip:
            on_clip(i, outputs[-1])
        info_cb(clips_done=i)
        progress("render", 0.45 + 0.55 * i / len(candidates))
    return transcript, outputs


def _run_long(src, workdir, transcriber, settings, selector, progress, tts, is_cancelled, on_clip, info_cb, info):
    """Long recordings (podcasts, streams, lectures): one window at a time. Each window is transcribed, its best
    moment is picked and rendered straight away, so clips appear while the rest of the video is still being read.
    Coverage matters more than a global ranking here: the user gets the best moment from every stretch of the video."""
    wins = windows_for(info.duration)
    per_window = max(1, min(3, round(settings.selection.clip_count / len(wins))))
    while per_window * len(wins) > MAX_LONG_CLIPS and per_window > 1:
        per_window -= 1
    sel = settings.selection.model_copy(update={"clip_count": per_window})
    expected = min(per_window * len(wins), MAX_LONG_CLIPS)
    info_cb(expected=expected, clips_done=0, windows=len(wins))

    all_words: list[Word] = []
    outputs: list[ClipOutput] = []
    t_window = t_clip = None
    n = len(wins)
    for w, (start, length) in enumerate(wins):
        if is_cancelled():
            raise RuntimeError("cancelled")
        base = 0.05 + 0.9 * w / n
        progress("transcribe", base)
        t0 = time.monotonic()
        wav = os.path.join(workdir, f"win{w:02d}.wav")
        extract_audio(src, wav, start, length)
        part = transcriber.transcribe(wav)
        os.remove(wav)
        shifted = [Word(text=x.text, start=x.start + start, end=x.end + start) for x in part.words]
        all_words += shifted
        t_window = time.monotonic() - t0
        info_cb(eta_seconds=round((n - w - 1) * t_window + (expected - len(outputs)) * (t_clip or 90)))
        if not shifted:
            continue
        window_t = Transcript(words=shifted, language=part.language)
        cands = selector.select(window_t, sel)[:per_window]
        for cand in cands:
            if len(outputs) >= expected:
                break
            progress("render", base + 0.45 * 0.9 / n)
            t1 = time.monotonic()
            idx = len(outputs) + 1
            outputs.append(_render_candidate(idx, cand, window_t, src, info, workdir, settings, tts))
            t_clip = time.monotonic() - t1
            if on_clip:
                on_clip(idx, outputs[-1])
            info_cb(clips_done=len(outputs))
        progress("render", 0.05 + 0.9 * (w + 1) / n)
    info_cb(eta_seconds=0)
    return Transcript(words=all_words), outputs
