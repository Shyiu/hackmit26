from __future__ import annotations

import warnings

import numpy as np

from ..models import BBox, FaceBox


def _iou(a: BBox, b: BBox) -> float:
    ax2, ay2, bx2, by2 = a.x + a.w, a.y + a.h, b.x + b.w, b.y + b.h
    ix = max(0, min(ax2, bx2) - max(a.x, b.x))
    iy = max(0, min(ay2, by2) - max(a.y, b.y))
    inter = ix * iy
    return inter / (a.w * a.h + b.w * b.h - inter or 1)


def resolve_providers(requested: str) -> list[str]:
    """`auto` takes CoreML or CUDA when onnxruntime was built with one, and always ends on CPU."""
    import onnxruntime

    available = onnxruntime.get_available_providers()
    if requested.strip().lower() == "auto":
        wanted = ["CUDAExecutionProvider", "CoreMLExecutionProvider"]
    else:
        wanted = [item.strip() for item in requested.split(",") if item.strip()]
    providers = [item for item in wanted if item in available and item != "CPUExecutionProvider"]
    return [*providers, "CPUExecutionProvider"]


class InsightFaceAdapter:
    name = "insightface"

    def __init__(
        self,
        model_name: str = "buffalo_l",
        *,
        providers: str = "auto",
        det_size: int = 640,
        max_faces: int = 4,
        warmup: bool = True,
    ):
        try:
            from insightface.app import FaceAnalysis
        except ImportError as exc:
            raise ImportError("InsightFace requires the faces extra: uv sync --extra faces") from exc
        # insightface calls a deprecated scikit-image method once per face, and says so each time.
        warnings.filterwarnings("ignore", category=FutureWarning, module=r"insightface\..*")
        # Stored with every enrollment, so a gallery built by one model is never scored by another.
        self.model = f"insightface-{model_name}"
        self.max_faces = max_faces
        self._model_name = model_name
        self._providers = providers
        # The model pack also ships 3D landmarks, 106-point landmarks, and age/gender. Matching
        # needs none of them, and each is a full forward pass per face.
        self.analysis = FaceAnalysis(
            name=model_name,
            allowed_modules=["detection", "recognition"],
            providers=resolve_providers(providers),
        )
        self.analysis.prepare(ctx_id=0, det_size=(det_size, det_size))
        if warmup:
            # The first inference pays for graph optimization and allocation. Pay it at boot,
            # not on the first frame with a face in it.
            self.analysis.get(np.zeros((det_size, det_size, 3), dtype=np.uint8))
        # A fixed det_size is a deliberate latency trade for the live frame path, but it disables
        # insightface's own multi-scale fallback (it tries 128x128 then 640x640 only when det_size
        # is left unset), which misses faces that don't happen to survive a straight 640x640 resize
        # -- true of most ordinary close-up photos. Enrollment is rare, not latency-sensitive, and
        # its photos have unpredictable framing, so it gets its own instance with that fallback on.
        self._enroll_analysis: FaceAnalysis | None = None

    def _enrollment_analysis(self):
        if self._enroll_analysis is None:
            from insightface.app import FaceAnalysis

            analysis = FaceAnalysis(
                name=self._model_name,
                allowed_modules=["detection", "recognition"],
                providers=resolve_providers(self._providers),
            )
            analysis.prepare(ctx_id=0)  # det_size left unset: insightface's own multi-scale fallback
            self._enroll_analysis = analysis
        return self._enroll_analysis

    def _faces(self, image: np.ndarray, *, for_enrollment: bool = False):
        # The pipeline decodes to RGB. InsightFace is trained on cv2's BGR.
        bgr = np.ascontiguousarray(image[:, :, ::-1])
        if for_enrollment:
            return self._enrollment_analysis().get(bgr, max_num=self.max_faces)
        return self.analysis.get(bgr, max_num=self.max_faces)

    def analyze(
        self, image: np.ndarray, *, filename: str = "", for_enrollment: bool = False
    ) -> list[tuple[FaceBox, np.ndarray]]:
        """Detection and embedding in one pass. `detect` then `embed` runs the detector twice."""
        faces = self._faces(image, for_enrollment=for_enrollment)
        return [(self._to_face_box(face, image.shape), self._embedding(face)) for face in faces]

    def detect(self, image: np.ndarray, *, filename: str = "", for_enrollment: bool = False) -> list[FaceBox]:
        return [box for box, _ in self.analyze(image, filename=filename, for_enrollment=for_enrollment)]

    def embed(
        self, image: np.ndarray, faces: list[FaceBox], *, for_enrollment: bool = False
    ) -> list[np.ndarray]:
        found = self.analyze(image, for_enrollment=for_enrollment)
        if not found:
            raise ValueError("no face found to embed")
        return [max(found, key=lambda item: _iou(face.bbox, item[0].bbox))[1] for face in faces]

    @staticmethod
    def _embedding(face) -> np.ndarray:
        embedding = np.asarray(face.normed_embedding, dtype=np.float32)
        return embedding / (np.linalg.norm(embedding) or 1)

    @staticmethod
    def _to_face_box(face, shape) -> FaceBox:
        height, width = shape[:2]
        x1, y1, x2, y2 = (float(value) for value in face.bbox)
        # SCRFD boxes can run past the frame edge, and BBox only takes 0 to 1.
        x1, x2 = max(0.0, min(x1, width)), max(0.0, min(x2, width))
        y1, y2 = max(0.0, min(y1, height)), max(0.0, min(y2, height))
        return FaceBox(
            bbox=BBox(x=x1 / width, y=y1 / height, w=(x2 - x1) / width, h=(y2 - y1) / height),
            confidence=min(1.0, max(0.0, float(face.det_score))),
            landmarks=face.kps.tolist() if getattr(face, "kps", None) is not None else None,
        )
