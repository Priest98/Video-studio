"""Clips are uploaded and announced one by one while later clips still render."""
import threading
from types import SimpleNamespace

from app import main
from app.models import ClipCandidate


class FakeUploader:
    def __init__(self):
        self.keys = []

    def upload(self, path, key):
        self.keys.append(key)


def _out(i):
    cand = ClipCandidate(start=i, end=i + 5, title=f"c{i}", description="", transcript="", hook="", category="x", engagement_score=1, reason="r")
    render = SimpleNamespace(path=f"/tmp/clip{i}.mp4", size_bytes=1, crf=23, compression_pct=0, width=720, height=1280)
    return SimpleNamespace(candidate=cand, render=render, crop_confident=True, narration_fits=None, voice_characters=0, voice_cost_usd=0.0)


def test_each_clip_is_announced_then_final_result_lists_all(monkeypatch, tmp_path):
    sent = []
    monkeypatch.setattr(main, "WORK_ROOT", str(tmp_path))
    monkeypatch.setattr(main, "_acquire", lambda job_id, req: "src.mp4")
    monkeypatch.setattr(main, "probe", lambda src: SimpleNamespace(duration=60.0))
    monkeypatch.setattr(main, "_send", lambda req, payload: sent.append(payload))

    def fake_pipeline(src, workdir, transcriber, settings, **kw):
        outs = [_out(i) for i in (1, 2)]
        for i, o in enumerate(outs, 1):
            kw["on_clip"](i, o)
        return None, outs

    monkeypatch.setattr(main, "run_pipeline", fake_pipeline)
    main.JOBS["j"] = {"id": "j"}
    main.CANCEL["j"] = threading.Event()
    up = FakeUploader()
    main._run("j", main.JobRequest(workspace_id="w", project_id="p", import_url=None), up)

    assert main.JOBS["j"]["status"] == "ready"
    assert [p.get("partial", False) for p in sent] == [True, True, False]
    assert len(sent[-1]["clips"]) == 2 and len(up.keys) == 2  # nothing uploaded twice


# ---- long recordings are processed in windows ----
import pytest
from app import pipeline
from app.models import SelectionSettings, Transcript, Word
from app.pipeline import JobSettings, run_pipeline, windows_for
from tests.test_media import make_words, video  # noqa: F401  (video is a fixture)


def test_windows_cover_the_whole_video_and_merge_a_tiny_tail():
    w = windows_for(3 * 3600 + 60, 1500)
    assert abs(sum(l for _, l in w) - (3 * 3600 + 60)) < 1e-6 and w[0][0] == 0
    assert all(l <= 1500 * 1.2 for _, l in w)  # the 60s tail was merged, not left as its own window
    assert len(windows_for(600, 1500)) == 1


class PerWindowTranscriber:
    name = "per-window"

    def transcribe(self, audio_path):
        return Transcript(words=make_words(n_sentences=3, words_per=8).words)


def test_long_video_yields_a_clip_per_window_with_times_in_the_original_video(video, tmp_path, monkeypatch):  # noqa: F811
    monkeypatch.setattr(pipeline, "LONG_SOURCE_SECONDS", 10)
    monkeypatch.setattr(pipeline, "WINDOW_SECONDS", 20)
    seen, stats = [], {}
    st = JobSettings(SelectionSettings(clip_count=2, min_seconds=5, max_seconds=12))
    _, outs = run_pipeline(video, str(tmp_path / "job"), PerWindowTranscriber(), st,
                           on_clip=lambda i, o: seen.append(i), info_cb=lambda **kw: stats.update(kw))
    assert len(outs) == 2 and seen == [1, 2]
    assert outs[0].candidate.start < 20 <= outs[1].candidate.start  # second clip comes from the second window
    assert stats["clips_done"] == 2 and stats["expected"] == 2 and stats["eta_seconds"] == 0
