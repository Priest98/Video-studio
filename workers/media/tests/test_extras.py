import json
import subprocess

import httpx
import pytest

from app.callback import sign
from app.importer import ImportRefused, validate_import
from app.models import ClipCandidate, Word
from app.providers.tts import ElevenLabsProvider, fit_to_duration
from app.reframe import pick_primary
from app.scenes import detect_cuts, trim_edge_flashes
from app.storage import clip_key
from app.pipeline import JobSettings, run_pipeline
from app.providers.transcribe import StubTranscriber
from app.models import SelectionSettings, Transcript
from app.probe import probe


@pytest.fixture(scope="module")
def cut_video(tmp_path_factory):
    # Two different shots joined at exactly 5.0s: a hard scene change.
    out = str(tmp_path_factory.mktemp("s") / "cut.mp4")
    subprocess.run([
        "ffmpeg", "-y", "-loglevel", "error",
        "-f", "lavfi", "-i", "color=c=red:size=640x360:rate=30:duration=5",
        "-f", "lavfi", "-i", "color=c=blue:size=640x360:rate=30:duration=5",
        "-f", "lavfi", "-i", "sine=frequency=300:duration=10",
        "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v]", "-map", "[v]", "-map", "2:a", "-c:v", "libx264", "-c:a", "aac", out,
    ], check=True)
    return out


def test_scene_cut_detected_near_five_seconds(cut_video):
    cuts = detect_cuts(cut_video, 0, 10)
    assert any(abs(c - 5.0) < 0.2 for c in cuts)


def test_trim_moves_past_an_edge_flash_only_when_no_word_is_cut():
    c = ClipCandidate(start=4.9, end=12.0)
    out = trim_edge_flashes(c, [5.0], words=[Word(text="a", start=6.0, end=6.4)])
    assert out.start == 5.0 and out.end == 12.0
    blocked = trim_edge_flashes(c, [5.0], words=[Word(text="a", start=4.92, end=5.2)])
    assert blocked.start == 4.9


def test_primary_speaker_is_stable_then_switches_only_after_hysteresis():
    a, b = 300.0, 900.0
    frames = [[(a, 100.0), (b, 80.0)]] * 5            # A is the primary
    frames += [[(a, 80.0), (b, 100.0)]] * 2           # B briefly larger: must not switch
    frames += [[(a, 100.0), (b, 80.0)]] * 3
    frames += [[(a, 60.0), (b, 100.0)]] * 6           # B sustained: switch
    out = pick_primary(frames, jump_px=200, hysteresis=4)
    assert all(x == a for x in out[:10])
    assert out[-1] == b
    assert pick_primary([[], [(a, 1.0)], []], 200) == [None, a, None]


def test_import_requires_rights_and_a_supported_https_host():
    ok = "https://www.youtube.com/watch?v=abc"
    assert validate_import(ok, True) == ok
    with pytest.raises(ImportRefused):
        validate_import(ok, False)
    with pytest.raises(ImportRefused):
        validate_import("http://www.youtube.com/watch?v=abc", True)
    with pytest.raises(ImportRefused):
        validate_import("https://evil.example/video.mp4", True)


def test_callback_signature_is_stable_and_secret_dependent():
    body = b'{"a":1}'
    assert sign("s", "1", body) == sign("s", "1", body)
    assert sign("s", "1", body) != sign("t", "1", body)
    assert sign("s", "1", body) != sign("s", "2", body)


def test_clip_keys_are_tenant_prefixed_and_reject_traversal():
    assert clip_key("ws1", "p1", 3) == "ws1/p1/clips/03.mp4"
    with pytest.raises(ValueError):
        clip_key("ws1/../x", "p1", 1)


def test_elevenlabs_reports_usage_and_cost(tmp_path):
    wav = tmp_path / "s.wav"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=200:duration=2", "-c:a", "pcm_s16le", str(wav)], check=True)
    seen = {}

    def handler(req: httpx.Request):
        seen["key"] = req.headers["xi-api-key"]
        seen["body"] = json.loads(req.content)
        return httpx.Response(200, content=wav.read_bytes())

    p = ElevenLabsProvider("k", httpx.Client(transport=httpx.MockTransport(handler)))
    sp = p.synthesize("hello world", "voice1", str(tmp_path / "o.raw"))
    assert seen["key"] == "k" and seen["body"]["text"] == "hello world"
    assert sp.characters == 11 and sp.cost_usd > 0 and sp.seconds == pytest.approx(2, abs=0.2)


def test_narration_is_sped_up_within_bounds_or_flagged(tmp_path):
    long_ = tmp_path / "l.wav"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=200:duration=11", str(long_)], check=True)
    _, fits = fit_to_duration(str(long_), 10, str(tmp_path / "a.wav"))      # 1.1x tempo is acceptable
    assert fits
    _, fits = fit_to_duration(str(long_), 5, str(tmp_path / "b.wav"))       # would need >1.25x: flagged
    assert not fits


def test_pipeline_applies_narration_and_reports_usage(cut_video, tmp_path):
    words, t = [], 0.0
    for s in range(6):
        for i in range(8):
            words.append(Word(text=f"w{s}{i}" + ("." if i == 7 else ""), start=t, end=t + 0.45)); t += 0.5
        t += 0.3
    wav = tmp_path / "v.wav"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=200:duration=4", str(wav)], check=True)

    class FakeTTS:
        name = "fake"
        def voices(self): return []
        def synthesize(self, text, voice, out_path, speed=1.0):
            from app.providers.tts import Speech
            import shutil; shutil.copy(wav, out_path)
            return Speech(out_path, len(text), 4.0, "fake", 0.01)

    st = JobSettings(selection=SelectionSettings(clip_count=1, min_seconds=8, max_seconds=12), narrations={1: "Welcome to the clip."}, voice="v")
    _, outs = run_pipeline(cut_video, str(tmp_path / "job"), StubTranscriber(Transcript(words=words)), st, tts=FakeTTS())
    assert outs[0].voice_characters == len("Welcome to the clip.") and outs[0].voice_cost_usd == 0.01
    assert outs[0].narration_fits is True
    assert probe(outs[0].render.path).has_audio
