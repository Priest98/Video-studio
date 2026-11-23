from __future__ import annotations
from pydantic import BaseModel, Field


class Word(BaseModel):
    text: str
    start: float
    end: float


class Transcript(BaseModel):
    words: list[Word]
    language: str = "en"

    @property
    def text(self) -> str:
        return " ".join(w.text for w in self.words)


class ClipCandidate(BaseModel):
    start: float
    end: float
    title: str = ""
    description: str = ""
    transcript: str = ""
    hook: str = ""
    category: str = ""
    # An estimate for ranking only, never a virality prediction.
    engagement_score: float = Field(ge=0, le=100, default=50)
    reason: str = ""

    @property
    def duration(self) -> float:
        return self.end - self.start


class SelectionSettings(BaseModel):
    clip_count: int = 5
    min_seconds: float = 20
    max_seconds: float = 60
    categories: list[str] = []
