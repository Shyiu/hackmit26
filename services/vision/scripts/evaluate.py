from __future__ import annotations

import argparse
import json
import statistics
import time
from pathlib import Path

from PIL import Image

from vision_service.adapters.mock import MockDetector
from vision_service.adapters.registry import build_adapters
from vision_service.config import Settings
from vision_service.rules import evaluate_rules
from vision_service.schemas import DetectorResult, FaceResult


def evaluate(directory: str, labels_path: str | None = None, detector_name: str = "mock") -> dict:
    root = Path(directory)
    labels = json.loads(Path(labels_path).read_text()) if labels_path else {}
    settings = Settings(DETECTOR=detector_name, VLM="off")
    detector = MockDetector() if detector_name == "mock" else build_adapters(settings).detector
    per_category: dict[str, dict[str, int]] = {}
    timings = []
    for path in sorted(root.iterdir()):
        if path.suffix.lower() not in {".png", ".jpg", ".jpeg", ".webp"}:
            continue
        started = time.perf_counter()
        image = __import__("numpy").asarray(Image.open(path).convert("RGB"))
        detections = detector.detect(image, filename=path.name)
        result = DetectorResult(adapter=detector.name, model=detector.model, detections=detections)
        predicted = {
            candidate.category
            for candidate in evaluate_rules(result, FaceResult(adapter="mock"), settings)
        }
        expected = set(labels.get(path.name, []))
        for category in expected | predicted:
            metrics = per_category.setdefault(category, {"tp": 0, "fp": 0, "fn": 0})
            if category in expected and category in predicted:
                metrics["tp"] += 1
            elif category in predicted:
                metrics["fp"] += 1
            else:
                metrics["fn"] += 1
        timings.append((time.perf_counter() - started) * 1000)

    def ratio(n, d):
        return n / d if d else 1.0

    for metrics in per_category.values():
        metrics["precision"] = ratio(metrics["tp"], metrics["tp"] + metrics["fp"])
        metrics["recall"] = ratio(metrics["tp"], metrics["tp"] + metrics["fn"])
    totals = {key: sum(item[key] for item in per_category.values()) for key in ("tp", "fp", "fn")}
    result = {
        "categories": per_category,
        "overall": {
            **totals,
            "precision": ratio(totals["tp"], totals["tp"] + totals["fp"]),
            "recall": ratio(totals["tp"], totals["tp"] + totals["fn"]),
            "false_positives": totals["fp"],
        },
        "timing_ms": {
            "count": len(timings),
            "average": statistics.mean(timings) if timings else 0,
            "p50": statistics.median(timings) if timings else 0,
            "p95": sorted(timings)[max(0, int(len(timings) * 0.95) - 1)] if timings else 0,
        },
    }
    return result


def main(argv: list[str] | None = None) -> dict:
    parser = argparse.ArgumentParser()
    parser.add_argument("directory")
    parser.add_argument("--labels")
    parser.add_argument("--detector", default="mock", choices=["mock", "dfine", "yoloe"])
    parser.add_argument("--json", dest="json_path")
    args = parser.parse_args(argv)
    result = evaluate(args.directory, args.labels, args.detector)
    print(json.dumps(result, indent=2))
    if args.json_path:
        Path(args.json_path).write_text(json.dumps(result, indent=2) + "\n")
    return result


if __name__ == "__main__":
    main()
