"""ASS caption generation with four presets, word-highlight and sentence modes, inside platform-safe areas."""
from __future__ import annotations
from dataclasses import dataclass

from .models import Word

PLAY_W, PLAY_H = 1080, 1920
# Keep text clear of the bottom UI (caption, buttons) and right-side action rail on short-form apps.
MARGIN_V, MARGIN_LR = 420, 110


@dataclass(frozen=True)
class CaptionStyle:
    name: str
    font: str
    size: int
    primary: str  # &HAABBGGRR
    highlight: str
    outline_color: str
    outline: int
    shadow: int
    box: bool = False
    bold: bool = True
    uppercase: bool = False


STYLES = {
    "minimal": CaptionStyle("minimal", "Arial", 56, "&H00FFFFFF", "&H00FFFFFF", "&H00000000", 2, 0, bold=False),
    "bold_animated": CaptionStyle("bold_animated", "Arial", 76, "&H00FFFFFF", "&H0000E5FF", "&H00000000", 5, 2, uppercase=True),
    "cinematic": CaptionStyle("cinematic", "Georgia", 60, "&H00F0F0F0", "&H0040C0FF", "&H00101010", 2, 3, bold=False),
    "clean_educational": CaptionStyle("clean_educational", "Arial", 58, "&H00FFFFFF", "&H0000C8FF", "&H00000000", 1, 0, box=True),
}


def _ts(sec: float) -> str:
    cs = round(sec * 100)
    h, rem = divmod(cs, 360000)
    m, rem = divmod(rem, 6000)
    s, c = divmod(rem, 100)
    return f"{h}:{m:02d}:{s:02d}.{c:02d}"


def _escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("{", "(").replace("}", ")").replace("\n", " ")


def group_lines(words: list[Word], max_words: int = 4, max_chars: int = 24) -> list[list[Word]]:
    lines, cur = [], []
    for w in words:
        if cur and (len(cur) >= max_words or len(" ".join(x.text for x in cur + [w])) > max_chars):
            lines.append(cur)
            cur = []
        cur.append(w)
        if w.text.endswith((".", "!", "?")):
            lines.append(cur)
            cur = []
    if cur:
        lines.append(cur)
    return lines


def build_ass(words: list[Word], style_name: str = "bold_animated", mode: str = "word") -> str:
    """`words` must be relative to the clip start (0 = first frame). mode: 'word' highlights the spoken word; 'sentence' shows lines."""
    st = STYLES[style_name]
    border_style = 3 if st.box else 1
    back = "&H99000000" if st.box else "&H64000000"
    header = (
        "[Script Info]\nScriptType: v4.00+\n"
        f"PlayResX: {PLAY_W}\nPlayResY: {PLAY_H}\nWrapStyle: 0\n\n"
        "[V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,"
        "Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\n"
        f"Style: Default,{st.font},{st.size},{st.primary},{st.highlight},{st.outline_color},{back},{-1 if st.bold else 0},0,0,0,"
        f"100,100,0,0,{border_style},{st.outline},{st.shadow},2,{MARGIN_LR},{MARGIN_LR},{MARGIN_V},1\n\n"
        "[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\n"
    )
    fmt = (lambda t: t.upper()) if st.uppercase else (lambda t: t)
    events = []
    for line in group_lines(words):
        if mode == "sentence":
            text = _escape(fmt(" ".join(w.text for w in line)))
            events.append(f"Dialogue: 0,{_ts(line[0].start)},{_ts(line[-1].end)},Default,,0,0,0,,{text}")
            continue
        for i, active in enumerate(line):
            end = line[i + 1].start if i + 1 < len(line) else active.end
            parts = []
            for j, w in enumerate(line):
                t = _escape(fmt(w.text))
                parts.append(f"{{\\c{st.highlight}}}{t}{{\\c{st.primary}}}" if j == i else t)
            events.append(f"Dialogue: 0,{_ts(active.start)},{_ts(max(end, active.start + 0.05))},Default,,0,0,0,,{' '.join(parts)}")
    return header + "\n".join(events) + "\n"


def clip_words(words: list[Word], start: float, end: float) -> list[Word]:
    return [Word(text=w.text, start=w.start - start, end=min(w.end, end) - start) for w in words if w.start >= start and w.end <= end]
