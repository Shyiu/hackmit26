from __future__ import annotations

from dataclasses import dataclass

from ..config import Settings
from .base import FaceDetector, FaceEmbedder, ObjectDetector, VLMVerifier
from .mock import MockDetector, MockFaceDetector, MockFaceEmbedder, MockVLM


@dataclass
class Adapters:
    detector: ObjectDetector
    face_detector: FaceDetector
    face_embedder: FaceEmbedder
    vlm: VLMVerifier | None


def build_adapters(settings: Settings) -> Adapters:
    if settings.DETECTOR == "mock":
        detector = MockDetector()
    elif settings.DETECTOR == "dfine":
        from .dfine import DFineDetector

        detector = DFineDetector(settings.DFINE_MODEL_ID, settings.DETECTOR_DEVICE)
    elif settings.DETECTOR == "yoloe":
        from .yoloe import YOLOEDetector

        detector = YOLOEDetector(settings.YOLOE_MODEL, settings.DETECTOR_DEVICE)
    else:
        raise ValueError(f"unsupported DETECTOR={settings.DETECTOR}")

    if settings.FACE_DETECTOR == "mock" and settings.FACE_EMBEDDER == "mock":
        face_detector, face_embedder = MockFaceDetector(), MockFaceEmbedder()
    elif settings.FACE_DETECTOR == "insightface" or settings.FACE_EMBEDDER == "insightface":
        from .insightface_adapter import InsightFaceAdapter

        shared = InsightFaceAdapter(settings.INSIGHTFACE_MODEL)
        face_detector = shared
        face_embedder = shared
    else:
        raise ValueError("unsupported face adapter configuration")

    if settings.VLM == "mock":
        vlm = MockVLM()
    elif settings.VLM == "openai":
        from .openai_vlm import OpenAIVLM

        vlm = OpenAIVLM(settings)
    elif settings.VLM == "off":
        vlm = None
    else:
        raise ValueError(f"unsupported VLM={settings.VLM}")
    return Adapters(
        detector=detector, face_detector=face_detector, face_embedder=face_embedder, vlm=vlm
    )
