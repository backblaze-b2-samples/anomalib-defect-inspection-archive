"""In-memory stand-in for the repo/b2_store boundary (hermetic API tests).

Patches the module functions the inspection services call, so tests exercise
the real services, key layout, Parquet encoding and status derivation against
an object store that behaves like B2's S3 API for the calls the app makes.
"""

import hashlib
from datetime import UTC, datetime

import numpy as np

from app.repo import b2_store, local_cache
from app.service import inspection


class FakeStore:
    def __init__(self) -> None:
        self.objects: dict[str, dict] = {}
        self.deleted: list[str] = []

    # --- b2_store API -------------------------------------------------------
    def put_bytes(self, key: str, data: bytes, content_type: str, *, bulk: bool = False) -> str:
        etag = hashlib.md5(data).hexdigest()
        self.objects[key] = {
            "data": data,
            "content_type": content_type,
            "etag": etag,
            "last_modified": datetime.now(UTC),
        }
        return etag

    def upload_file(self, key, path, content_type, on_bytes=None) -> None:
        data = path.read_bytes()
        if on_bytes:
            on_bytes(len(data))
        self.put_bytes(key, data, content_type, bulk=True)

    def get_bytes(self, key: str) -> bytes:
        if key not in self.objects:
            raise b2_store.ObjectNotFound(key)
        return self.objects[key]["data"]

    def head(self, key: str) -> dict | None:
        obj = self.objects.get(key)
        if obj is None:
            return None
        return {
            "etag": obj["etag"],
            "size": len(obj["data"]),
            "content_type": obj["content_type"],
            "last_modified": obj["last_modified"],
        }

    def list_page(self, prefix, *, delimiter=None, token=None, max_keys=1000):
        keys = sorted(k for k in self.objects if k.startswith(prefix))
        if delimiter:
            prefixes = sorted(
                {prefix + k[len(prefix) :].split(delimiter, 1)[0] + delimiter
                 for k in keys if delimiter in k[len(prefix) :]}
            )
            keys = [k for k in keys if delimiter not in k[len(prefix) :]]
        else:
            prefixes = []
        start = int(token or 0)
        page = keys[start : start + max_keys]
        next_token = str(start + max_keys) if start + max_keys < len(keys) else None
        objects = [
            {"key": k, "size": len(self.objects[k]["data"]), "etag": self.objects[k]["etag"],
             "last_modified": self.objects[k]["last_modified"]}
            for k in page
        ]
        return objects, prefixes, next_token

    def download_to(self, key: str, path: str) -> str:
        data = self.get_bytes(key)
        with open(path, "wb") as handle:
            handle.write(data)
        return self.objects[key]["etag"]

    def install(self, monkeypatch, tmp_path) -> "FakeStore":
        import json

        monkeypatch.setattr(b2_store, "put_bytes", self.put_bytes)
        monkeypatch.setattr(
            b2_store, "put_json",
            lambda key, payload: self.put_bytes(
                key, json.dumps(payload, default=str).encode(), "application/json"
            ),
        )
        monkeypatch.setattr(b2_store, "upload_file", self.upload_file)
        monkeypatch.setattr(b2_store, "get_bytes", self.get_bytes)
        monkeypatch.setattr(b2_store, "get_immutable", self.get_bytes)
        monkeypatch.setattr(b2_store, "get_json", lambda key: json.loads(self.get_bytes(key)))
        monkeypatch.setattr(b2_store, "head", self.head)
        monkeypatch.setattr(b2_store, "list_page", self.list_page)
        monkeypatch.setattr(b2_store, "view_url", lambda key: f"https://signed.example/{key}")
        monkeypatch.setattr(local_cache, "download_to", self.download_to)
        monkeypatch.setattr(
            inspection,
            "generate_presigned_upload",
            lambda key, ctype, size, expires: f"https://signed.example/put/{key}",
        )
        from app.config import settings

        monkeypatch.setattr(settings, "inspection_cache_dir", str(tmp_path / "cache"))
        return self

    def keys(self, prefix: str = "") -> list[str]:
        return sorted(k for k in self.objects if k.startswith(prefix))


class FakeScorer:
    """Deterministic stand-in for the PatchCore scorer: score = mean pixel / 100.

    Real scoring is exercised by `make test` (live_tests/); these tests cover
    everything around it: keys, heatmaps, Parquet rows, status and review.
    """

    device = "cpu"

    def score(self, image_path):
        from PIL import Image

        with Image.open(image_path) as image:
            value = float(np.asarray(image.convert("L"), dtype=np.float32).mean()) / 100.0
        return value, np.full((8, 8), value, dtype=np.float32)


def png_bytes(gray: int, size: int = 16, fmt: str = "PNG") -> bytes:
    import io

    from PIL import Image

    out = io.BytesIO()
    Image.new("RGB", (size, size), (gray, gray, gray)).save(out, format=fmt)
    return out.getvalue()
