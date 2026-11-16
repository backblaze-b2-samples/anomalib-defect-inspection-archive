"""End-to-end inspection self-test against a REAL B2 bucket and REAL PatchCore.

Run with `make test` (needs `.env` with a B2 *test* bucket and `pnpm setup:ml`).
CPU is forced to prove the CPU path. It writes a run-unique line
`selftest-<utc-ts>` and never deletes what it wrote: inspection records are
never deleted, so point it at a test bucket.

Flow: download a VisA subset -> create the line -> capture reference normals and
anomalies (real presigned PUT to B2) -> train v1 on CPU from images read back
from B2 -> capture and score new parts -> assert heatmaps and Parquet files in
B2 -> review queue -> operator verdicts -> train v2 from the adjudicated set
(manifest ETags match B2) -> activate v2 -> trace a part end to end.
"""

import json
import os
import subprocess
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

import pytest

import main  # loads the repo-root env file before settings are read

API_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = API_ROOT.parents[1]
TRAIN_WAIT_SECONDS = 1800
# Kept small on purpose: every image and heatmap crosses the network to B2, and
# a laptop uplink, not the model, dominates the run time.
REFERENCE_NORMALS = 12
REFERENCE_ANOMALIES = 3
NEW_NORMALS = 4
NEW_ANOMALIES = 3
# 0.01 keeps a ~0.5 MB checkpoint (0.1, the UI default, is ~5 MB).
CORESET = 0.01

pytestmark = pytest.mark.live


def _visa_dir() -> Path:
    out = subprocess.run(
        [sys.executable, str(REPO_ROOT / "scripts" / "visa_subset.py"), "--category", "candle"],
        check=True, capture_output=True, text=True,
    )
    return Path(out.stdout.strip().splitlines()[-1]) / "candle"


@pytest.fixture
def live(monkeypatch):
    if os.environ.get("RUN_LIVE_B2_TESTS") != "1":
        pytest.skip("set RUN_LIVE_B2_TESTS=1 (make test does) to allow real B2 + ML work")
    from app.config import settings
    from app.repo import anomaly_engine

    if not anomaly_engine.ml_installed():
        pytest.skip("ML extra missing: run `pnpm setup:ml`")
    monkeypatch.setattr(settings, "inspection_device", "cpu")
    monkeypatch.setattr(settings, "rate_limit_write_per_minute", 10_000)
    monkeypatch.setattr(settings, "rate_limit_per_minute", 10_000)
    from fastapi.testclient import TestClient

    with TestClient(main.app) as client:
        yield client


