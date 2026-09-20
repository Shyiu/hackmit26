"""Turns a sighting's keyframe into a location description. PLAN.md "Description job".

Structured output validates shape, not truth: the model is told to say "unknown"
rather than infer a room or relation it can't see, and `DescriptionResult`
already turns a literal "unknown" room into no room at all.
"""

from __future__ import annotations

import base64
import json
from typing import Protocol

import httpx

from .config import Settings
from .store import BBox, DescriptionResult


def image_media_type(image_bytes: bytes) -> str:
    if image_bytes.startswith(b"\x89PNG"):
        return "image/png"
    if image_bytes.startswith(b"\xff\xd8"):
        return "image/jpeg"
    if image_bytes.startswith(b"RIFF") and image_bytes[8:12] == b"WEBP":
        return "image/webp"
    return "image/jpeg"


SYSTEM_PROMPT = (
    "You are describing where a highlighted item is in a single frame from a body-worn camera. "
    "Use only what's visible in this frame. Name the room type if it's identifiable, the surface the "
    "item rests on or near, and its spatial relation to a nearby fixed object, for example 'next to "
    "the coffee maker'. Say whether the item looks resting, held, moving, in use, or unknown; a single "
    "still image often can't tell resting from just-placed, so prefer 'unknown' over guessing. Say "
    "'unknown' for a room, surface, or relation you can't actually see rather than inferring it. List "
    "up to five other objects visible near the item. The sentence field is not a standalone sentence: "
    "it fills the blank in 'I last saw your <item> ___', so write only the location fragment, starting "
    "with a preposition, with no leading capital letter and no trailing period, for example 'on the "
    "kitchen counter, next to the coffee maker'. Never restate what the item is or its color. Set "
    "item_visible to false if the object inside the box is clearly not the named item or you cannot "
    "see any such item there; in that case still fill the other fields with 'unknown'."
)


def _response_schema() -> dict:
    return {
        "name": "item_description",
        "strict": True,
        "schema": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "room": {"type": "string"},
                "surface": {"type": "string"},
                "relation": {"type": "string"},
                "state": {
                    "type": "string",
                    "enum": ["resting", "held", "moving", "in_use", "unknown"],
                },
                "sentence": {"type": "string"},
                "nearby_objects": {"type": "array", "items": {"type": "string"}},
                "item_visible": {"type": "boolean"},
            },
            "required": [
                "room",
                "surface",
                "relation",
                "state",
                "sentence",
                "nearby_objects",
                "item_visible",
            ],
        },
    }


class DescriptionVLM(Protocol):
    def describe(self, image: bytes, bbox: BBox, label: str | None) -> DescriptionResult: ...


class MockDescriptionVLM:
    """No OpenAI key configured. An honest description beats a made-up room."""

    def describe(self, image: bytes, bbox: BBox, label: str | None) -> DescriptionResult:
        return DescriptionResult(
            state="unknown",
            sentence=(
                f"in view of the camera (mock description of your {label or 'item'}; "
                "no vision model configured)"
            ),
        )


class OpenAIDescriptionVLM:
    name = "openai"

    def __init__(self, settings: Settings, client: httpx.Client | None = None) -> None:
        self.settings = settings
        self.model = settings.vlm_model
        self.client = client or httpx.Client()

    def describe(self, image: bytes, bbox: BBox, label: str | None) -> DescriptionResult:
        x, y, w, h = bbox
        item_text = f"The item should be: {label}. " if label else ""
        content = [
            {
                "type": "text",
                "text": (
                    f"{item_text}The item is the object inside the normalized bounding box "
                    f"x={x:.3f}, y={y:.3f}, w={w:.3f}, h={h:.3f} (origin top-left, "
                    "fractions of the frame's width and height)."
                ),
            },
            {
                "type": "image_url",
                "image_url": {
                    "url": f"data:{image_media_type(image)};base64,{base64.b64encode(image).decode()}"
                },
            },
        ]
        body: dict[str, object] = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": content},
            ],
            "response_format": {"type": "json_schema", "json_schema": _response_schema()},
        }
        if self.settings.vlm_reasoning_effort:
            body["reasoning_effort"] = self.settings.vlm_reasoning_effort
        response = self.client.post(
            f"{self.settings.vlm_base_url.rstrip('/')}/chat/completions",
            headers={"Authorization": f"Bearer {self.settings.resolved_vlm_api_key}"},
            json=body,
            timeout=self.settings.vlm_timeout_s,
        )
        response.raise_for_status()
        raw = response.json()["choices"][0]["message"]["content"]
        if isinstance(raw, list):
            raw = "".join(part.get("text", "") for part in raw)
        payload = json.loads(raw)
        if not payload["item_visible"]:
            return DescriptionResult(state="unknown", sentence="not confirmed in the frame")
        return DescriptionResult(
            room=payload.get("room"),
            surface=payload.get("surface"),
            relation=payload.get("relation"),
            state=payload.get("state", "unknown"),
            sentence=payload["sentence"],
            nearbyObjects=payload.get("nearby_objects") or [],
        )


def build_description_vlm(settings: Settings, client: httpx.Client | None = None) -> DescriptionVLM:
    """Real vision calls once an OpenAI key is configured; an honest "I don't know" otherwise."""
    if settings.resolved_vlm_api_key:
        return OpenAIDescriptionVLM(settings, client)
    return MockDescriptionVLM()
