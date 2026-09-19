from __future__ import annotations

import numpy as np

from ..schemas import BBox, Detection


class DFineDetector:
    name = "dfine"

    def __init__(self, model_id: str, device: str = "cpu"):
        try:
            from transformers import AutoImageProcessor, DFineForObjectDetection
        except ImportError as exc:
            raise ImportError(
                "DFINE requires the [dfine] extra: pip install 'vision-service[dfine]'"
            ) from exc
        self.processor = AutoImageProcessor.from_pretrained(model_id)
        self.model_obj = DFineForObjectDetection.from_pretrained(model_id).to(device)
        self.model_obj.eval()
        self.model = model_id
        self.device = device

    def detect(self, image: np.ndarray, *, filename: str = "") -> list[Detection]:
        import torch
        from PIL import Image

        pil = Image.fromarray(image)
        inputs = self.processor(images=pil, return_tensors="pt").to(self.device)
        with torch.no_grad():
            outputs = self.model_obj(**inputs)
        result = self.processor.post_process_object_detection(
            outputs, threshold=0.3, target_sizes=[pil.size[::-1]]
        )[0]
        width, height = pil.size
        return [
            Detection(
                label=self.model_obj.config.id2label[int(label)],
                raw_label=self.model_obj.config.id2label[int(label)],
                confidence=float(score),
                bbox=BBox(
                    x=float(box[0] / width),
                    y=float(box[1] / height),
                    w=float((box[2] - box[0]) / width),
                    h=float((box[3] - box[1]) / height),
                ),
                source=self.name,
            )
            for box, score, label in zip(
                result["boxes"], result["scores"], result["labels"], strict=True
            )
        ]
