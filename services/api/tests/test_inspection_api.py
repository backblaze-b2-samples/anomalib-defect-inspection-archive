"""Inspection endpoints against an in-memory B2 (tests/fake_b2.py).

The scorer is replaced by a deterministic stand-in; the real PatchCore path is
exercised by the opt-in live test (`make test`).
"""

import io
import json
from datetime import UTC, datetime

import pytest
from PIL import Image

from app.repo import anomaly_engine
from app.service import keys, scoring, train_runner
from tests.fake_b2 import FakeScorer, FakeStore, png_bytes

LINE = "line-01"


@pytest.fixture
def store(monkeypatch, tmp_path):
    train_runner._reset_for_tests()
    return FakeStore().install(monkeypatch, tmp_path)


@pytest.fixture
def ml(monkeypatch):
    """Pretend the ML extra is installed and score with FakeScorer."""
    monkeypatch.setattr(anomaly_engine, "ml_installed", lambda: True)
    monkeypatch.setattr(scoring, "_scorer_for", lambda record: FakeScorer())


def _ready_model(store, version="v1", threshold=1.0):
    now = datetime.now(UTC).isoformat()
    record = {
        "line_id": LINE, "version": version, "status": "ready", "backbone": "wide_resnet50_2",
        "image_size": 256, "coreset_ratio": 0.1, "source": "reference_and_adjudicated",
        "train_image_count": 4, "eval_image_count": 2, "threshold": threshold,
        "threshold_method": "f1_max", "created_at": now, "anomalib_version": "2.7.0",
    }
    store.put_bytes(keys.model_file(LINE, version, "version.json"), json.dumps(record).encode(), "application/json")
    store.put_bytes(keys.model_file(LINE, version, "model.ckpt"), b"ckpt", "application/octet-stream")


async def _line(client, active=None, store=None):
    r = await client.post("/lines", json={"line_id": LINE, "name": "Line 1"})
    assert r.status_code == 200, r.text
    if active:
        _ready_model(store, active)
        r = await client.post(f"/lines/{LINE}/models/{active}/activate")
        assert r.status_code == 200, r.text


async def _capture(client, store, serial, gray, *, fmt="PNG", reference=None, score_now=True):
    data = png_bytes(gray, fmt=fmt)
    ctype = "image/png" if fmt == "PNG" else "image/jpeg"
    r = await client.post(
        f"/lines/{LINE}/parts/presign",
        json={"serial": serial, "content_type": ctype, "size_bytes": len(data)},
    )
    assert r.status_code == 200, r.text
    key = r.json()["image_key"]
    store.put_bytes(key, data, ctype)  # the browser's presigned PUT
    body = {"serial": serial, "image_key": key, "score_now": score_now}
    if reference:
        body["reference"] = reference
    return await client.post(f"/lines/{LINE}/parts", json=body)


async def test_capture_without_model_is_stored_unscored(client, store):
    await _line(client)
    r = await _capture(client, store, "S-1", 10)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "unscored"
    assert store.keys(f"lines/{LINE}/parts/") == [f"lines/{LINE}/parts/S-1.json"]
    assert store.keys(f"lines/{LINE}/scores/") == []


async def test_capture_scores_and_writes_heatmap_and_parquet(client, store, ml):
    await _line(client, active="v1", store=store)
    r = await _capture(client, store, "S-1", 200)  # FakeScorer: 2.0 >= 1.0
    assert r.status_code == 200, r.text
    record = r.json()
    assert record["status"] == "in_review"
    assert record["model_version"] == "v1"
    assert record["heatmap_key"].endswith("/heatmaps/S-1.v1.png")
    assert store.objects[record["heatmap_key"]]["data"][:8] == b"\x89PNG\r\n\x1a\n"
    assert len(store.keys(f"lines/{LINE}/scores/date=")) == 1


