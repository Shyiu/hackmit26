"""Time the face pass on one image, across the settings that trade accuracy for speed.

uv run python scripts/bench_faces.py                       # InsightFace's bundled sample photo
uv run python scripts/bench_faces.py me.jpg --width 640    # your own, scaled like a phone frame
uv run python scripts/bench_faces.py --models buffalo_l,buffalo_s --sizes 640,320 --providers auto
"""

from __future__ import annotations

import argparse
import statistics
import sys
import time
from io import BytesIO
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.safety.adapters.insightface import InsightFaceAdapter, resolve_providers  # noqa: E402


def _load(path: str | None, width: int) -> np.ndarray:
    if path is None:
        from insightface.data import get_image

        image = Image.fromarray(get_image("t1")[:, :, ::-1])
    else:
        image = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    if width and image.width != width:
        image = image.resize((width, round(image.height * width / image.width)))
    return np.asarray(image)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    parser.add_argument("image", nargs="?", help="a photo with faces in it; defaults to a bundled sample")
    parser.add_argument("--width", type=int, default=640, help="scale the image to this width; 0 keeps it")
    parser.add_argument("--models", default="buffalo_l,buffalo_s")
    parser.add_argument("--sizes", default="640,320")
    parser.add_argument("--providers", default="CPUExecutionProvider,auto", help="sets, split on commas")
    parser.add_argument("--runs", type=int, default=20)
    args = parser.parse_args()

    array = _load(args.image, args.width)
    buffer = BytesIO()
    Image.fromarray(array).save(buffer, format="JPEG", quality=80)
    jpeg = buffer.getvalue()
    print(f"image {array.shape[1]}x{array.shape[0]}, {len(jpeg) // 1024} KB as JPEG\n")
    print(
        f"{'model':<10} {'det':>4} {'providers':<24} {'faces':>5} {'decode':>7} {'p50 ms':>7} {'p95 ms':>7}"
    )

    seen: set[tuple[str, ...]] = set()
    for providers in args.providers.split(","):
        resolved = tuple(resolve_providers(providers))
        if resolved in seen:
            continue
        seen.add(resolved)
        label = "+".join(item.removesuffix("ExecutionProvider") for item in resolved)
        for model in args.models.split(","):
            for size in (int(item) for item in args.sizes.split(",")):
                adapter = InsightFaceAdapter(model, providers=providers, det_size=size)
                decode, total = [], []
                faces = 0
                for _ in range(args.runs):
                    started = time.perf_counter()
                    frame = np.asarray(Image.open(BytesIO(jpeg)).convert("RGB"))
                    decoded = time.perf_counter()
                    faces = len(adapter.analyze(frame))
                    total.append((time.perf_counter() - started) * 1000)
                    decode.append((decoded - started) * 1000)
                total.sort()
                print(
                    f"{model:<10} {size:>4} {label:<24} {faces:>5} {statistics.median(decode):>7.1f} "
                    f"{statistics.median(total):>7.1f} {total[int(len(total) * 0.95) - 1]:>7.1f}"
                )


if __name__ == "__main__":
    main()
