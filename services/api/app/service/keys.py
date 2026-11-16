"""The ONLY place the B2 key layout is built.

    lines/<line-id>/line.json
    lines/<line-id>/<date>/images/<serial>.png
    lines/<line-id>/<date>/heatmaps/<serial>.<model-version>.png
    lines/<line-id>/scores/date=<date>/<utc-ts>-<uuid>.parquet
    lines/<line-id>/labels/<serial>/<utc-ts>.json
    lines/<line-id>/parts/<serial>.json
    lines/<line-id>/models/<version>/{model.ckpt,metrics.json,training-set.json,version.json}

Every builder validates its inputs against strict patterns first, so a line id
or serial can never smuggle a `/`, `..` or other path syntax into a key.
"""

import re
import uuid
from datetime import UTC, date, datetime

from app.types.inspection import SERIAL_PATTERN, ArchiveKind
from app.types.lines import LINE_ID_PATTERN

ROOT = "lines/"
_LINE_RE = re.compile(LINE_ID_PATTERN)
_SERIAL_RE = re.compile(SERIAL_PATTERN)
_VERSION_RE = re.compile(r"^v[1-9][0-9]{0,5}$")
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_IMAGE_RE = re.compile(
    r"^lines/(?P<line>[a-z0-9][a-z0-9-]{1,40})/(?P<date>\d{4}-\d{2}-\d{2})/images/"
    r"(?P<serial>[A-Za-z0-9._-]{1,64})\.png$"
)
_DATE_DIR_RE = re.compile(r"^lines/[a-z0-9-]+/(\d{4}-\d{2}-\d{2})/$")


class InvalidKeyPart(ValueError):
    """A line id, serial, version or date failed validation."""


def check_line_id(line_id: str) -> str:
    if not _LINE_RE.fullmatch(line_id):
        raise InvalidKeyPart(f"Invalid line id '{line_id}'")
    return line_id


def check_serial(serial: str) -> str:
    # "." and ".." match the character class but are path syntax, not serials.
    if not _SERIAL_RE.fullmatch(serial) or set(serial) == {"."}:
        raise InvalidKeyPart(f"Invalid serial '{serial}'")
    return serial


def check_version(version: str) -> str:
    if not _VERSION_RE.fullmatch(version):
        raise InvalidKeyPart(f"Invalid model version '{version}'")
    return version


def check_date(value: str) -> str:
    if not _DATE_RE.fullmatch(value):
        raise InvalidKeyPart(f"Invalid date '{value}'")
    date.fromisoformat(value)
    return value


def line_prefix(line_id: str) -> str:
    return f"{ROOT}{check_line_id(line_id)}/"


def line_record(line_id: str) -> str:
    return f"{line_prefix(line_id)}line.json"


def date_prefix(line_id: str, capture_date: str) -> str:
    return f"{line_prefix(line_id)}{check_date(capture_date)}/"


def image(line_id: str, capture_date: str, serial: str) -> str:
    return f"{date_prefix(line_id, capture_date)}images/{check_serial(serial)}.png"


def heatmap(line_id: str, capture_date: str, serial: str, version: str) -> str:
    return (
        f"{date_prefix(line_id, capture_date)}heatmaps/"
        f"{check_serial(serial)}.{check_version(version)}.png"
    )


def scores_prefix(line_id: str) -> str:
    return f"{line_prefix(line_id)}scores/"


def scores_part(line_id: str, capture_date: str, now: datetime | None = None) -> str:
    stamp = (now or datetime.now(UTC)).strftime("%Y%m%dT%H%M%S%fZ")
    return (
        f"{scores_prefix(line_id)}date={check_date(capture_date)}/"
        f"{stamp}-{uuid.uuid4().hex[:12]}.parquet"
    )


def labels_prefix(line_id: str, serial: str | None = None) -> str:
    base = f"{line_prefix(line_id)}labels/"
    return base if serial is None else f"{base}{check_serial(serial)}/"


def label(line_id: str, serial: str, now: datetime | None = None) -> str:
    stamp = (now or datetime.now(UTC)).strftime("%Y%m%dT%H%M%S%fZ")
    return f"{labels_prefix(line_id, serial)}{stamp}.json"


def parts_prefix(line_id: str) -> str:
    return f"{line_prefix(line_id)}parts/"


def part_index(line_id: str, serial: str) -> str:
    return f"{parts_prefix(line_id)}{check_serial(serial)}.json"


def models_prefix(line_id: str) -> str:
    return f"{line_prefix(line_id)}models/"


def model_file(line_id: str, version: str, name: str) -> str:
    if name not in {"model.ckpt", "metrics.json", "training-set.json", "version.json"}:
        raise InvalidKeyPart(f"Unknown model file '{name}'")
    return f"{models_prefix(line_id)}{check_version(version)}/{name}"


def serial_from_part_index(key: str) -> str | None:
    name = key.rsplit("/", 1)[-1]
    return name[: -len(".json")] if name.endswith(".json") else None


def version_from_prefix(prefix: str) -> str | None:
    candidate = prefix.rstrip("/").rsplit("/", 1)[-1]
    return candidate if _VERSION_RE.fullmatch(candidate) else None


def date_from_prefix(prefix: str) -> str | None:
    match = _DATE_DIR_RE.fullmatch(prefix)
    return match.group(1) if match else None


def parse_image(key: str) -> tuple[str, str, str] | None:
    """(line_id, date, serial) for a capture key, or None for anything else."""
    match = _IMAGE_RE.fullmatch(key)
    return (match["line"], match["date"], match["serial"]) if match else None


def kind_of(key: str) -> ArchiveKind | None:
    """Classify any key under lines/ for archive views and byte counts."""
    if not key.startswith(ROOT):
        return None
    segments = key.split("/")
    if len(segments) < 4:
        return None
    if _DATE_RE.fullmatch(segments[2]):
        if segments[3] == "images":
            return ArchiveKind.images
        if segments[3] == "heatmaps":
            return ArchiveKind.heatmaps
        return None
    try:
        return ArchiveKind(segments[2])
    except ValueError:
        return None


def archive_prefix(line_id: str, kind: ArchiveKind, capture_date: str | None) -> str:
    if kind in (ArchiveKind.images, ArchiveKind.heatmaps):
        if capture_date is None:
            raise InvalidKeyPart("A capture date is required for images and heatmaps")
        return f"{date_prefix(line_id, capture_date)}{kind.value}/"
    return f"{line_prefix(line_id)}{kind.value}/"
