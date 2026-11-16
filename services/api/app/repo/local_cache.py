"""Local file cache that Anomalib reads images and checkpoints from.

Filled ONLY from B2 through the app's boto3 client (``b2_store.download_to``),
so every byte Anomalib sees was read with the custom user agent; Anomalib never
downloads anything from B2 itself. Entries are keyed by object key + ETag, so a
changed object can never be served stale. The cache is disposable: deleting the
directory changes nothing in B2, the next run simply refills it.
"""

import hashlib
import os
import shutil
from pathlib import Path

from app.config import settings
from app.repo.b2_store import download_to

_REPO_ROOT = Path(__file__).resolve().parents[4]


def cache_root() -> Path:
    configured = Path(settings.inspection_cache_dir)
    root = configured if configured.is_absolute() else _REPO_ROOT / configured
    root.mkdir(parents=True, exist_ok=True)
    return root


def _entry_path(key: str, etag: str) -> Path:
    digest = hashlib.sha256(f"{key}\n{etag}".encode()).hexdigest()[:32]
    suffix = Path(key).suffix or ".bin"
    return cache_root() / "objects" / digest[:2] / f"{digest}{suffix}"


def fetch(key: str, etag: str) -> Path:
    """Local path of ``key`` at ``etag``, downloading from B2 on a miss."""
    path = _entry_path(key, etag)
    if path.exists():
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_name(f"{path.name}.{os.getpid()}.part")
    actual = download_to(key, str(partial))
    if etag and actual and actual != etag:
        partial.unlink(missing_ok=True)
        raise RuntimeError(f"'{key}' changed in B2 (expected ETag {etag}, got {actual})")
    partial.replace(path)
    return path


def workdir(*parts: str) -> Path:
    """A fresh, empty scratch directory under the cache (e.g. one training run)."""
    path = cache_root().joinpath("runs", *parts)
    shutil.rmtree(path, ignore_errors=True)
    path.mkdir(parents=True)
    return path


def link_into(source: Path, target_dir: Path, name: str) -> Path:
    """Expose a cached object under ``target_dir/name`` without copying it."""
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / name
    try:
        target.symlink_to(source)
    except OSError:
        shutil.copyfile(source, target)
    return target
