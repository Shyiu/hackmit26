"""YoloeDetector against a stub model: no weights, no GPU, no network."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from app.config import Settings
from app.detector import NullDetector, Prompt, YoloeDetector, build_detector
from app.protocol import FrameHeader

KEYS = Prompt("5eed0000000000000000a001", "keys", "keys")
KEYS_ALT = Prompt("5eed0000000000000000a001", "keys", "key ring")
WALLET = Prompt("5eed0000000000000000a002", "wallet", "wallet")
HEADER = FrameHeader(
    v=1, sessionId="5eed0000000000000000c001", seq=1, capturedAtMs=0, sentAtMs=0, width=64, height=48, bytes=1
)


class _Tensor:
    def __init__(self, values: list[Any]) -> None:
        self._values = values

    def tolist(self) -> list[Any]:
        return self._values


@dataclass
class _Boxes:
    xywhn: _Tensor
    conf: _Tensor
    cls: _Tensor


@dataclass
class _Result:
    boxes: _Boxes | None


@dataclass
class StubModel:
    boxes: list[tuple[tuple[float, float, float, float], float, int]] = field(default_factory=list)
    class_calls: list[list[str]] = field(default_factory=list)
    predict_calls: list[dict[str, Any]] = field(default_factory=list)

    def set_classes(self, names: list[str]) -> None:
        self.class_calls.append(names)

    def predict(self, source: Any, **kwargs: Any) -> list[_Result]:
        self.predict_calls.append(kwargs)
        return [
            _Result(
                _Boxes(
                    _Tensor([list(box) for box, _, _ in self.boxes]),
                    _Tensor([conf for _, conf, _ in self.boxes]),
                    _Tensor([float(cls) for _, _, cls in self.boxes]),
                )
            ),
            _Result(None),
        ]


def _detector(model: StubModel, sharpness: float = 100.0) -> YoloeDetector:
    return YoloeDetector(
        model, confidence=0.3, image_size=640, decode=lambda jpeg: jpeg, sharpness=lambda image: sharpness
    )


def test_boxes_come_back_as_normalized_xywh_detections_for_the_prompted_item() -> None:
    model = StubModel(
        boxes=[
            ((0.5, 0.5, 0.2, 0.4), 0.87, 0),
            ((0.9, 0.1, 0.4, 0.4), 0.6, 2),
            ((0.1, 0.1, 0.1, 0.1), 0.5, 7),
        ]
    )
    detections = _detector(model).detect(b"jpeg", HEADER, (KEYS, KEYS_ALT, WALLET))
    assert detections is not None
    assert [(d.itemId, d.label, d.confidence) for d in detections] == [
        (KEYS.item_id, "keys", 0.87),
        (WALLET.item_id, "wallet", 0.6),
    ]
    x, y, w, h = detections[0].bbox
    assert (round(x, 3), round(y, 3), w, h) == (0.4, 0.3, 0.2, 0.4)
    # A box off the right edge is clipped to the frame.
    x, y, w, h = detections[1].bbox
    assert (round(x, 3), round(y, 3), round(w, 3), round(h, 3)) == (0.7, 0.0, 0.3, 0.4)
    assert model.predict_calls == [{"conf": 0.3, "imgsz": 640, "device": None, "verbose": False}]


def test_classes_are_set_once_per_prompt_list() -> None:
    model = StubModel()
    detector = _detector(model)
    detector.detect(b"a", HEADER, (KEYS, WALLET))
    detector.detect(b"b", HEADER, (KEYS, WALLET))
    assert model.class_calls == [["keys", "wallet"]]
    detector.detect(b"c", HEADER, (KEYS, KEYS_ALT, WALLET))
    assert model.class_calls == [["keys", "wallet"], ["keys", "key ring", "wallet"]]


def test_a_blurry_frame_is_unusable_and_an_empty_prompt_list_skips_inference() -> None:
    model = StubModel(boxes=[((0.5, 0.5, 0.2, 0.2), 0.9, 0)])
    assert _detector(model, sharpness=3.0).detect(b"jpeg", HEADER, (KEYS,)) is None
    assert _detector(model).detect(b"jpeg", HEADER, ()) == []
    assert model.predict_calls == []


def test_auto_falls_back_to_the_null_detector_without_assets(tmp_path: Any) -> None:
    settings = Settings(
        mongodb_uri="mongodb://x", device_token_secret="s" * 32, yoloe_model=str(tmp_path / "no.pt")
    )
    assert isinstance(build_detector(settings), NullDetector)
    assert isinstance(build_detector(settings.model_copy(update={"detector": "null"})), NullDetector)