async def test_each_scoring_call_appends_a_new_parquet_file(client, store, ml):
    await _line(client, active="v1", store=store)
    await _capture(client, store, "S-1", 50)
    _ready_model(store, "v2", threshold=0.1)
    r = await client.post(f"/lines/{LINE}/parts/S-1/score", json={"model_version": "v2"})
    assert r.status_code == 200, r.text
    assert len(store.keys(f"lines/{LINE}/scores/")) == 2
    trace = (await client.get(f"/lines/{LINE}/parts/S-1")).json()
    assert [s["model_version"] for s in trace["scores"]] == ["v2", "v1"]
    # Re-scoring keeps the earlier model version's heatmap.
    assert {s["heatmap_key"].rsplit(".", 2)[-2] for s in trace["scores"]} == {"v1", "v2"}
    assert trace["model"]["version"] == "v2"
    assert len(trace["parquet_keys"]) == 2


async def test_jpeg_capture_is_stored_as_png(client, store):
    await _line(client)
    r = await _capture(client, store, "S-J", 90, fmt="JPEG")
    assert r.status_code == 200, r.text
    obj = store.objects[r.json()["image_key"]]
    assert obj["content_type"] == "image/png"
    assert Image.open(io.BytesIO(obj["data"])).format == "PNG"


async def test_duplicate_serial_is_409_at_presign_and_capture(client, store):
    await _line(client)
    assert (await _capture(client, store, "S-1", 10)).status_code == 200
    r = await client.post(
        f"/lines/{LINE}/parts/presign",
        json={"serial": "S-1", "content_type": "image/png", "size_bytes": 10},
    )
    assert r.status_code == 409
    key = keys.image(LINE, datetime.now(UTC).date().isoformat(), "S-1")
    r = await client.post(f"/lines/{LINE}/parts", json={"serial": "S-1", "image_key": key})
    assert r.status_code == 409


async def test_capture_rejects_a_key_the_presign_did_not_produce(client, store):
    await _line(client)
    r = await client.post(
        f"/lines/{LINE}/parts",
        json={"serial": "S-1", "image_key": "lines/other/2026-01-01/images/S-1.png"},
    )
    assert r.status_code == 400


async def test_verdict_history_latest_wins_and_earlier_kept(client, store, ml):
    await _line(client, active="v1", store=store)
    await _capture(client, store, "S-1", 200)
    queue = (await client.get("/review-queue")).json()
    assert [item["serial"] for item in queue] == ["S-1"]
    r = await client.put(f"/lines/{LINE}/parts/S-1/verdict", json={"verdict": "fail", "operator": "EP"})
    assert r.json()["status"] == "failed"
    r = await client.put(
        f"/lines/{LINE}/parts/S-1/verdict", json={"verdict": "pass", "operator": "EP", "note": "dust"}
    )
    assert r.json()["status"] == "passed"
    assert (await client.get("/review-queue")).json() == []
    trace = (await client.get(f"/lines/{LINE}/parts/S-1")).json()
    assert [v["verdict"] for v in trace["verdicts"]] == ["pass", "fail"]
    assert trace["verdicts"][0]["score_ref"].endswith("@v1")
    assert len(store.keys(f"lines/{LINE}/labels/S-1/")) == 2


async def test_scoring_and_training_answer_503_without_ml(client, store, monkeypatch):
    monkeypatch.setattr(anomaly_engine, "ml_installed", lambda: False)
    await _line(client, active="v1", store=store)
    assert (await _capture(client, store, "S-1", 200)).json()["status"] == "unscored"
    r = await client.post(f"/lines/{LINE}/parts/S-1/score", json={})
    assert r.status_code == 503
    assert "pnpm setup:ml" in r.json()["detail"]
    r = await client.post(f"/lines/{LINE}/models", json={})
    assert r.status_code == 503
    engine = (await client.get("/engine")).json()
    assert engine["ml_available"] is False
    assert "pnpm setup:ml" in engine["install_hint"]


