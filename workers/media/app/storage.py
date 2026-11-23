"""Upload rendered clips to R2 (S3 compatible). Keys are always prefixed by workspace id."""
from __future__ import annotations
import os
from typing import Protocol


class Uploader(Protocol):
    def upload(self, path: str, key: str, content_type: str = "video/mp4") -> None: ...


class R2Uploader:
    def __init__(self):
        import boto3  # lazy: only needed in production

        self._s3 = boto3.client(
            "s3", region_name="auto",
            endpoint_url=f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
            aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"], aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        )
        self._bucket = os.environ["R2_BUCKET"]

    def upload(self, path: str, key: str, content_type: str = "video/mp4") -> None:
        self._s3.upload_file(path, self._bucket, key, ExtraArgs={"ContentType": content_type})


def clip_key(workspace_id: str, project_id: str, index: int) -> str:
    if not workspace_id or "/" in workspace_id or "/" in project_id:
        raise ValueError("invalid tenant id")
    return f"{workspace_id}/{project_id}/clips/{index:02d}.mp4"
