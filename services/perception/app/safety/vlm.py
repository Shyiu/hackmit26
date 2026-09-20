from __future__ import annotations

import json

from .models import VlmConfirmation, VlmResult

BLOCKLIST = (
    "intends",
    "about to attack",
    "emergency",
    "call 911",
    "is going to",
    "threatening",
)


def system_prompt() -> str:
    return (
        "Use strictly observable evidence only. Do not infer intent, emotion, or declare an emergency. "
        "Confirm only whether the listed candidate objects/events are visibly present in this single frame. "
        "Return JSON with a one-sentence caption no longer than 200 characters, confirmations with "
        "event_type, confirmed, and evidence, a confidence number, and observable_evidence."
    )


def response_schema() -> dict:
    return {
        "name": "vision_verification",
        "strict": True,
        "schema": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "caption": {"type": "string"},
                "confirmations": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        "properties": {
                            "event_type": {"type": "string"},
                            "confirmed": {"type": "boolean"},
                            "evidence": {"type": "string"},
                        },
                        "required": ["event_type", "confirmed", "evidence"],
                    },
                },
                "confidence": {"type": "number"},
                "observable_evidence": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["caption", "confirmations", "confidence", "observable_evidence"],
        },
    }


def validate_vlm_output(raw_text: str, candidate_event_types: list[str]) -> VlmResult:
    try:
        payload = json.loads(raw_text)
        caption = str(payload.get("caption", ""))[:200]
        evidence = [str(item)[:300] for item in payload.get("observable_evidence", [])][:20]
        all_text = " ".join([caption, *evidence]).lower()
        if any(phrase in all_text for phrase in BLOCKLIST):
            return VlmResult(
                caption=caption,
                confidence=0,
                model="openai",
                status="failed",
                error="blocked unsafe inference or emergency phrase",
            )
        confirmations = [
            VlmConfirmation(
                event_type=item["event_type"],
                confirmed=bool(item.get("confirmed")),
                evidence=str(item.get("evidence", ""))[:300],
            )
            for item in payload.get("confirmations", [])
            if item.get("event_type") in candidate_event_types
        ]
        return VlmResult(
            caption=caption,
            confirmations=confirmations,
            confidence=max(0, min(1, float(payload.get("confidence", 0)))),
            observable_evidence=evidence,
            model="openai",
            status="confirmed" if any(item.confirmed for item in confirmations) else "rejected",
        )
    except (TypeError, ValueError, json.JSONDecodeError, KeyError) as exc:
        return VlmResult(
            confidence=0,
            model="openai",
            status="failed",
            error=f"invalid VLM output: {exc}",
        )
