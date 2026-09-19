from __future__ import annotations

import json

from ..schemas import VLMConfirmation, VLMVerification

# Guardrail phrases, not a classifier: reject unsafe inferred intent or emergency claims.
BLOCKLIST = (
    "intends",
    "about to attack",
    "emergency",
    "call 911",
    "is going to",
    "threatening",
)


def validate_vlm_output(raw_text: str, candidate_event_types: list[str]) -> VLMVerification:
    try:
        payload = json.loads(raw_text)
        caption = str(payload.get("caption", ""))[:200]
        evidence = [str(item) for item in payload.get("observable_evidence", [])]
        all_text = " ".join([caption, *evidence]).lower()
        if any(phrase in all_text for phrase in BLOCKLIST):
            return VLMVerification(
                caption=caption,
                confirmations=[
                    VLMConfirmation(event_type=event, confirmed=False, evidence="")
                    for event in candidate_event_types
                ],
                confidence=0,
                observable_evidence=[],
                model="openai",
                raw_error="blocked unsafe inference or emergency phrase",
            )
        confirmations = []
        for item in payload.get("confirmations", []):
            if item.get("event_type") in candidate_event_types:
                confirmations.append(
                    VLMConfirmation(
                        event_type=item["event_type"],
                        confirmed=bool(item.get("confirmed")),
                        evidence=str(item.get("evidence", "")),
                    )
                )
        return VLMVerification(
            caption=caption,
            confirmations=confirmations,
            confidence=max(0, min(1, float(payload.get("confidence", 0)))),
            observable_evidence=evidence,
            model="openai",
        )
    except (TypeError, ValueError, json.JSONDecodeError, KeyError) as exc:
        return VLMVerification(
            caption="",
            confirmations=[
                VLMConfirmation(event_type=event, confirmed=False, evidence="")
                for event in candidate_event_types
            ],
            confidence=0,
            observable_evidence=[],
            model="openai",
            raw_error=f"invalid VLM output: {exc}",
        )
