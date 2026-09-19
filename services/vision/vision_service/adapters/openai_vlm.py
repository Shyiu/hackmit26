from __future__ import annotations

import base64
import time

import httpx

from ..config import Settings
from ..schemas import VLMVerification
from ..vlm.prompt import response_schema, system_prompt
from ..vlm.validate import validate_vlm_output


class OpenAIVLM:
    name = "openai"

    def __init__(self, settings: Settings):
        self.settings = settings
        self.model = settings.VLM_MODEL

    def verify(self, image_bytes: bytes, candidate_event_types: list[str]) -> VLMVerification:
        started = time.perf_counter()
        content = [
            {
                "type": "text",
                "text": "Candidate event types: " + ", ".join(candidate_event_types),
            },
            {
                "type": "image_url",
                "image_url": {
                    "url": "data:image/jpeg;base64," + base64.b64encode(image_bytes).decode()
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
        if self.settings.VLM_REASONING_EFFORT:
            body["reasoning_effort"] = self.settings.VLM_REASONING_EFFORT
        response = httpx.post(
            f"{self.settings.VLM_BASE_URL.rstrip('/')}/chat/completions",
            headers={"Authorization": f"Bearer {self.settings.VLM_API_KEY}"},
            json=body,
            timeout=self.settings.VLM_TIMEOUT_S,
        )
        response.raise_for_status()
        payload = response.json()
        raw = payload["choices"][0]["message"]["content"]
        if isinstance(raw, list):
            raw = "".join(part.get("text", "") for part in raw)
        result = validate_vlm_output(raw, candidate_event_types)
        result.model = self.model
        result.latency_ms = (time.perf_counter() - started) * 1000
        return result
