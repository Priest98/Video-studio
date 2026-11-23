"""FFmpeg rendering: cut, reframe, caption, mix, encode, and adaptive compression."""
from __future__ import annotations
import os
import subprocess
from dataclasses import dataclass, field
from typing import Literal

from .probe import probe

# CRF starting points follow the spec's 23-26 benchmark band. Tune against real footage.
QUALITY = {
    "standard": {"crf": 24, "audio_kbps": 128},
    "high": {"crf": 21, "audio_kbps": 128},
    "small": {"crf": 27, "audio_kbps": 96},
}
MAX_CRF = 34

RENDER_WIDTH = max(360, int(os.environ.get("RENDER_WIDTH", "1080")) // 2 * 2)  # 720 renders about twice as fast as 1080
RENDER_HEIGHT = RENDER_WIDTH * 16 // 9 // 2 * 2
DEFAULT_PRESET = os.environ.get("RENDER_PRESET", "medium")  # "veryfast" renders much quicker on a laptop


@dataclass
class AudioMix:
    voiceover: str | None = None
    music: str | None = None
    mode: Literal["keep", "replace", "overlay"] = "keep"  # overlay ducks original speech under narration
    original_volume: float = 1.0
    voice_volume: float = 1.0
    music_volume: float = 0.15
    fade_seconds: float = 0.5


@dataclass
class RenderResult:
    path: str
    size_bytes: int
    crf: int
    width: int
    height: int
    original_bytes: int
    attempts: int = 1
    notes: list[str] = field(default_factory=list)

    @property
    def compression_pct(self) -> float:
        return round(100 * (1 - self.size_bytes / self.original_bytes), 1) if self.original_bytes else 0.0


def _filter_path(p: str) -> str:
    return p.replace("\\", "/").replace(":", "\\:").replace("'", "\\'")


def build_command(
    src: str, out: str, start: float, end: float, crop: str, ass_path: str | None,
    crf: int, audio_kbps: int, mix: AudioMix | None = None, preset: str = DEFAULT_PRESET, has_audio: bool = True,
) -> list[str]:
    dur = end - start
    mix = mix or AudioMix()
    vf = [crop, f"scale={RENDER_WIDTH}:{RENDER_HEIGHT}:flags=lanczos", "fps=30"]
    if ass_path:
        vf.append(f"ass='{_filter_path(ass_path)}'")
    vf.append("format=yuv420p")

    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-ss", f"{start:.3f}", "-t", f"{dur:.3f}", "-i", src]
    idx = 1
    voice_i = music_i = None
    if mix.voiceover:
        cmd += ["-i", mix.voiceover]; voice_i = idx; idx += 1
    if mix.music:
        cmd += ["-stream_loop", "-1", "-i", mix.music]; music_i = idx; idx += 1

    fade_out = max(dur - mix.fade_seconds, 0)
    a_filters, labels = [], []
    if has_audio and mix.mode != "replace":
        a_filters.append(f"[0:a]volume={mix.original_volume}[orig]")
    if voice_i is not None:
        a_filters.append(f"[{voice_i}:a]volume={mix.voice_volume},asplit=2[voice][voicekey]")
        if has_audio and mix.mode == "overlay":
            # Duck the original speech whenever narration is present.
            a_filters.append("[orig][voicekey]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=300[ducked]")
            labels += ["ducked", "voice"]
        else:
            a_filters.append("[voicekey]anullsink")
            labels += (["orig"] if has_audio and mix.mode == "keep" else []) + ["voice"]
    elif has_audio and mix.mode != "replace":
        labels.append("orig")
    if music_i is not None:
        a_filters.append(f"[{music_i}:a]volume={mix.music_volume}[music]")
        labels.append("music")

    cmd += ["-map", "0:v:0"]
    if labels:
        joined = "".join(f"[{l}]" for l in labels)
        a_filters.append(f"{joined}amix=inputs={len(labels)}:duration=first:normalize=0,"
                         f"afade=t=in:d={mix.fade_seconds},afade=t=out:st={fade_out:.3f}:d={mix.fade_seconds}[aout]")
        cmd += ["-filter_complex", ";".join(a_filters), "-map", "[aout]"]
        # -vf applies to the mapped video stream; filter_complex only handles audio here.
        cmd += ["-vf", ",".join(vf), "-c:a", "aac", "-b:a", f"{audio_kbps}k"]
    else:
        cmd += ["-vf", ",".join(vf), "-an"]
    cmd += ["-c:v", "libx264", "-preset", preset, "-crf", str(crf), "-pix_fmt", "yuv420p",
            "-movflags", "+faststart", out]
    return cmd


def render_clip(
    src: str, out: str, start: float, end: float, crop: str, ass_path: str | None,
    quality: str = "standard", mix: AudioMix | None = None, max_bytes: int | None = None, preset: str = DEFAULT_PRESET,
) -> RenderResult:
    """Render, then re-encode at a higher CRF (up to MAX_CRF) while the file exceeds max_bytes."""
    info = probe(src)
    q = QUALITY[quality]
    crf, attempts, notes = q["crf"], 0, []
    while True:
        attempts += 1
        cmd = build_command(src, out, start, end, crop, ass_path, crf, q["audio_kbps"], mix, preset, info.has_audio)
        proc = subprocess.run(cmd, capture_output=True, text=True)
        if proc.returncode != 0:
            raise RuntimeError(f"ffmpeg failed: {proc.stderr[-800:]}")
        size = os.path.getsize(out)
        if max_bytes is None or size <= max_bytes or crf >= MAX_CRF:
            if max_bytes and size > max_bytes:
                notes.append(f"Could not reach {max_bytes} bytes within quality limit (CRF {MAX_CRF}).")
            break
        crf = min(crf + 3, MAX_CRF)
        notes.append(f"Re-encoded at CRF {crf} to reduce size.")
    out_info = probe(out)
    # Original size is the proportional share of the source for this clip's duration.
    original = int(info.size_bytes * (end - start) / info.duration) if info.duration else info.size_bytes
    return RenderResult(out, size, crf, out_info.width, out_info.height, original, attempts, notes)
