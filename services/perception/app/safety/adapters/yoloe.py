from __future__ import annotations

import numpy as np

from ..models import BBox, Detection


class YOLOEDetector:
    """YOLOE uses Ultralytics, which is AGPL-3.0 licensed."""

    name = "yoloe"

    def __init__(self, model_path: str, device: str = "cpu"):
        try:
            from ultralytics import YOLOE
            from ultralytics.models.yolo.yoloe import get_text_pe
        except ImportError as exc:
            raise ImportError(
                "YOLOE requires the [yoloe] extra: pip install 'vision-service[yoloe]'"
            ) from exc
        self.model_obj = YOLOE(model_path)
        self.device = device
        self.get_text_pe = get_text_pe
        self.model = model_path

    def detect(
        self, image: np.ndarray, prompts: list[str] | None = None, *, filename: str = ""
    ) -> list[Detection]:
        names = prompts or ["knife", "pill bottle", "stove", "firearm", "hazard object"]
        self.model_obj.set_classes(names, self.get_text_pe(names))
        result = self.model_obj.predict(image, device=self.device, verbose=False)[0]
        height, width = image.shape[:2]
        return [
            Detection(
                label=names[int(cls)],
                confidence=float(conf),
                bbox=BBox(
                    x=float(box[0] / width),
                    y=float(box[1] / height),
                    w=float((box[2] - box[0]) / width),
                    h=float((box[3] - box[1]) / height),
                ),
                source=self.name,
            )
            for box, conf, cls in zip(result.boxes.xyxy, result.boxes.conf, result.boxes.cls, strict=True)
        ]
