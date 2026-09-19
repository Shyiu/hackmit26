from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from uuid import uuid4


@dataclass(frozen=True, slots=True)
class StoredImage:
    key: str
    sha256: str
    bytes: int


class LocalFrameStore:
    def __init__(self, directory: str):
        self.directory = Path(directory)

    def put(self, patient_id, jpeg: bytes, captured_at: datetime) -> StoredImage:
        key = f"frames/{patient_id}/{captured_at:%Y/%m/%d}/{uuid4()}.jpg"
        path = self.directory / key
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(jpeg)
        return StoredImage(key=key, sha256=hashlib.sha256(jpeg).hexdigest(), bytes=len(jpeg))

    def get(self, key: str) -> bytes:
        return (self.directory / key).read_bytes()
