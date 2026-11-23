"""Scene-cut detection with FFmpeg, and trimming that avoids one-frame flashes at clip edges."""
from __future__ import annotations
import re
import subprocess

from .models import ClipCandidate, Word


def detect_cuts(path: str, start: float, end: float, threshold: float = 0.3) -> list[float]:
    """Absolute timestamps of hard scene changes within [start, end]."""
    proc = subprocess.run(
        ["ffmpeg", "-hide_banner", "-ss", f"{start:.3f}", "-t", f"{end - start:.3f}", "-i", path,
         "-vf", f"select='gt(scene,{threshold})',showinfo", "-an", "-f", "null", "-"],
        capture_output=True, text=True,
    )
    return [start + float(m) for m in re.findall(r"pts_time:([0-9.]+)", proc.stderr)]


def trim_edge_flashes(c: ClipCandidate, cuts: list[float], words: list[Word], edge: float = 0.3) -> ClipCandidate:
    """If a cut sits just inside the first or last 0.3s the clip would open or close on a stray frame of another shot.
    Trim past it, but only when no spoken word falls inside the trimmed region."""
    start, end = c.start, c.end
    spoken = lambda a, b: any(w.start < b and w.end > a for w in words)
    for cut in cuts:
        if start < cut <= start + edge and not spoken(start, cut):
            start = cut
        elif end - edge <= cut < end and not spoken(cut, end):
            end = cut
    return c.model_copy(update={"start": start, "end": end}) if (start, end) != (c.start, c.end) else c
