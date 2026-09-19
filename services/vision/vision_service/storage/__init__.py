from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass
class StoredImage:
    key: str
    url: str
    store: str
    sha256: str
    bytes: int


class ImageStore(Protocol):
    def put(self, data: bytes, *, content_type: str, suggested_name: str) -> StoredImage: ...

    def get(self, key: str) -> bytes: ...
