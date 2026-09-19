import pytest

from vision_service.storage.images import GridFSImageStore, LocalDiskImageStore


def test_local_store_roundtrip(tmp_path):
    store = LocalDiskImageStore(str(tmp_path))
    image = store.put(b"hello", content_type="image/png", suggested_name="x.png")
    assert store.get(image.key) == b"hello"
    assert image.sha256


def test_gridfs_roundtrip():
    mongomock = pytest.importorskip("mongomock")
    try:
        import mongomock.gridfs

        mongomock.gridfs.enable_gridfs_integration()
        store = GridFSImageStore(mongomock.MongoClient().db)
        image = store.put(b"hello", content_type="image/png", suggested_name="x.png")
        assert store.get(image.key) == b"hello"
    except (ImportError, NotImplementedError) as exc:
        pytest.skip(f"mongomock GridFS unavailable: {exc}")
