"""Smart reframing to 9:16: face tracking, smoothing, and an FFmpeg crop expression."""
from __future__ import annotations
from dataclasses import dataclass
from typing import Callable

import cv2

TARGET_ASPECT = 9 / 16


@dataclass
class CropPlan:
    crop_w: int
    crop_h: int
    keypoints: list[tuple[float, float]]  # (seconds from clip start, crop x offset in px)
    confident: bool  # False means a fallback was used and the UI should offer manual adjustment


Face = tuple[float, float]  # (centre x, area)
FaceDetector = Callable[["cv2.typing.MatLike"], "list[Face] | float | None"]  # grayscale frame -> faces (a bare float = one face)


def haar_detector() -> FaceDetector | None:
    """OpenCV Haar detector (largest face = primary speaker). None when the cascade file is not bundled
    (some OpenCV builds omit it); pin opencv-python-headless 4.x in production, or plug in MediaPipe."""
    data_dir = getattr(getattr(cv2, "data", None), "haarcascades", None)
    if not data_dir:
        return None
    cascade = cv2.CascadeClassifier(data_dir + "haarcascade_frontalface_default.xml")
    if cascade.empty():
        return None

    def detect(gray):
        faces = cascade.detectMultiScale(gray, 1.1, 5, minSize=(30, 30))
        return [(float(x + w / 2), float(w * h)) for x, _, w, h in faces]

    return detect


def sample_faces(
    path: str, start: float, end: float, sample_fps: float = 2.0, detector: FaceDetector | None = None,
) -> list[tuple[float, float | None]]:
    """Returns (t, face centre x in source px) per sample; None when no face was found or no detector exists."""
    detector = detector or haar_detector()
    if detector is None:
        return []  # plan_crop then falls back to a centre crop and flags manual adjustment
    cap = cv2.VideoCapture(path)
    try:
        frames, t = [], 0.0
        while start + t < end:
            cap.set(cv2.CAP_PROP_POS_MSEC, (start + t) * 1000)
            ok, frame = cap.read()
            if not ok:
                break
            scale = 480 / frame.shape[1] if frame.shape[1] > 480 else 1.0
            small = cv2.resize(frame, None, fx=scale, fy=scale) if scale != 1.0 else frame
            gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
            found = detector(gray)
            if found is None:
                found = []
            elif isinstance(found, (int, float)):
                found = [(float(found), 1.0)]
            frames.append((t, [(cx / scale, area) for cx, area in found]))
            t += 1 / sample_fps
        return list(zip([t for t, _ in frames], pick_primary([f for _, f in frames], jump_px=src_width_hint(cap) * 0.15)))
    finally:
        cap.release()


def src_width_hint(cap) -> float:
    return float(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 1280)


def pick_primary(frames: list[list[Face]], jump_px: float = 150, hysteresis: int = 4) -> list[float | None]:
    """Follow one speaker through a multi-face shot. Stay on the current face (nearest to it each frame) and only
    switch to another face after it has been the largest, and far from the current one, for `hysteresis` frames in a row."""
    out: list[float | None] = []
    current: float | None = None
    streak, challenger = 0, None
    for faces in frames:
        if not faces:
            out.append(None)
            continue
        biggest = max(faces, key=lambda f: f[1])[0]
        if current is None:
            current = biggest
        else:
            nearest = min(faces, key=lambda f: abs(f[0] - current))[0]
            if abs(biggest - current) > jump_px:
                streak = streak + 1 if challenger is not None and abs(biggest - challenger) <= jump_px else 1
                challenger = biggest
                if streak >= hysteresis:
                    current, streak, challenger = biggest, 0, None
                else:
                    current = nearest if abs(nearest - current) <= jump_px else current
            else:
                streak, challenger, current = 0, None, nearest
        out.append(current)
    return out


def plan_crop(
    samples: list[tuple[float, float | None]], src_w: int, src_h: int,
    max_keypoints: int = 24, deadband_px: float = 40, ema: float = 0.4,
) -> CropPlan:
    crop_h = src_h
    crop_w = min(src_w, int(round(src_h * TARGET_ASPECT / 2) * 2))
    centre_x = (src_w - crop_w) / 2
    found = [c for _, c in samples if c is not None]
    if crop_w >= src_w:
        return CropPlan(crop_w, crop_h, [(0.0, 0.0)], True)  # already narrower than 9:16
    if not samples or len(found) / len(samples) < 0.3:
        return CropPlan(crop_w, crop_h, [(0.0, centre_x)], False)

    # Fill gaps with the last known position, then smooth with an EMA and a deadband against jitter.
    path, last = [], found[0]
    for t, c in samples:
        last = c if c is not None else last
        path.append((t, last))
    smoothed, cur = [], path[0][1]
    for t, c in path:
        cur = cur + ema * (c - cur) if abs(c - cur) > deadband_px else cur
        x = min(max(cur - crop_w / 2, 0), src_w - crop_w)
        smoothed.append((t, x))
    if len(smoothed) > max_keypoints:
        step = (len(smoothed) - 1) / (max_keypoints - 1)
        smoothed = [smoothed[round(i * step)] for i in range(max_keypoints)]
    return CropPlan(crop_w, crop_h, smoothed, True)


def crop_filter(plan: CropPlan) -> str:
    """Piecewise-linear crop x(t) as a sum of clipped ramps; compact and valid FFmpeg expression syntax."""
    kp = plan.keypoints
    if len(kp) == 1:
        x = f"{kp[0][1]:.1f}"
    else:
        terms = [f"{kp[0][1]:.1f}"]
        for (t0, x0), (t1, x1) in zip(kp, kp[1:]):
            if t1 > t0 and abs(x1 - x0) > 0.5:
                terms.append(f"({x1 - x0:.1f})*clip((t-{t0:.2f})/{t1 - t0:.2f}\\,0\\,1)")
        x = "+".join(terms)
    return f"crop={plan.crop_w}:{plan.crop_h}:x='{x}':y=0"
