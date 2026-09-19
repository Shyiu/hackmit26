from __future__ import annotations


def system_prompt() -> str:
    return (
        "Use strictly observable evidence only. Do not infer intent, emotion, or "
        "declare an emergency. "
        "Confirm only whether the listed candidate objects/events are visibly "
        "present in this single frame. "
        "Return JSON matching the requested schema: caption is one sentence of "
        "at most 200 characters; "
        "confirmations contains event_type, confirmed, and evidence; confidence is a number; "
        "observable_evidence is an array of strings."
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