async def test_training_writes_manifest_with_etags(client, store, monkeypatch):
    monkeypatch.setattr(anomaly_engine, "ml_installed", lambda: True)
    submitted = []
    monkeypatch.setattr(train_runner, "submit", lambda job, fn: submitted.append(job))
    await _line(client)
    for i in range(5):
        await _capture(client, store, f"R-{i}", 20 + i, reference="normal")
    await _capture(client, store, "A-0", 240, reference="anomalous")
    r = await client.post(f"/lines/{LINE}/models", json={"coreset_ratio": 0.1, "image_size": 256})
    assert r.status_code == 200, r.text
    assert r.json()["version"] == "v1"
    assert r.json()["status"] == "queued"
    assert submitted == [f"{LINE}/v1"]
    manifest = json.loads(store.objects[keys.model_file(LINE, "v1", "training-set.json")]["data"])
    by_serial = {e["serial"]: e for e in manifest["entries"]}
    assert by_serial["A-0"]["role"] == "eval"
    assert all(e["etag"] == store.head(e["key"])["etag"] for e in manifest["entries"])


async def test_unfinished_version_without_a_live_job_reads_as_interrupted(client, store):
    await _line(client)
    _ready_model(store, "v1")
    raw = json.loads(store.objects[keys.model_file(LINE, "v1", "version.json")]["data"])
    raw["status"] = "training"
    store.put_bytes(keys.model_file(LINE, "v1", "version.json"), json.dumps(raw).encode(), "application/json")
    versions = (await client.get(f"/lines/{LINE}/models")).json()
    assert versions[0]["status"] == "interrupted"
    persisted = json.loads(store.objects[keys.model_file(LINE, "v1", "version.json")]["data"])
    assert persisted["status"] == "interrupted"
    # A tracked (live) job is left alone.
    raw["status"] = "queued"
    store.put_bytes(keys.model_file(LINE, "v1", "version.json"), json.dumps(raw).encode(), "application/json")
    train_runner.track(f"{LINE}/v1")
    assert (await client.get(f"/lines/{LINE}/models/v1")).json()["status"] == "queued"


async def test_activate_requires_a_ready_version(client, store):
    await _line(client)
    _ready_model(store, "v1")
    raw = json.loads(store.objects[keys.model_file(LINE, "v1", "version.json")]["data"])
    raw["status"] = "failed"
    store.put_bytes(keys.model_file(LINE, "v1", "version.json"), json.dumps(raw).encode(), "application/json")
    assert (await client.post(f"/lines/{LINE}/models/v1/activate")).status_code == 409


async def test_lines_crud_and_trace_search(client, store):
    await _line(client)
    assert (await client.post("/lines", json={"line_id": LINE, "name": "dup"})).status_code == 409
    assert (await client.post("/lines", json={"line_id": "../x", "name": "bad"})).status_code == 422
    r = await client.patch(f"/lines/{LINE}", json={"description": "candle station"})
    assert r.json()["description"] == "candle station"
    await _capture(client, store, "CNDL-0001", 10)
    matches = (await client.get("/trace", params={"serial": "CNDL"})).json()
    assert [(m["line_id"], m["serial"], m["status"]) for m in matches] == [
        (LINE, "CNDL-0001", "unscored")
    ]
    detail = (await client.get(f"/lines/{LINE}")).json()
    assert detail["part_count"] == 1 and detail["unscored_count"] == 1
    assert (await client.get("/lines/nope-line")).status_code == 404


async def test_archive_and_stats(client, store, ml):
    await _line(client, active="v1", store=store)
    await _capture(client, store, "S-1", 200)
    page = (await client.get("/archive", params={"line_id": LINE, "kind": "images"})).json()
    assert [i["key"].rsplit("/", 1)[-1] for i in page["items"]] == ["S-1.png"]
    assert page["dates"] == [datetime.now(UTC).date().isoformat()]
    models = (await client.get("/archive", params={"line_id": LINE, "kind": "models"})).json()
    assert {i["key"].rsplit("/", 1)[-1] for i in models["items"]} == {"model.ckpt", "version.json"}
    stats = (await client.get("/inspection/stats")).json()
    assert stats["parts_inspected"] == 1
    assert stats["review_backlog"] == 1
    assert stats["bytes_by_kind"]["images"] > 0 and stats["bytes_by_kind"]["heatmaps"] > 0
    assert stats["parts_per_day"][-1]["count"] == 1


def test_no_inspection_route_deletes_anything():
    from main import app

    for route in app.routes:
        methods = getattr(route, "methods", set()) or set()
        path = getattr(route, "path", "")
        if "DELETE" in methods:
            assert path.startswith("/files"), f"unexpected delete route {path}"
