from __future__ import annotations

import argparse
import time
from datetime import datetime
from pathlib import Path

from .api import _dependencies
from .config import Settings
from .pipeline import process_image


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("path")
    parser.add_argument("--watch", action="store_true")
    args = parser.parse_args()
    settings = Settings()
    deps = _dependencies(settings)
    path = Path(args.path)
    seen: set[str] = set()
    while True:
        files = [path] if path.is_file() else sorted(path.glob("*"))
        for item in files:
            if (
                item.is_file()
                and item.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}
                and str(item) not in seen
            ):
                process_image(
                    item.read_bytes(),
                    filename=item.name,
                    device_id="worker",
                    captured_at=datetime.utcnow(),
                    adapters=deps["adapters"],
                    repos=deps["repos"],
                    image_store=deps["image_store"],
                    settings=settings,
                )
                seen.add(str(item))
        if not args.watch:
            return
        time.sleep(1)
