"""Keyframe storage and thumbnail helpers.

# TODO(privacy): blur faces before put() — README "Privacy and safety" requires
# it before any external (S3) upload; the mock describer keeps bytes on the host.
"""

from __future__ import annotations

import asyncio
from io import BytesIO
from typing import TYPE_CHECKING, Any, Protocol

import boto3
from botocore.exceptions import ClientError
from gridfs.asynchronous import AsyncGridFSBucket
from gridfs.errors import NoFile
from PIL import Image
from pymongo.asynchronous.database import AsyncDatabase

if TYPE_CHECKING:
    from .config import Settings


class KeyframeStore(Protocol):
    async def put(self, key: str, data: bytes, content_type: str) -> None: ...

    async def get(self, key: str) -> bytes: ...

    async def delete(self, key: str) -> None: ...


class GridFSKeyframeStore:
    def __init__(self, db: AsyncDatabase[dict[str, Any]]) -> None:
        self._db = db
        self._bucket = AsyncGridFSBucket(db, bucket_name="keyframes")

    async def put(self, key: str, data: bytes, content_type: str) -> None:
        await self._bucket.upload_from_stream(key, data, metadata={"contentType": content_type})

    async def get(self, key: str) -> bytes:
        try:
            stream = await self._bucket.open_download_stream_by_name(key)
            return await stream.read()
        except NoFile as error:
            raise KeyError(key) from error

    async def delete(self, key: str) -> None:
        async for file in self._db["keyframes.files"].find({"filename": key}, {"_id": 1}):
            await self._bucket.delete(file["_id"])


class S3KeyframeStore:
    def __init__(
        self,
        endpoint_url: str,
        bucket: str,
        access_key: str,
        secret: str,
        region: str = "us-east-1",
    ) -> None:
        self._bucket = bucket
        self._client = boto3.client(
            "s3",
            endpoint_url=endpoint_url,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret,
            region_name=region,
        )

    async def put(self, key: str, data: bytes, content_type: str) -> None:
        await asyncio.to_thread(
            self._client.put_object,
            Bucket=self._bucket,
            Key=key,
            Body=data,
            ContentType=content_type,
        )

    async def get(self, key: str) -> bytes:
        try:
            response = await asyncio.to_thread(self._client.get_object, Bucket=self._bucket, Key=key)
        except ClientError as error:
            if error.response.get("Error", {}).get("Code") in {"NoSuchKey", "404"}:
                raise KeyError(key) from error
            raise
        body = response["Body"]
        try:
            return await asyncio.to_thread(body.read)
        finally:
            await asyncio.to_thread(body.close)

    async def delete(self, key: str) -> None:
        await asyncio.to_thread(self._client.delete_object, Bucket=self._bucket, Key=key)


def make_thumb(jpeg: bytes, width: int = 320) -> bytes:
    with Image.open(BytesIO(jpeg)) as image:
        image = image.convert("RGB")
        image.thumbnail((width, width * 4))
        output = BytesIO()
        image.save(output, format="JPEG", quality=80)
        return output.getvalue()


def thumb_key(key: str) -> str:
    return f"{key[:-4]}.thumb.jpg" if key.endswith(".jpg") else f"{key}.thumb.jpg"


def build_keyframe_store(settings: Settings, db: AsyncDatabase[dict[str, Any]]) -> KeyframeStore:
    if (
        settings.s3_endpoint
        and settings.s3_bucket
        and settings.s3_access_key_id
        and settings.s3_secret_access_key
    ):
        return S3KeyframeStore(
            settings.s3_endpoint,
            settings.s3_bucket,
            settings.s3_access_key_id,
            settings.s3_secret_access_key,
            settings.s3_region,
        )
    return GridFSKeyframeStore(db)
