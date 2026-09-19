from __future__ import annotations

from dataclasses import dataclass

from ...config import Settings
from .mock import MockDetector, MockFaceDetector, MockFaceEmbedder, MockVLM
from .protocols import FaceDetector, FaceEmbedder, ObjectDetector, VLMVerifier


@dataclass
class Adapters:
    detector: ObjectDetector
    face_detector: FaceDetector
    face_embedder: FaceEmbedder
    vlm: VLMVerifier | None


def build_adapters(settings: Settings) -> Adapters:
    if settings.safety_detector == "mock":
        detector = MockDetector(settings=settings)
    elif settings.safety_detector == "dfine":
        from .dfine import DFineDetector

        detector = DFineDetector(settings.dfine_model_id, settings.safety_detector_device)
    elif settings.safety_detector == "yoloe":
        from .yoloe import YOLOEDetector

        detector = YOLOEDetector(settings.yoloe_model, settings.safety_detector_device)
    else:
        raise ValueError(f"unsupported detector={settings.safety_detector}")

    if settings.face_detector == "mock" and settings.face_embedder == "mock":
        face_detector, face_embedder = MockFaceDetector(settings=settings), MockFaceEmbedder()
    elif settings.face_detector == "insightface" or settings.face_embedder == "insightface":
        from .insightface import InsightFaceAdapter

        shared = InsightFaceAdapter(settings.insightface_model)
        face_detector = shared
        face_embedder = shared
    else:
        raise ValueError("unsupported face adapter configuration")

    if settings.vlm == "mock":
        vlm = MockVLM()
    elif settings.vlm == "openai":
        from .openai_vlm import OpenAIVLM

        vlm = OpenAIVLM(settings)
    elif settings.vlm == "off":
        vlm = None
    else:
        raise ValueError(f"unsupported vlm={settings.vlm}")
    return Adapters(detector=detector, face_detector=face_detector, face_embedder=face_embedder, vlm=vlm)
