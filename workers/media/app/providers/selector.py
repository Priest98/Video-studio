"""Clip selection. The heuristic selector is always available; Gemini is an optional upgrade."""
from __future__ import annotations
import json
import re
from typing import Protocol

import httpx

from ..models import ClipCandidate, SelectionSettings, Transcript

SENTENCE_END = re.compile(r"[.!?][\"')\]]*$")


class Selector(Protocol):
    name: str

    def select(self, transcript: Transcript, settings: SelectionSettings) -> list[ClipCandidate]: ...


def sentences(transcript: Transcript) -> list[tuple[int, int]]:
    """Index ranges (inclusive start, exclusive end) of sentences, so clips never start or end mid-sentence."""
    spans, start = [], 0
    for i, w in enumerate(transcript.words):
        next_gap = transcript.words[i + 1].start - w.end if i + 1 < len(transcript.words) else 99
        if SENTENCE_END.search(w.text) or next_gap > 1.2:
            spans.append((start, i + 1))
            start = i + 1
    if start < len(transcript.words):
        spans.append((start, len(transcript.words)))
    return spans


_HOOK_TERMS = re.compile(r"\b(secret|mistake|never|always|why|how|biggest|truth|actually|nobody|stop|learn|story)\b", re.I)


class HeuristicSelector:
    name = "heuristic"

    def select(self, transcript: Transcript, settings: SelectionSettings) -> list[ClipCandidate]:
        spans = sentences(transcript)
        words = transcript.words
        candidates: list[ClipCandidate] = []
        for i in range(len(spans)):
            first = spans[i][0]
            for j in range(i, len(spans)):
                last = spans[j][1] - 1
                dur = words[last].end - words[first].start
                if dur > settings.max_seconds:
                    break
                if dur < settings.min_seconds:
                    continue
                text = " ".join(w.text for w in words[first : last + 1])
                n_words = last - first + 1
                pace = n_words / max(dur, 1)
                hooks = len(_HOOK_TERMS.findall(text))
                opener = 8 if _HOOK_TERMS.search(" ".join(w.text for w in words[first : first + 8])) else 0
                score = min(100.0, 35 + 10 * min(hooks, 3) + opener + 12 * min(pace / 3, 1) + text.count("?") * 3)
                candidates.append(ClipCandidate(
                    start=words[first].start, end=words[last].end, transcript=text,
                    title=" ".join(text.split()[:8]).rstrip(".,!?"),
                    hook=" ".join(text.split()[:12]), engagement_score=round(score, 1),
                    reason="Complete thought between sentence boundaries; scored on hook words, pace and opener.",
                ))
        candidates.sort(key=lambda c: c.engagement_score, reverse=True)
        picked: list[ClipCandidate] = []
        for c in candidates:  # greedy, no overlaps
            if all(c.end <= p.start or c.start >= p.end for p in picked):
                picked.append(c)
            if len(picked) >= settings.clip_count:
                break
        return sorted(picked, key=lambda c: c.start)


class GeminiSelector:
    """Semantic selection via the Gemini API. Output is validated and snapped to sentence boundaries."""

    name = "gemini"
    URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

    def __init__(self, api_key: str, model: str, client: httpx.Client | None = None):
        self.api_key, self.model = api_key, model
        self.client = client or httpx.Client(timeout=120)

    def _prompt(self, t: Transcript, s: SelectionSettings) -> str:
        lines = [f"[{w.start:.2f}] {w.text}" for w in t.words]
        return (
            f"Pick up to {s.clip_count} short-form clips from this timestamped transcript. Each must be "
            f"{s.min_seconds:.0f}-{s.max_seconds:.0f} seconds, start at the beginning of a sentence, contain a "
            "complete thought and end when the speaker finishes. Return JSON only: a list of objects with "
            "start, end (seconds), title, description, hook, category, engagement_score (0-100 estimate), reason."
            + (f" Preferred categories: {', '.join(s.categories)}." if s.categories else "")
            + "\n\n" + " ".join(lines)
        )

    def select(self, transcript: Transcript, settings: SelectionSettings) -> list[ClipCandidate]:
        resp = self.client.post(
            self.URL.format(model=self.model),
            params={"key": self.api_key},
            json={
                "contents": [{"parts": [{"text": self._prompt(transcript, settings)}]}],
                "generationConfig": {"responseMimeType": "application/json"},
            },
        )
        resp.raise_for_status()
        raw = resp.json()["candidates"][0]["content"]["parts"][0]["text"]
        return validate_candidates(json.loads(raw), transcript, settings)


def validate_candidates(items: list[dict], transcript: Transcript, settings: SelectionSettings) -> list[ClipCandidate]:
    """Model output is a proposal. Snap to sentence boundaries, enforce limits, drop overlaps."""
    spans = sentences(transcript)
    words = transcript.words
    starts = [words[a].start for a, _ in spans]
    ends = [words[b - 1].end for _, b in spans]
    out: list[ClipCandidate] = []
    for it in items:
        try:
            s, e = float(it["start"]), float(it["end"])
        except (KeyError, TypeError, ValueError):
            continue
        s = min(starts, key=lambda x: abs(x - s))
        e = min(ends, key=lambda x: abs(x - e))
        if not (settings.min_seconds <= e - s <= settings.max_seconds):
            continue
        if any(not (e <= o.start or s >= o.end) for o in out):
            continue
        text = " ".join(w.text for w in words if w.start >= s and w.end <= e)
        out.append(ClipCandidate(
            start=s, end=e, transcript=text, title=str(it.get("title", ""))[:120],
            description=str(it.get("description", ""))[:500], hook=str(it.get("hook", ""))[:200],
            category=str(it.get("category", ""))[:60],
            engagement_score=max(0, min(100, float(it.get("engagement_score", 50) or 50))),
            reason=str(it.get("reason", ""))[:500],
        ))
    return sorted(out, key=lambda c: c.start)[: settings.clip_count]
