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


FaceDetector = Callable[["cv2.typing.MatLike"], "float | None"]  # grayscale frame -> face centre x, or None


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
        if not len(faces):
            return None
        x, _, w, _ = max(faces, key=lambda f: f[2] * f[3])
        return float(x + w / 2)

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
        samples, t = [], 0.0
        while start + t < end:
            cap.set(cv2.CAP_PROP_POS_MSEC, (start + t) * 1000)
            ok, frame = cap.read()
            if not ok:
                break
            scale = 480 / frame.shape[1] if frame.shape[1] > 480 else 1.0
            small = cv2.resize(frame, None, fx=scale, fy=scale) if scale != 1.0 else frame
            gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
            cx = detector(gray)
            samples.append((t, cx / scale if cx is not None else None))
            t += 1 / sample_fps
        return samples
    finally:
        cap.release()


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
