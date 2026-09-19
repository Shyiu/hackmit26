from pathlib import Path

from scripts.evaluate import evaluate


def test_evaluate_fixture_shape():
    fixture = Path(__file__).parent / "fixtures" / "eval_sample"
    result = evaluate(str(fixture), str(fixture / "labels.json"))
    assert result["overall"]["precision"] == 1.0
    assert "timing_ms" in result
