import json

import httpx
from test_safety import settings

from app.safety.adapters.openai_vlm import OpenAIVLM
from app.safety.vlm import validate_vlm_output


def payload(*, caption="A frame.", confirmations=None, observable_evidence=None):
    return json.dumps(
        {
            "caption": caption,
            "confirmations": confirmations or [],
            "confidence": 0.8,
            "observable_evidence": observable_evidence or [caption],
        }
    )


def test_blocklist_rejects_caption_and_evidence():
    for phrase in ("about to attack", "call 911", "intends"):
        result = validate_vlm_output(
            payload(caption="A frame.", observable_evidence=[phrase]), ["weapon_visible"]
        )
        assert result.status == "failed"
        assert result.confirmations == []


def test_missing_and_explicit_false_confirmations_have_distinct_states():
    missing = validate_vlm_output(payload(confirmations=[]), ["weapon_visible"])
    assert missing.status == "rejected"
    assert missing.confirmations == []
    dropped = validate_vlm_output(
        payload(confirmations=[{"event_type": "unknown_face", "confirmed": True, "evidence": "face"}]),
        ["weapon_visible"],
    )
    assert dropped.confirmations == []
    rejected = validate_vlm_output(
        payload(
            confirmations=[{"event_type": "weapon_visible", "confirmed": False, "evidence": "not visible"}]
        ),
        ["weapon_visible"],
    )
    assert rejected.status == "rejected"
    assert rejected.confirmations[0].confirmed is False


def test_malformed_json_fails():
    assert validate_vlm_output("{", ["weapon_visible"]).status == "failed"


def test_openai_request_uses_schema_reasoning_and_image_mime():
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        seen.append(body)
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "content": payload(
                                confirmations=[
                                    {
                                        "event_type": "weapon_visible",
                                        "confirmed": True,
                                        "evidence": "knife",
                                    }
                                ]
                            )
                        }
                    }
                ]
            },
        )

    client = httpx.Client(transport=httpx.MockTransport(handler))
    adapter = OpenAIVLM(settings(vlm_reasoning_effort="none"), client=client)
    adapter.verify(b"\xff\xd8\xffimage", ["weapon_visible"])
    jpeg_body = seen[-1]
    assert jpeg_body["model"] == "gpt-5.6-luna"
    assert jpeg_body["reasoning_effort"] == "none"
    assert jpeg_body["response_format"]["type"] == "json_schema"
    assert jpeg_body["response_format"]["json_schema"]["strict"] is True
    assert "data:image/jpeg" in jpeg_body["messages"][1]["content"][1]["image_url"]["url"]
    adapter.verify(b"\x89PNG\r\nimage", ["weapon_visible"])
    assert "data:image/png" in seen[-1]["messages"][1]["content"][1]["image_url"]["url"]
    client.close()
