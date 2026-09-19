from vision_service.vlm.validate import validate_vlm_output


def test_validation_drops_non_candidates():
    result = validate_vlm_output(
        (
            '{"caption":"knife visible","confirmations":[{"event_type":"other","confirmed":true,'
            '"evidence":"x"}],"confidence":2,"observable_evidence":[]}'
        ),
        ["unverified_weapon_visible"],
    )
    assert result.confirmations == []
    assert result.confidence == 1


def test_validation_blocks_inference_phrase():
    result = validate_vlm_output(
        (
            '{"caption":"Someone is threatening another person","confirmations":[],"confidence":1,'
            '"observable_evidence":[]}'
        ),
        ["unverified_weapon_visible"],
    )
    assert result.raw_error
    assert not any(item.confirmed for item in result.confirmations)


def test_validation_handles_malformed_json():
    assert validate_vlm_output("not json", ["event"]).raw_error
