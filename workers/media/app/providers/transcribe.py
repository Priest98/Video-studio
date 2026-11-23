"""Transcription providers behind one interface so faster-whisper and WhisperX can be benchmarked and swapped."""
from __future__ import annotations
from typing import Protocol

from ..models import Transcript, Word


class Transcriber(Protocol):
    name: str

    def transcribe(self, audio_path: str) -> Transcript: ...


class FasterWhisperTranscriber:
    name = "faster-whisper"

    def __init__(self, model_size: str = "small", device: str = "auto", compute_type: str = "int8"):
        self.model_size, self.device, self.compute_type = model_size, device, compute_type
        self._model = None

    def transcribe(self, audio_path: str) -> Transcript:
        if self._model is None:
            from faster_whisper import WhisperModel  # lazy: heavy optional dependency

            self._model = WhisperModel(self.model_size, device=self.device, compute_type=self.compute_type)
        segments, info = self._model.transcribe(audio_path, word_timestamps=True, vad_filter=True)
        words = [
            Word(text=w.word.strip(), start=w.start, end=w.end)
            for seg in segments
            for w in (seg.words or [])
            if w.word.strip()
        ]
        return Transcript(words=words, language=info.language)


class StubTranscriber:
    """Deterministic transcriber for tests and local runs without models."""

    name = "stub"

    def __init__(self, transcript: Transcript):
        self._t = transcript

    def transcribe(self, audio_path: str) -> Transcript:
        return self._t
