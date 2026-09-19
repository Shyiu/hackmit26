from __future__ import annotations

import numpy as np

from ..schemas import BBox, FaceDetection


def _iou(a: BBox, b: BBox) -> float:
    ax2, ay2, bx2, by2 = a.x + a.w, a.y + a.h, b.x + b.w, b.y + b.h
    ix = max(0, min(ax2, bx2) - max(a.x, b.x))
    iy = max(0, min(ay2, by2) - max(a.y, b.y))
    inter = ix * iy
    return inter / (a.w * a.h + b.w * b.h - inter or 1)


class InsightFaceAdapter:
    name = "insightface"
    model = "insightface"

    def __init__(self, model_name: str = "buffalo_l"):
        try:
            from insightface.app import FaceAnalysis
        except ImportError as exc:
            raise ImportError(
                "InsightFace requires the [faces] extra: pip install 'vision-service[faces]'"
            ) from exc
        self.analysis = FaceAnalysis(name=model_name, providers=["CPUExecutionProvider"])
        self.analysis.prepare(ctx_id=0)

    def _faces(self, image: np.ndarray):
        return self.analysis.get(image)

    def detect(self, image: np.ndarray, *, filename: str = "") -> list[FaceDetection]:
        height, width = image.shape[:2]
        result = []
        for face in self._faces(image):
            x1, y1, x2, y2 = face.bbox
            result.append(
                FaceDetection(
                    bbox=BBox(
                        x=float(x1 / width),
                        y=float(y1 / height),
                        w=float((x2 - x1) / width),
                        h=float((y2 - y1) / height),
                    ),
                    confidence=float(face.det_score),
                    landmarks=face.kps.tolist() if getattr(face, "kps", None) is not None else None,
                )
            )
        return result

    def embed(self, image: np.ndarray, face: FaceDetection) -> np.ndarray:
        detections = self._faces(image)
        selected = max(
            detections, key=lambda item: _iou(face.bbox, self._to_bbox(item, image.shape))
        )
        embedding = np.asarray(selected.normed_embedding, dtype=np.float32)
        return embedding / (np.linalg.norm(embedding) or 1)

    @staticmethod
    def _to_bbox(face, shape) -> BBox:
        height, width = shape[:2]
        x1, y1, x2, y2 = face.bbox
        return BBox(x=x1 / width, y=y1 / height, w=(x2 - x1) / width, h=(y2 - y1) / height)
