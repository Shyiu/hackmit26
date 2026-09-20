"""Enroll a person from photos, through the running service so its gallery cache is dropped.

    uv run python scripts/enroll_face.py --name Andrew --consented-by Andrew me1.jpg me2.jpg
    uv run python scripts/enroll_face.py --list
    uv run python scripts/enroll_face.py --delete <person id>

Two to five photos work best: straight on, a little to each side, and one from chest height
looking up, which is the angle the worn phone sees. Each photo must show exactly one face.
The wearer defaults to the only one in the database; pass --patient when there are several.
"""

from __future__ import annotations

import argparse
import mimetypes
import sys
import time
from pathlib import Path

import httpx
from pymongo import MongoClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import Settings  # noqa: E402
from app.tokens import DeviceTokenClaims, sign_device_token  # noqa: E402


def _patient(settings: Settings, requested: str | None) -> str:
    if requested:
        return requested
    with MongoClient(settings.mongodb_uri, serverSelectionTimeoutMS=5_000) as client:
        patients = list(client[settings.mongodb_db]["patients"].find({}, {"_id": 1}).limit(2))
    if len(patients) != 1:
        sys.exit(f"found {len(patients)} wearers; pass --patient <id>")
    return str(patients[0]["_id"])


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    parser.add_argument("photos", nargs="*", type=Path)
    parser.add_argument("--name")
    parser.add_argument("--relation")
    parser.add_argument("--consented-by", help="who agreed to this person being enrolled")
    parser.add_argument("--patient", help="the wearer's _id; defaults to the only wearer")
    parser.add_argument("--url", default="http://127.0.0.1:8000")
    parser.add_argument("--list", action="store_true")
    parser.add_argument("--delete", metavar="PERSON_ID")
    args = parser.parse_args()

    settings = Settings()  # type: ignore[call-arg]  # values come from the environment
    now = int(time.time())
    claims = DeviceTokenClaims(
        v=1, pid=_patient(settings, args.patient), sub=None, scope="api", tv=0, iat=now, exp=now + 300
    )
    headers = {"authorization": f"Bearer {sign_device_token(claims, settings.device_token_secret)}"}

    with httpx.Client(base_url=args.url, headers=headers, timeout=60) as client:
        if args.list:
            for person in client.get("/people").raise_for_status().json():
                photos = len(person["referenceImageKeys"])
                print(f"{person['_id']}  {person['name']}  {person['embeddingModel']}  {photos} photos")
            return
        if args.delete:
            client.delete(f"/people/{args.delete}").raise_for_status()
            print("deleted")
            return
        if not (args.photos and args.name and args.consented_by):
            parser.error("enrolling needs --name, --consented-by, and one or more photos")
        files = [
            ("photos", (path.name, path.read_bytes(), mimetypes.guess_type(path.name)[0] or "image/jpeg"))
            for path in args.photos
        ]
        data = {"name": args.name, "consentedBy": args.consented_by}
        if args.relation:
            data["relation"] = args.relation
        response = client.post("/people", data=data, files=files)
        if response.is_error:
            sys.exit(f"{response.status_code}: {response.text}")
        person = response.json()
        print(f"enrolled {person['name']} as {person['_id']} with {person['embeddingModel']}")


if __name__ == "__main__":
    main()
