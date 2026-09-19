from __future__ import annotations

import hashlib
import mimetypes
from datetime import datetime
from pathlib import Path
from uuid import uuid4

from . import StoredImage


class LocalDiskImageStore:
    def __init__(self, directory: str, public_base_url: str | None = None):
        self.directory = Path(directory)
        self.public_base_url = public_base_url

    def put(self, data: bytes, *, content_type: str, suggested_name: str) -> StoredImage:
        suffix = Path(suggested_name).suffix or mimetypes.guess_extension(content_type) or ".bin"
        now = datetime.utcnow()
        key = f"{now:%Y/%m/%d}/{uuid4()}{suffix.lower()}"
        path = self.directory / key
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        url = (
            f"{self.public_base_url.rstrip('/')}/{key}"
            if self.public_base_url
            else path.resolve().as_uri()
        )
        return StoredImage(
            key=key,
            url=url,
            store="local",
            sha256=hashlib.sha256(data).hexdigest(),
            bytes=len(data),
        )

    def get(self, key: str) -> bytes:
        return (self.directory / key).read_bytes()


class GridFSImageStore:
    def __init__(self, db, public_base_url: str | None = None):
        import gridfs

        self.fs = gridfs.GridFS(db)
        self.public_base_url = public_base_url

    def put(self, data: bytes, *, content_type: str, suggested_name: str) -> StoredImage:
        import hashlib

        key = str(self.fs.put(data, contentType=content_type, filename=suggested_name))
        url = (
            f"{self.public_base_url.rstrip('/')}/{key}"
            if self.public_base_url
            else f"gridfs://{key}"
        )
        return StoredImage(
            key=key,
            url=url,
            store="gridfs",
            sha256=hashlib.sha256(data).hexdigest(),
            bytes=len(data),
        )

    def get(self, key: str) -> bytes:
        from bson import ObjectId

        return self.fs.get(ObjectId(key)).read()
