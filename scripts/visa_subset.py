#!/usr/bin/env python3
"""Fetch a small, deterministic subset of the VisA dataset into a local cache.

VisA (Visual Anomaly dataset, Amazon Science, CC BY 4.0) ships as one ~1.9 GB
uncompressed tar. This script streams that tar from its official URL once,
extracts ONLY the selected members of the chosen categories, downscales each to
at most 512 px on the long side and writes PNGs. It stops reading as soon as
every selected member has been seen, so the default category (`candle`, the
first one in the archive) costs roughly the first 120 MB of the download, not
the whole file.

Selection comes from the official split CSV (`split_csv/1cls.csv` in the
amazon-science/spot-diff repository): the first N train normals, the first N
test normals and the first N test anomalies of each category, sorted by path,
so every run picks the same images. Nothing here is committed to git; the cache
lives under services/api/.cache/visa/ (gitignored).

Usage:
    services/api/.venv/bin/python scripts/visa_subset.py
    services/api/.venv/bin/python scripts/visa_subset.py --category candle \
        --category capsules --train-normal 20 --test-normal 6 --test-anomaly 6

Prints the cache directory. Layout:
    <cache>/<category>/train_normal/*.png
    <cache>/<category>/test_normal/*.png
    <cache>/<category>/test_anomaly/*.png
    <cache>/<category>/selection.json   (source path for every written file)

Source:   https://github.com/amazon-science/spot-diff
Archive:  https://amazon-visual-anomaly.s3.us-west-2.amazonaws.com/VisA_20220922.tar
License:  CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)
Citation: Zou et al., "SPot-the-Difference Self-Supervised Pre-training for
          Anomaly Detection and Segmentation", ECCV 2022 (arXiv:2207.14315).
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import sys
import tarfile
import urllib.request
from pathlib import Path

from PIL import Image

ARCHIVE_URL = "https://amazon-visual-anomaly.s3.us-west-2.amazonaws.com/VisA_20220922.tar"
SPLIT_CSV_URL = (
    "https://raw.githubusercontent.com/amazon-science/spot-diff/main/split_csv/1cls.csv"
)
CATEGORIES = (
    "candle", "capsules", "cashew", "chewinggum", "fryum", "macaroni1",
    "macaroni2", "pcb1", "pcb2", "pcb3", "pcb4", "pipe_fryum",
)
MAX_SIDE = 512
DEFAULT_CACHE = Path(__file__).resolve().parents[1] / "services" / "api" / ".cache" / "visa"
BUCKETS = {
    ("train", "normal"): "train_normal",
    ("test", "normal"): "test_normal",
    ("test", "anomaly"): "test_anomaly",
}


def _fetch_split_rows() -> list[dict[str, str]]:
    with urllib.request.urlopen(SPLIT_CSV_URL, timeout=60) as response:
        text = response.read().decode("utf-8")
    rows = list(csv.DictReader(io.StringIO(text)))
    if not rows or not {"object", "split", "label", "image"} <= set(rows[0]):
        raise SystemExit("split CSV did not have the expected columns")
    return rows


def select(rows: list[dict[str, str]], categories: list[str], counts: dict[str, int]) -> dict[str, str]:
    """Return {archive member path: bucket dir name} for the chosen subset."""
    chosen: dict[str, str] = {}
    for category in categories:
        for (split, label), bucket in BUCKETS.items():
            paths = sorted(
                row["image"]
                for row in rows
                if row["object"] == category and row["split"] == split and row["label"] == label
            )
            if len(paths) < counts[bucket]:
                raise SystemExit(f"{category}: only {len(paths)} {bucket} images in the split CSV")
            for path in paths[: counts[bucket]]:
                chosen[path] = f"{category}/{bucket}"
    return chosen


def _downscale_to_png(data: bytes) -> bytes:
    with Image.open(io.BytesIO(data)) as image:
        image = image.convert("RGB")
        image.thumbnail((MAX_SIDE, MAX_SIDE), Image.Resampling.LANCZOS)
        out = io.BytesIO()
        image.save(out, format="PNG", optimize=True)
        return out.getvalue()


def _already_cached(cache: Path, chosen: dict[str, str]) -> bool:
    return all((cache / bucket / _png_name(member)).exists() for member, bucket in chosen.items())


def _png_name(member: str) -> str:
    return Path(member).stem + ".png"


def fetch(cache: Path, chosen: dict[str, str]) -> None:
    """Stream the archive and extract the chosen members, stopping when done."""
    remaining = dict(chosen)
    request = urllib.request.Request(ARCHIVE_URL, headers={"User-Agent": "visa-subset-fetch"})
    with urllib.request.urlopen(request, timeout=120) as response:
        with tarfile.open(fileobj=response, mode="r|") as archive:
            for member in archive:
                bucket = remaining.pop(member.name, None)
                if bucket is None or not member.isfile():
                    continue
                handle = archive.extractfile(member)
                if handle is None:
                    continue
                target = cache / bucket / _png_name(member.name)
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(_downscale_to_png(handle.read()))
                if not remaining:
                    return
    if remaining:
        raise SystemExit(f"archive ended with {len(remaining)} selected members missing")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--category", action="append", choices=CATEGORIES)
    parser.add_argument("--train-normal", type=int, default=20)
    parser.add_argument("--test-normal", type=int, default=6)
    parser.add_argument("--test-anomaly", type=int, default=6)
    parser.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE)
    args = parser.parse_args(argv)

    categories = args.category or ["candle"]
    counts = {
        "train_normal": args.train_normal,
        "test_normal": args.test_normal,
        "test_anomaly": args.test_anomaly,
    }
    rows = _fetch_split_rows()
    chosen = select(rows, categories, counts)
    cache: Path = args.cache_dir
    if not _already_cached(cache, chosen):
        fetch(cache, chosen)
    for category in categories:
        manifest = {
            "source": ARCHIVE_URL,
            "split_csv": SPLIT_CSV_URL,
            "license": "CC BY 4.0",
            "files": {
                f"{bucket.split('/', 1)[1]}/{_png_name(member)}": member
                for member, bucket in sorted(chosen.items())
                if bucket.startswith(f"{category}/")
            },
        }
        (cache / category).mkdir(parents=True, exist_ok=True)
        (cache / category / "selection.json").write_text(json.dumps(manifest, indent=2) + "\n")
    sys.stdout.write(f"{cache}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
