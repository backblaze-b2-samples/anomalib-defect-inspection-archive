"""Small object-store primitives for the inspection archive.

All calls use the single boto3 client from ``b2_client`` (custom user agent,
checksum settings). Listings here are uncached and exact: inspection records
must reflect the latest write, unlike the full-bucket explorer's listing cache,
which every write here still invalidates so /files stays current.
"""

import json
from collections import OrderedDict
from threading import Lock
from typing import Any

from botocore.exceptions import BotoCoreError, ClientError

from app.config import settings
from app.repo.b2_client import get_presigned_url, get_s3_bulk_client, get_s3_client
from app.repo.list_cache import invalidate as _invalidate_list_cache


class ObjectNotFound(Exception):
    """The requested key does not exist."""


def _is_missing(error: ClientError) -> bool:
    return error.response.get("Error", {}).get("Code", "") in ("404", "NoSuchKey", "NotFound")


def put_bytes(key: str, data: bytes, content_type: str, *, bulk: bool = False) -> str:
    """Write an object and return its ETag. Raises RuntimeError on failure.

    ``bulk=True`` uses the long-timeout client, for multi-megabyte bodies.
    """
    client = get_s3_bulk_client() if bulk else get_s3_client()
    try:
        response = client.put_object(
            Bucket=settings.b2_bucket_name, Key=key, Body=data, ContentType=content_type
        )
    except (ClientError, BotoCoreError) as e:
        raise RuntimeError(f"B2 put failed for '{key}': {e}") from e
    _invalidate_list_cache()
    return str(response.get("ETag", "")).strip('"')


def put_json(key: str, payload: Any) -> str:
    body = json.dumps(payload, indent=2, sort_keys=True, default=str).encode("utf-8")
    return put_bytes(key, body, "application/json")


def get_bytes(key: str) -> bytes:
    """Read a whole object. Raises ObjectNotFound or RuntimeError."""
    try:
        response = get_s3_client().get_object(Bucket=settings.b2_bucket_name, Key=key)
        return response["Body"].read()
    except ClientError as e:
        if _is_missing(e):
            raise ObjectNotFound(key) from None
        raise RuntimeError(f"B2 get failed for '{key}': {e}") from e
    except BotoCoreError as e:
        raise RuntimeError(f"B2 get failed for '{key}': {e}") from e


def get_json(key: str) -> Any:
    return json.loads(get_bytes(key))


# Write-once objects (part index, labels, score part files) never change after
# they are written, so a read can be memoized by key for the process lifetime.
# Bounded by total bytes; oldest entries are dropped first.
_IMMUTABLE_LIMIT_BYTES = 64 * 1024 * 1024
_immutable: OrderedDict[str, bytes] = OrderedDict()
_immutable_size = 0
_immutable_lock = Lock()


def get_immutable(key: str) -> bytes:
    """``get_bytes`` for write-once keys, served from memory after the first read."""
    global _immutable_size
    with _immutable_lock:
        cached = _immutable.get(key)
        if cached is not None:
            _immutable.move_to_end(key)
            return cached
    data = get_bytes(key)
    with _immutable_lock:
        if key not in _immutable:
            _immutable[key] = data
            _immutable_size += len(data)
        while _immutable_size > _IMMUTABLE_LIMIT_BYTES and _immutable:
            _, dropped = _immutable.popitem(last=False)
            _immutable_size -= len(dropped)
    return data


def reset_immutable_cache() -> None:
    global _immutable_size
    with _immutable_lock:
        _immutable.clear()
        _immutable_size = 0


def download_to(key: str, path: str) -> str:
    """Stream an object to a local file; returns the ETag. Raises ObjectNotFound.

    Uses the long-timeout client: this fills the local cache with checkpoints
    and images, the largest objects the app reads.
    """
    try:
        response = get_s3_bulk_client().get_object(Bucket=settings.b2_bucket_name, Key=key)
        with open(path, "wb") as handle:
            for chunk in response["Body"].iter_chunks(1024 * 1024):
                handle.write(chunk)
        return str(response.get("ETag", "")).strip('"')
    except ClientError as e:
        if _is_missing(e):
            raise ObjectNotFound(key) from None
        raise RuntimeError(f"B2 get failed for '{key}': {e}") from e
    except BotoCoreError as e:
        raise RuntimeError(f"B2 get failed for '{key}': {e}") from e


def head(key: str) -> dict | None:
    """{etag, size, content_type, last_modified} or None when missing."""
    try:
        response = get_s3_client().head_object(Bucket=settings.b2_bucket_name, Key=key)
    except ClientError as e:
        if _is_missing(e):
            return None
        raise RuntimeError(f"B2 head failed for '{key}': {e}") from e
    except BotoCoreError as e:
        raise RuntimeError(f"B2 head failed for '{key}': {e}") from e
    return {
        "etag": str(response.get("ETag", "")).strip('"'),
        "size": response["ContentLength"],
        "content_type": response.get("ContentType", ""),
        "last_modified": response["LastModified"],
    }


def list_page(
    prefix: str, *, delimiter: str | None = None, token: str | None = None, max_keys: int = 1000
) -> tuple[list[dict], list[str], str | None]:
    """One list_objects_v2 page: (objects, common prefixes, next token)."""
    kwargs: dict[str, Any] = {
        "Bucket": settings.b2_bucket_name,
        "Prefix": prefix,
        "MaxKeys": max_keys,
    }
    if delimiter:
        kwargs["Delimiter"] = delimiter
    if token:
        kwargs["ContinuationToken"] = token
    try:
        response = get_s3_client().list_objects_v2(**kwargs)
    except (ClientError, BotoCoreError) as e:
        raise RuntimeError(f"B2 list failed for '{prefix}': {e}") from e
    objects = [
        {
            "key": obj["Key"],
            "size": obj["Size"],
            "etag": str(obj.get("ETag", "")).strip('"'),
            "last_modified": obj["LastModified"],
        }
        for obj in response.get("Contents", [])
    ]
    prefixes = [entry["Prefix"] for entry in response.get("CommonPrefixes", [])]
    next_token = response.get("NextContinuationToken") if response.get("IsTruncated") else None
    return objects, prefixes, next_token


def list_all(prefix: str) -> list[dict]:
    """Every object under ``prefix`` (paginated)."""
    out: list[dict] = []
    token = None
    while True:
        objects, _, token = list_page(prefix, token=token)
        out.extend(objects)
        if not token:
            return out


def list_prefixes(prefix: str) -> list[str]:
    """Immediate sub-prefixes ("folders") under ``prefix``."""
    out: list[str] = []
    token = None
    while True:
        _, prefixes, token = list_page(prefix, delimiter="/", token=token)
        out.extend(prefixes)
        if not token:
            return out


def view_url(key: str) -> str:
    """Short-lived inline presigned GET for review, trace and archive views."""
    return get_presigned_url(
        key, expires_in=settings.presign_view_expiry_seconds, disposition="inline"
    )
