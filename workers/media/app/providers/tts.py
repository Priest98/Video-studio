"""Voice providers behind one interface. Each reports usage so characters, seconds and cost can be metered per customer."""
from __future__ import annotations
import subprocess
from dataclasses import dataclass
from typing import Protocol

import httpx


@dataclass
class Speech:
    path: str
    characters: int
    seconds: float
    provider: str
    cost_usd: float


class TTSProvider(Protocol):
    name: str

    def voices(self) -> list[dict]: ...

    def synthesize(self, text: str, voice: str, out_path: str, speed: float = 1.0) -> Speech: ...


def _duration(path: str) -> float:
    return float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
                                capture_output=True, text=True, check=True).stdout)


class ElevenLabsProvider:
    """Premium voices. Needs a paid plan for commercial use; the key can be the platform's or the customer's own."""

    name = "elevenlabs"
    # Placeholder estimate for metering only; replace with the real contract price.
    USD_PER_1K_CHARS = 0.30

    def __init__(self, api_key: str, client: httpx.Client | None = None):
        self.api_key, self.client = api_key, client or httpx.Client(timeout=120)

    def voices(self) -> list[dict]:
        r = self.client.get("https://api.elevenlabs.io/v1/voices", headers={"xi-api-key": self.api_key})
        r.raise_for_status()
        return [{"id": v["voice_id"], "name": v["name"]} for v in r.json().get("voices", [])]

    def synthesize(self, text: str, voice: str, out_path: str, speed: float = 1.0) -> Speech:
        r = self.client.post(
            f"https://api.elevenlabs.io/v1/text-to-speech/{voice}", headers={"xi-api-key": self.api_key, "accept": "audio/mpeg"},
            json={"text": text, "voice_settings": {"speed": speed}},
        )
        r.raise_for_status()
        with open(out_path, "wb") as f:
            f.write(r.content)
        return Speech(out_path, len(text), _duration(out_path), self.name, len(text) / 1000 * self.USD_PER_1K_CHARS)


class KokoroProvider:
    """Self-hosted default. Check the model and per-voice licences before commercial deployment."""

    name = "kokoro"

    def __init__(self, lang_code: str = "a"):
        self.lang_code = lang_code
        self._pipe = None

    def voices(self) -> list[dict]:
        return [{"id": v, "name": v} for v in ("af_heart", "af_bella", "am_adam", "bf_emma", "bm_george")]

    def synthesize(self, text: str, voice: str, out_path: str, speed: float = 1.0) -> Speech:
        import numpy as np  # lazy heavy deps
        import soundfile as sf
        from kokoro import KPipeline

        self._pipe = self._pipe or KPipeline(lang_code=self.lang_code)
        audio = np.concatenate([a for _, _, a in self._pipe(text, voice=voice, speed=speed)])
        sf.write(out_path, audio, 24000)
        return Speech(out_path, len(text), _duration(out_path), self.name, 0.0)


def fit_to_duration(path: str, target_seconds: float, out_path: str, min_tempo: float = 0.85, max_tempo: float = 1.25) -> tuple[str, bool]:
    """Speed narration up or down within natural bounds so it fits the clip. Returns (path, fits).
    If it cannot fit within the bounds, it is trimmed to the clip length and fits=False so the UI can ask for a shorter script."""
    have = _duration(path)
    tempo = min(max(have / target_seconds, min_tempo), max_tempo) if have > target_seconds else 1.0
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", path, "-filter:a", f"atempo={tempo:.4f}", "-t", f"{target_seconds:.3f}", out_path]
    subprocess.run(cmd, check=True)
    return out_path, have / tempo <= target_seconds + 0.05
