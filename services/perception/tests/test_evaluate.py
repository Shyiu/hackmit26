from pathlib import Path

from app.safety.evaluate import evaluate


def test_mock_evaluation_fixture_is_perfect():
    fixture = Path(__file__).parent / "fixtures" / "eval_sample"
    result = evaluate(str(fixture), str(fixture / "labels.json"))
    assert result["overall"]["precision"] == 1.0
    assert result["overall"]["recall"] == 1.0
    assert result["overall"]["false_positives"] == 0
