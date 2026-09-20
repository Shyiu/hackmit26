"""Keyframe storage backends and thumbnail generation."""

from __future__ import annotations

from io import BytesIO

from PIL import Image

from app.keyframes import GridFSKeyframeStore, make_thumb, thumb_key


async def test_gridfs_round_trip_and_delete(db):
    store = GridFSKeyframeStore(db)
    key = "patient/sighting/1.jpg"
    data = b"jpeg bytes"

    await store.put(key, data, "image/jpeg")
    assert await store.get(key) == data
    await store.delete(key)

    try:
        await store.get(key)
    except KeyError as error:
        assert error.args == (key,)
    else:
        raise AssertionError("deleted keyframe remained readable")


async def test_thumbnail_is_320_pixels_wide(db):
    image = Image.new("RGB", (1200, 600), "white")
    source = BytesIO()
    image.save(source, format="JPEG")

    thumbnail = make_thumb(source.getvalue())
    with Image.open(BytesIO(thumbnail)) as result:
        assert result.width == 320
        assert result.height == 160

    assert thumb_key("a/b.jpg") == "a/b.thumb.jpg"
