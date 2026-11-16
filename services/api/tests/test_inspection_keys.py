"""The B2 key layout (service/keys.py) and its input validation."""

from datetime import UTC, datetime

import pytest

from app.service import keys
from app.types.inspection import ArchiveKind


def test_layout_matches_the_documented_tree():
    now = datetime(2026, 11, 16, 8, 30, 0, 123456, tzinfo=UTC)
    assert keys.line_record("line-01") == "lines/line-01/line.json"
    assert keys.image("line-01", "2026-11-16", "CNDL-1") == "lines/line-01/2026-11-16/images/CNDL-1.png"
    assert (
        keys.heatmap("line-01", "2026-11-16", "CNDL-1", "v2")
        == "lines/line-01/2026-11-16/heatmaps/CNDL-1.v2.png"
    )
    assert keys.label("line-01", "CNDL-1", now) == (
        "lines/line-01/labels/CNDL-1/20261116T083000123456Z.json"
    )
    assert keys.part_index("line-01", "CNDL-1") == "lines/line-01/parts/CNDL-1.json"
    assert keys.model_file("line-01", "v3", "model.ckpt") == "lines/line-01/models/v3/model.ckpt"
    part = keys.scores_part("line-01", "2026-11-16", now)
    assert part.startswith("lines/line-01/scores/date=2026-11-16/20261116T083000123456Z-")
    assert part.endswith(".parquet")


def test_score_part_files_never_collide():
    now = datetime(2026, 11, 16, tzinfo=UTC)
    assert keys.scores_part("line-01", "2026-11-16", now) != keys.scores_part(
        "line-01", "2026-11-16", now
    )


@pytest.mark.parametrize(
    "serial", ["../x", "a/b", "..", ".", "", "x" * 65, "a b", "a\\b", "%2e%2e", "a\x00b"]
)
def test_serials_cannot_inject_path_syntax(serial):
    with pytest.raises(keys.InvalidKeyPart):
        keys.image("line-01", "2026-11-16", serial)


@pytest.mark.parametrize("line_id", ["../lines", "Line-01", "-x", "a", "a/b", "a" * 42, "line_01"])
def test_line_ids_are_strict_slugs(line_id):
    with pytest.raises(keys.InvalidKeyPart):
        keys.line_record(line_id)


@pytest.mark.parametrize("version", ["v0", "1", "v1/..", "v-1", "latest"])
def test_versions_are_v_number(version):
    with pytest.raises(keys.InvalidKeyPart):
        keys.model_file("line-01", version, "model.ckpt")


def test_unknown_model_file_and_bad_date_are_rejected():
    with pytest.raises(keys.InvalidKeyPart):
        keys.model_file("line-01", "v1", "../../secrets")
    with pytest.raises(ValueError):
        keys.image("line-01", "2026-13-40", "S1")


def test_parse_and_classify_keys():
    assert keys.parse_image("lines/line-01/2026-11-16/images/S-1.png") == (
        "line-01", "2026-11-16", "S-1",
    )
    assert keys.parse_image("lines/line-01/2026-11-16/heatmaps/S-1.v1.png") is None
    assert keys.parse_image("uploads/S-1.png") is None
    assert keys.kind_of("lines/l1/2026-11-16/images/a.png") == ArchiveKind.images
    assert keys.kind_of("lines/l1/2026-11-16/heatmaps/a.v1.png") == ArchiveKind.heatmaps
    assert keys.kind_of("lines/l1/scores/date=2026-11-16/x.parquet") == ArchiveKind.scores
    assert keys.kind_of("lines/l1/labels/a/x.json") == ArchiveKind.labels
    assert keys.kind_of("lines/l1/models/v1/model.ckpt") == ArchiveKind.models
    assert keys.kind_of("lines/l1/parts/a.json") is None
    assert keys.kind_of("uploads/a.png") is None
