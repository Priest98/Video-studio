import json
import os
import subprocess

import pytest

from app.captions import STYLES, build_ass, clip_words
from app.models import SelectionSettings, Transcript, Word
from app.pipeline import JobSettings, run_pipeline
from app.probe import probe
from app.providers.selector import HeuristicSelector, validate_candidates
from app.providers.transcribe import StubTranscriber
from app.render import AudioMix, build_command, render_clip
from app.reframe import CropPlan, crop_filter, plan_crop


def make_words(n_sentences=8, words_per=8, sec_per_word=0.5):
    words, t = [], 0.0
    for s in range(n_sentences):
        for i in range(words_per):
            text = f"word{s}_{i}" + ("." if i == words_per - 1 else "")
            words.append(Word(text=text, start=t, end=t + sec_per_word - 0.05))
            t += sec_per_word
        t += 0.3  # pause between sentences
    return Transcript(words=words)


@pytest.fixture(scope="session")
def video(tmp_path_factory):
    out = str(tmp_path_factory.mktemp("v") / "src.mp4")
    subprocess.run([
        "ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30:duration=40",
        "-f", "lavfi", "-i", "sine=frequency=440:duration=40", "-c:v", "libx264", "-c:a", "aac", "-shortest", out,
    ], check=True)
    return out


def test_selector_clips_start_and_end_on_sentence_boundaries_within_limits():
    t = make_words()
    s = SelectionSettings(clip_count=2, min_seconds=10, max_seconds=20)
    clips = HeuristicSelector().select(t, s)
    assert 1 <= len(clips) <= 2
    starts = {w.start for i, w in enumerate(t.words) if i == 0 or t.words[i - 1].text.endswith(".")}
    ends = {w.end for w in t.words if w.text.endswith(".")}
    for c in clips:
        assert s.min_seconds <= c.duration <= s.max_seconds
        assert any(abs(c.start - x) < 1e-6 for x in starts)
        assert any(abs(c.end - x) < 1e-6 for x in ends)
    for a, b in zip(clips, clips[1:]):
        assert a.end <= b.start  # no overlaps


def test_model_output_is_snapped_and_bad_items_dropped():
    t = make_words()
    s = SelectionSettings(clip_count=3, min_seconds=10, max_seconds=20)
    items = [
        {"start": 0.4, "end": 12.1, "title": "ok", "engagement_score": 250},
        {"start": "x", "end": 5},            # malformed
        {"start": 1.0, "end": 3.0},           # too short after snapping
    ]
    out = validate_candidates(items, t, s)
    assert len(out) == 1
    assert out[0].engagement_score == 100  # clamped
    assert out[0].start == t.words[0].start


def test_ass_styles_and_safe_margins():
    t = make_words(1, 6)
    for name in STYLES:
        ass = build_ass(t.words, name, "word")
        assert "PlayResX: 1080" in ass and "PlayResY: 1920" in ass
        assert ",420,1" in ass  # MarginV keeps captions above platform UI
        assert ass.count("Dialogue:") == 6  # one event per word in word mode
    assert build_ass(t.words, "minimal", "sentence").count("Dialogue:") >= 1


def test_clip_words_are_rebased_to_zero():
    t = make_words()
    ws = clip_words(t.words, t.words[8].start, t.words[15].end)
    assert ws[0].start == pytest.approx(0.0)


def test_crop_plan_follows_face_with_smoothing_and_falls_back():
    samples = [(i * 0.5, 300 + i * 30) for i in range(20)]
    plan = plan_crop(samples, 1280, 720)
    assert plan.crop_w == 404 and plan.confident
    xs = [x for _, x in plan.keypoints]
    assert xs == sorted(xs) and 0 <= xs[0] and xs[-1] <= 1280 - plan.crop_w
    assert "clip(" in crop_filter(plan)
    fallback = plan_crop([(0, None), (0.5, None)], 1280, 720)
    assert not fallback.confident and fallback.keypoints[0][1] == (1280 - 404) / 2


def test_audio_mix_graph_ducks_under_narration():
    cmd = build_command("s.mp4", "o.mp4", 0, 10, "crop=404:720:x='0':y=0", None, 24, 128,
                        AudioMix(voiceover="v.wav", mode="overlay"))
    graph = cmd[cmd.index("-filter_complex") + 1]
    assert "sidechaincompress" in graph and "amix=inputs=2" in graph


def test_render_produces_spec_compliant_mp4(video, tmp_path):
    ass = tmp_path / "c.ass"
    ass.write_text(build_ass(make_words(1, 6).words, "cinematic"))
    out = str(tmp_path / "o.mp4")
    r = render_clip(video, out, 2, 12, "crop=404:720:x='0':y=0", str(ass), quality="standard")
    info = subprocess.run(["ffprobe", "-v", "error", "-print_format", "json", "-show_streams", out],
                          capture_output=True, text=True).stdout
    streams = json.loads(info)["streams"]
    v = next(s for s in streams if s["codec_type"] == "video")
    a = next(s for s in streams if s["codec_type"] == "audio")
    assert (v["width"], v["height"], v["codec_name"], v["pix_fmt"]) == (1080, 1920, "h264", "yuv420p")
    assert a["codec_name"] == "aac"
    assert probe(out).duration == pytest.approx(10, abs=0.3)
    assert r.crf == 24


def test_adaptive_compression_shrinks_file_within_quality_bound(video, tmp_path):
    base = render_clip(video, str(tmp_path / "a.mp4"), 0, 10, "crop=404:720:x='0':y=0", None, quality="high")
    small = render_clip(video, str(tmp_path / "b.mp4"), 0, 10, "crop=404:720:x='0':y=0", None,
                        quality="standard", max_bytes=int(base.size_bytes * 0.5))
    assert small.size_bytes < base.size_bytes
    assert small.crf > 24 and small.crf <= 34


def test_voiceover_replace_and_overlay_render(video, tmp_path):
    voice = str(tmp_path / "v.wav")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=220:duration=5", voice], check=True)
    for mode in ("replace", "overlay", "keep"):
        out = str(tmp_path / f"{mode}.mp4")
        render_clip(video, out, 0, 8, "crop=404:720:x='0':y=0", None, mix=AudioMix(voiceover=voice, mode=mode))
        assert probe(out).has_audio


def test_full_pipeline_with_stub_transcriber(video, tmp_path):
    t = make_words(8, 8)
    settings = JobSettings(selection=SelectionSettings(clip_count=2, min_seconds=10, max_seconds=20))
    stages = []
    _, outs = run_pipeline(video, str(tmp_path / "job"), StubTranscriber(t), settings,
                           progress=lambda s, p: stages.append(s))
    assert len(outs) >= 1
    for o in outs:
        info = probe(o.render.path)
        assert (info.width, info.height) == (1080, 1920)
        assert o.render.compression_pct is not None
    assert {"analyse", "transcribe", "select", "render"} <= set(stages)


def test_face_sampling_uses_injected_detector_and_scales_back(video):
    from app.reframe import sample_faces
    s = sample_faces(video, 0, 3, detector=lambda gray: gray.shape[1] / 2)  # detector sees a 480px-wide frame
    assert len(s) == 6 and all(abs(c - 640) < 1 for _, c in s)  # mapped back to 1280px source coordinates


def test_missing_detector_falls_back_to_centre_crop(video):
    from app.reframe import sample_faces
    import app.reframe as r
    original = r.haar_detector
    r.haar_detector = lambda: None
    try:
        plan = plan_crop(sample_faces(video, 0, 3), 1280, 720)
    finally:
        r.haar_detector = original
    assert not plan.confident
