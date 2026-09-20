from datetime import UTC, datetime, timedelta

import numpy as np
import pytest
from bson import ObjectId
from test_safety import settings

from app.safety.store import SafetyStore
from app.store import ObservationStore


@pytest.fixture
def safety_store(db, tmp_path):
    config = settings(frame_image_dir=str(tmp_path))
    return SafetyStore(db, ObservationStore(db), config)


@pytest.mark.asyncio
async def test_enrollment_hides_and_decrypts_embeddings(safety_store, db):
    patient_id = ObjectId()
    from conftest import Seed

    await Seed(db).patient(patient_id)
    vector = np.ones(512, dtype=np.float32)
    person = await safety_store.enroll_person(
        patient_id, "Alex", None, "caregiver", ["people/a.jpg"], [vector], "mock-512"
    )
    assert "faceEmbeddings" not in person
    assert np.array_equal((await safety_store.enrolled_embeddings(patient_id))[0].embeddings[0], vector)


@pytest.mark.asyncio
async def test_person_recognized_cooldown_persists_in_mongo(safety_store, db):
    from conftest import Seed

    patient_id = await Seed(db).patient()
    person_id = ObjectId()
    first = datetime.now(UTC)
    assert await safety_store.was_recently_announced(patient_id, person_id, first, 120.0) is False
    await safety_store.queue_person_recognized_notification(patient_id, person_id, "Alex", "son")
    stored = await db["notifications"].find_one({"patientId": patient_id, "personId": person_id})
    assert stored["kind"] == "person_recognized"
    # Still within the cooldown window.
    assert (
        await safety_store.was_recently_announced(patient_id, person_id, first + timedelta(seconds=30), 120.0)
        is True
    )
    # A fresh SafetyStore instance sees the same cooldown -- it's in Mongo, not process memory.
    reloaded = SafetyStore(db, ObservationStore(db), settings())
    assert (
        await reloaded.was_recently_announced(patient_id, person_id, first + timedelta(seconds=30), 120.0)
        is True
    )
    # Past the window, and for a different person, it's clear again.
    assert (
        await safety_store.was_recently_announced(
            patient_id, person_id, first + timedelta(seconds=121), 120.0
        )
        is False
    )
    assert await safety_store.was_recently_announced(patient_id, ObjectId(), first, 120.0) is False


@pytest.mark.asyncio
async def test_gallery_is_cached_until_the_wearers_people_change(safety_store, db):
    from conftest import Seed

    patient_id = await Seed(db).patient()
    other_id = await Seed(db).patient()
    vector = np.ones(512, dtype=np.float32)
    alex = await safety_store.enroll_person(
        patient_id, "Alex", "son", "caregiver", ["people/a.jpg"], [vector], "mock-512"
    )
    first = await safety_store.gallery(patient_id, "mock-512")
    assert [(person.name, person.relation) for person in first.people] == [("Alex", "son")]
    assert await safety_store.gallery(patient_id, "mock-512") is first
    # Never anyone else's enrolled set.
    assert (await safety_store.gallery(other_id, "mock-512")).people == ()

    await safety_store.enroll_person(
        patient_id, "Sam", None, "caregiver", ["people/s.jpg"], [vector], "mock-512"
    )
    assert len((await safety_store.gallery(patient_id, "mock-512")).people) == 2
    assert await safety_store.delete_person(patient_id, alex["_id"])
    assert [person.name for person in (await safety_store.gallery(patient_id, "mock-512")).people] == ["Sam"]


@pytest.mark.asyncio
async def test_a_person_enrolled_under_another_key_is_skipped(db, tmp_path):
    from conftest import Seed
    from cryptography.fernet import Fernet

    patient_id = await Seed(db).patient()
    vector = np.ones(512, dtype=np.float32)
    old = SafetyStore(
        db,
        ObservationStore(db),
        settings(frame_image_dir=str(tmp_path), face_embedding_key=Fernet.generate_key().decode()),
    )
    await old.enroll_person(patient_id, "Alex", None, "caregiver", ["people/a.jpg"], [vector], "mock-512")
    new = SafetyStore(
        db,
        ObservationStore(db),
        settings(frame_image_dir=str(tmp_path), face_embedding_key=Fernet.generate_key().decode()),
    )
    await new.enroll_person(patient_id, "Sam", None, "caregiver", ["people/s.jpg"], [vector], "mock-512")
    assert [person.name for person in await new.enrolled_embeddings(patient_id)] == ["Sam"]