def _capture(client, http, line_id, serial, path: Path, reference=None):
    data = path.read_bytes()
    r = client.post(f"/lines/{line_id}/parts/presign",
                    json={"serial": serial, "content_type": "image/png", "size_bytes": len(data)})
    assert r.status_code == 200, r.text
    presign = r.json()
    # The browser's direct PUT to B2. S3 clients retry 5xx with backoff; so
    # does this one (B2 can answer a transient 500/503 under load).
    for attempt in range(4):
        put = http.put(presign["upload_url"], content=data, headers=presign["headers"])
        if put.status_code < 500:
            break
        time.sleep(2**attempt)
    assert put.status_code == 200, put.text
    body = {"serial": serial, "image_key": presign["image_key"]}
    if reference:
        body["reference"] = reference
    r = client.post(f"/lines/{line_id}/parts", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def _train(client, line_id, **body):
    from app.service import train_runner

    r = client.post(f"/lines/{line_id}/models", json=body)
    assert r.status_code == 200, r.text
    version = r.json()["version"]
    assert train_runner.wait_idle(TRAIN_WAIT_SECONDS), "training did not finish"
    record = client.get(f"/lines/{line_id}/models/{version}").json()
    assert record["status"] == "ready", record.get("error")
    return record


def test_inspection_flow_end_to_end(live):
    import httpx

    from app.repo import b2_store

    client = live
    visa = _visa_dir()
    line_id = f"selftest-{datetime.now(UTC).strftime('%Y%m%dt%H%M%S')}"
    assert client.post("/lines", json={"line_id": line_id, "name": "Self-test (VisA candle)"}).status_code == 200
    train_normals = sorted((visa / "train_normal").glob("*.png"))[:REFERENCE_NORMALS]
    test_normals = sorted((visa / "test_normal").glob("*.png"))[:NEW_NORMALS]
    anomalies = sorted((visa / "test_anomaly").glob("*.png"))[: REFERENCE_ANOMALIES + NEW_ANOMALIES]
    started = time.monotonic()

    with httpx.Client(timeout=60) as http:
        for i, path in enumerate(train_normals):
            _capture(client, http, line_id, f"REF-N-{i:03d}", path, reference="normal")
        for i, path in enumerate(anomalies[:REFERENCE_ANOMALIES]):
            _capture(client, http, line_id, f"REF-A-{i:03d}", path, reference="anomalous")

        v1 = _train(client, line_id, image_size=256, coreset_ratio=CORESET)
        assert v1["threshold"] is not None and v1["image_auroc"] is not None
        assert client.get(f"/lines/{line_id}").json()["active_model_version"] == "v1"

        new_parts = [(f"CNDL-N-{i:03d}", p, False) for i, p in enumerate(test_normals)]
        new_parts += [
            (f"CNDL-A-{i:03d}", p, True) for i, p in enumerate(anomalies[REFERENCE_ANOMALIES:])
        ]
        records = {}
        for serial, path, _ in new_parts:
            record = _capture(client, http, line_id, serial, path)
            assert record["model_version"] == "v1" and record["score"] is not None
            assert b2_store.head(record["heatmap_key"]) is not None
            records[serial] = record

    score_files = b2_store.list_all(f"lines/{line_id}/scores/")
    assert len(score_files) == len(new_parts)  # one immutable part file per scoring call

    queue = client.get("/review-queue", params={"line_id": line_id}).json()
    flagged = {item["serial"] for item in queue}
    anomalous_serials = {s for s, _, bad in new_parts if bad}
    assert flagged & anomalous_serials, f"no anomalous part was flagged: {records}"

    for serial, _, bad in new_parts:
        r = client.put(f"/lines/{line_id}/parts/{serial}/verdict",
                       json={"verdict": "fail" if bad else "pass", "operator": "selftest"})
        assert r.status_code == 200, r.text
    assert client.get("/review-queue", params={"line_id": line_id}).json() == []

    v2 = _train(
        client, line_id, source="reference_and_adjudicated", image_size=256, coreset_ratio=CORESET
    )
    manifest = json.loads(b2_store.get_bytes(f"lines/{line_id}/models/v2/training-set.json"))
    adjudicated = {e["serial"]: e for e in manifest["entries"] if e["source"] == "verdict"}
    assert set(adjudicated) == {s for s, _, _ in new_parts}
    for entry in adjudicated.values():
        assert entry["etag"] == b2_store.head(entry["key"])["etag"]
        expected = ("eval", "anomalous") if entry["serial"] in anomalous_serials else ("train", "normal")
        assert (entry["role"], entry["label"]) == expected
    assert v2["train_image_count"] > v1["train_image_count"]
    assert client.post(f"/lines/{line_id}/models/v2/activate").json()["active_model_version"] == "v2"

    serial = sorted(anomalous_serials)[0]
    r = client.post(f"/lines/{line_id}/parts/{serial}/score", json={})
    assert r.status_code == 200 and r.json()["model_version"] == "v2"
    trace = client.get(f"/lines/{line_id}/parts/{serial}").json()
    assert trace["image_url"] and trace["heatmap_url"]
    assert [s["model_version"] for s in trace["scores"]] == ["v2", "v1"]
    assert trace["verdicts"][0]["verdict"] == "fail"
    assert trace["model"]["version"] == "v2"
    matches = client.get("/trace", params={"serial": serial}).json()
    assert {(m["line_id"], m["serial"]) for m in matches} >= {(line_id, serial)}
    sys.stderr.write(
        f"\nself-test line {line_id}: v1 threshold={v1['threshold']:.3f} "
        f"auroc={v1['image_auroc']} | v2 threshold={v2['threshold']:.3f} "
        f"auroc={v2['image_auroc']} | {time.monotonic() - started:.0f}s\n"
    )
