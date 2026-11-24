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
