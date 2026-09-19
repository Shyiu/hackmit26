"""The detector seam: the Detector protocol, NullDetector, and the YOLOE-26 detector.

A detector gets one JPEG and the wearer's prompt list and returns detections
for tracked items, or None when the frame is unusable (blurry). Tracking across
frames and the confirmation rule live in app/tracker.py.
"""

from __future__ import annotations

import io
import logging
import threading
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from .config import Settings
from .protocol import Detection, FrameHeader

log = logging.getLogger("perception.detector")


@dataclass(frozen=True, slots=True)
class Prompt:
    """One open-vocabulary class name and the tracked item it stands for."""

    item_id: str
    label: str
    text: str


Prompts = tuple[Prompt, ...]


class Detector(Protocol):
    name: str

    def detect(self, jpeg: bytes, header: FrameHeader, prompts: Prompts) -> list[Detection] | None:
        """Tracked items in one frame, or None if the frame is unusable. Runs on a worker thread."""
        ...


class NullDetector:
    """Finds nothing. Lets the socket, the HUD and the store run end to end before the model exists."""

    name = "null"

    def detect(self, jpeg: bytes, header: FrameHeader, prompts: Prompts) -> list[Detection] | None:
        return []


class YoloeModel(Protocol):
    """The slice of ultralytics.YOLOE the detector uses. Tests stub it."""

    def set_classes(self, names: list[str]) -> None: ...

    def predict(self, source: Any, **kwargs: Any) -> Sequence[Any]: ...


def decode_jpeg(jpeg: bytes) -> Any:
    """A JPEG as an HxWx3 BGR uint8 array, the layout Ultralytics reads a numpy source as."""
    import numpy as np
    from PIL import Image

    with Image.open(io.BytesIO(jpeg)) as image:
        rgb = np.asarray(image.convert("RGB"))
    return rgb[:, :, ::-1]


def laplacian_variance(image: Any) -> float:
    """Sharpness of a BGR image. Body-worn video blurs on every step; low variance means a smeared frame."""
    import numpy as np

    gray = image.mean(axis=2, dtype=np.float32)
    if gray.shape[0] < 3 or gray.shape[1] < 3:
        return 0.0
    centre = gray[1:-1, 1:-1]
    laplacian = 4 * centre - gray[:-2, 1:-1] - gray[2:, 1:-1] - gray[1:-1, :-2] - gray[1:-1, 2:]
    return float(laplacian.var())


class YoloeDetector:
    """Ultralytics YOLOE-26 with the wearer's item prompts as its class names.

    One model serves every connection, so inference takes a lock. Setting the
    classes runs the text encoder, which is slow, so it happens only when the
    prompt list changes.
    """

    name = "yoloe"

    def __init__(
        self,
        model: YoloeModel,
        *,
        confidence: float = 0.25,
        image_size: int = 640,
        device: str | None = None,
        blur_threshold: float = 40.0,
        decode: Callable[[bytes], Any] = decode_jpeg,
        sharpness: Callable[[Any], float] = laplacian_variance,
    ) -> None:
        self._model = model
        self._confidence = confidence
        self._image_size = image_size
        self._device = device
        self._blur_threshold = blur_threshold
        self._decode = decode
        self._sharpness = sharpness
        self._lock = threading.Lock()
        self._classes: tuple[str, ...] | None = None

    @classmethod
    def load(cls, settings: Settings) -> YoloeDetector:
        from ultralytics import YOLOE

        return cls(
            YOLOE(settings.yoloe_model),
            confidence=settings.detector_confidence,
            image_size=settings.yoloe_image_size,
            device=settings.yoloe_device,
            blur_threshold=settings.blur_threshold,
        )

    def warm_up(self, prompts: Prompts) -> None:
        """Runs the text encoder ahead of the first frame."""
        with self._lock:
            self._set_classes(prompts)

    def detect(self, jpeg: bytes, header: FrameHeader, prompts: Prompts) -> list[Detection] | None:
        if not prompts:
            return []
        image = self._decode(jpeg)
        if self._blur_threshold > 0 and self._sharpness(image) < self._blur_threshold:
            return None
        with self._lock:
            self._set_classes(prompts)
            results = self._model.predict(
                image,
                conf=self._confidence,
                imgsz=self._image_size,
                device=self._device,
                verbose=False,
            )
        return self._to_detections(results, prompts)

    def _set_classes(self, prompts: Prompts) -> None:
        classes = tuple(prompt.text for prompt in prompts)
        if classes != self._classes:
            self._model.set_classes(list(classes))
            self._classes = classes

    @staticmethod
    def _to_detections(results: Sequence[Any], prompts: Prompts) -> list[Detection]:
        detections: list[Detection] = []
        for result in results:
            boxes = result.boxes
            if boxes is None:
                continue
            for (cx, cy, w, h), confidence, class_index in zip(
                boxes.xywhn.tolist(), boxes.conf.tolist(), boxes.cls.tolist(), strict=True
            ):
                index = int(class_index)
                if not 0 <= index < len(prompts):
                    continue
                prompt = prompts[index]
                x = min(max(cx - w / 2, 0.0), 1.0)
                y = min(max(cy - h / 2, 0.0), 1.0)
                detections.append(
                    Detection(
                        itemId=prompt.item_id,
                        label=prompt.label,
                        bbox=(x, y, min(w, 1.0 - x), min(h, 1.0 - y)),
                        confidence=min(max(float(confidence), 0.0), 1.0),
                    )
                )
        return detections


def yoloe_available(settings: Settings) -> bool:
    """True when ultralytics is installed and the checkpoint is already on disk."""
    try:
        import ultralytics  # noqa: F401
    except ImportError:
        return False
    return Path(settings.yoloe_model).is_file()


def build_detector(settings: Settings) -> Detector:
    """The detector the settings ask for. "auto" never downloads anything."""
    if settings.detector == "null":
        return NullDetector()
    if settings.detector == "auto" and not yoloe_available(settings):
        log.info("YOLOE assets not found at %s; running NullDetector", settings.yoloe_model)
        return NullDetector()
    return YoloeDetector.load(settings)
