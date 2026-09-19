from __future__ import annotations

import base64

import httpx

from ...config import Settings
from ..models import VlmResult
from ..vlm import response_schema, system_prompt, validate_vlm_output


def image_media_type(image_bytes: bytes) -> str:
    if image_bytes.startswith(b"\x89PNG"):
        return "image/png"
    if image_bytes.startswith(b"\xff\xd8"):
        return "image/jpeg"
    if image_bytes.startswith(b"RIFF") and image_bytes[8:12] == b"WEBP":
        return "image/webp"
    return "image/jpeg"


class OpenAIVLM:
    name = "openai"

    def __init__(self, settings: Settings, client: httpx.Client | None = None):
        self.settings = settings
        self.model = settings.vlm_model
        self.client = client or httpx.Client()

    def verify(self, image_bytes: bytes, candidate_event_types: list[str]) -> VlmResult:
        content = [
            {
                "type": "text",
                "text": "Candidate event types: " + ", ".join(candidate_event_types),
            },
            {
                "type": "image_url",
                "image_url": {
                    "url": f"data:{image_media_type(image_bytes)};base64,"
                    + base64.b64encode(image_bytes).decode()
                },
            },
        ]
        body = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system_prompt()},
                {"role": "user", "content": content},
            ],
            "response_format": {"type": "json_schema", "json_schema": response_schema()},
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
        payload = response.json()
        raw = payload["choices"][0]["message"]["content"]
        if isinstance(raw, list):
            raw = "".join(part.get("text", "") for part in raw)
        result = validate_vlm_output(raw, candidate_event_types)
        result.model = self.model
        return result
