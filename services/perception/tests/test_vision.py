import json

import httpx
from test_safety import settings

from app.vision import MockDescriptionVLM, OpenAIDescriptionVLM, build_description_vlm


def payload(**overrides):
    body = {
        "room": "kitchen",
        "surface": "counter",
        "relation": "next to the coffee maker",
        "state": "resting",
        "sentence": "on the kitchen counter, next to the coffee maker",
        "nearby_objects": ["coffee maker"],
    }
    body.update(overrides)
    return json.dumps(body)


def test_mock_vlm_is_honest_about_not_knowing():
    result = MockDescriptionVLM().describe(b"\xff\xd8\xff", (0.1, 0.1, 0.2, 0.2))
    assert result.state == "unknown"
    assert result.room is None


def test_build_description_vlm_picks_mock_without_a_key():
    # Explicit None, not just an unset override: a dev's own .env commonly has
    # OPENAI_API_KEY set for the worker, and Settings reads it same as pytest would.
    no_key = settings(openai_api_key=None, vlm_api_key=None)
    assert isinstance(build_description_vlm(no_key), MockDescriptionVLM)


def test_build_description_vlm_picks_openai_with_a_key():
    assert isinstance(build_description_vlm(settings(openai_api_key="sk-test")), OpenAIDescriptionVLM)


def test_openai_request_sends_bbox_schema_and_image_mime():
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(json.loads(request.content))
        return httpx.Response(200, json={"choices": [{"message": {"content": payload()}}]})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    adapter = OpenAIDescriptionVLM(settings(openai_api_key="sk-test", vlm_reasoning_effort="none"), client)
    result = adapter.describe(b"\xff\xd8\xffimage", (0.4, 0.3, 0.2, 0.2))

    body = seen[-1]
    assert body["model"] == "gpt-5.6-luna"
    assert body["reasoning_effort"] == "none"
    assert body["response_format"]["json_schema"]["strict"] is True
    assert "x=0.400, y=0.300, w=0.200, h=0.200" in body["messages"][1]["content"][0]["text"]
    assert "data:image/jpeg" in body["messages"][1]["content"][1]["image_url"]["url"]

    assert result.room == "kitchen"
    assert result.surface == "counter"
    assert result.relation == "next to the coffee maker"
    assert result.state == "resting"
    assert result.nearbyObjects == ["coffee maker"]
    client.close()


def test_openai_unknown_room_becomes_no_room():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"choices": [{"message": {"content": payload(room="unknown")}}]})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    adapter = OpenAIDescriptionVLM(settings(openai_api_key="sk-test"), client)
    result = adapter.describe(b"\xff\xd8\xffimage", (0.0, 0.0, 1.0, 1.0))
    assert result.room is None
    client.close()
