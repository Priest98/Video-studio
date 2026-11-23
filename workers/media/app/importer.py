"""Link import via yt-dlp for sources the user is entitled to use. No cookies, no circumvention, no DRM bypass."""
from __future__ import annotations
import os
from urllib.parse import urlparse

ALLOWED_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "twitch.tv", "www.twitch.tv", "clips.twitch.tv"}


class ImportRefused(ValueError):
    pass


def validate_import(url: str, rights_confirmed: bool) -> str:
    """The caller must confirm they own the content or have permission. A public URL is not permission."""
    if not rights_confirmed:
        raise ImportRefused("Confirm you have the rights to use this video before importing.")
    p = urlparse(url)
    if p.scheme != "https" or (p.hostname or "") not in ALLOWED_HOSTS:
        raise ImportRefused("Only https links from supported platforms can be imported; upload the file instead.")
    return url


MAX_HEIGHT = int(os.environ.get("SOURCE_MAX_HEIGHT", "1080"))


def download(url: str, dest_dir: str, max_seconds: int = 3600, max_bytes: int = 5 * 1024**3) -> str:
    import yt_dlp  # lazy

    opts = {
        "outtmpl": f"{dest_dir}/source.%(ext)s", "format": f"bv*[height<={MAX_HEIGHT}]+ba/b[height<={MAX_HEIGHT}]", "merge_output_format": "mp4",
        "noplaylist": True, "quiet": True, "max_filesize": max_bytes,
        "match_filter": lambda info, **_: None if (info.get("duration") or 0) <= max_seconds else f"longer than {max_seconds}s",
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=True)
        return ydl.prepare_filename(info).rsplit(".", 1)[0] + ".mp4"
